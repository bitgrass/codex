import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 80;
const DEFAULT_CHAT_TITLE = "";

type ChatStatus = "pending" | "success" | "error";

type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: ChatStatus;
  txHash?: string;
  showPortfolioLink?: boolean;
  nfts?: {
    id: string;
    name: string;
    tokenId: string;
    image: string | null;
    collectionName?: string | null;
    status?: "staked" | "available";
  }[];
  nftTruncated?: boolean;
  selectableNfts?: boolean;
};

type ChatConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ChatConversationRecord = ChatConversationSummary & {
  messages: PersistedChatMessage[];
};

type KvNamespaceLike = {
  get: (key: string, type?: string) => Promise<any>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete?: (key: string) => Promise<void>;
};

type MemoryHistoryStore = {
  indices: Map<string, ChatConversationSummary[]>;
  conversations: Map<string, ChatConversationRecord>;
};

const globalWithStore = globalThis as typeof globalThis & {
  __climateChatHistoryStore?: MemoryHistoryStore;
};

const memoryStore: MemoryHistoryStore =
  globalWithStore.__climateChatHistoryStore ||
  (globalWithStore.__climateChatHistoryStore = {
    indices: new Map(),
    conversations: new Map(),
  });

const MessageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
  status: z.enum(["pending", "success", "error"]).optional(),
  txHash: z.string().max(132).optional(),
  showPortfolioLink: z.boolean().optional(),
  nfts: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(160),
        tokenId: z.string().min(1).max(64),
        image: z.string().nullable(),
        collectionName: z.string().max(200).nullable().optional(),
        status: z.enum(["staked", "available"]).optional(),
      }),
    )
    .max(220)
    .optional(),
  nftTruncated: z.boolean().optional(),
  selectableNfts: z.boolean().optional(),
});

const PutHistorySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  conversationId: z.string().min(1).max(128),
  title: z.string().max(120).optional(),
  messages: z.array(MessageSchema).max(MAX_MESSAGES),
});

function addressKey(address: string) {
  return address.trim().toLowerCase();
}

function indexKey(address: string) {
  return `climate-chat:v1:user:${address}:index`;
}

function conversationKey(address: string, conversationId: string) {
  return `climate-chat:v1:user:${address}:conversation:${conversationId}`;
}

function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function deriveConversationTitle(_messages: PersistedChatMessage[]) {
  return DEFAULT_CHAT_TITLE;
}

function normalizeMessages(messages: PersistedChatMessage[]) {
  return messages
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      txHash: message.txHash,
      showPortfolioLink: message.showPortfolioLink,
      nfts: message.nfts,
      nftTruncated: message.nftTruncated,
      selectableNfts: message.selectableNfts,
    }));
}

function upsertSummary(
  summaries: ChatConversationSummary[],
  next: ChatConversationSummary,
) {
  return [next, ...summaries.filter((item) => item.id !== next.id)].slice(0, MAX_CONVERSATIONS);
}

async function getChatKv(): Promise<KvNamespaceLike | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return ((env as any).CHAT_HISTORY_KV as KvNamespaceLike | undefined) || null;
  } catch {
    return null;
  }
}

async function loadIndex(address: string, kv: KvNamespaceLike | null) {
  if (!kv) {
    return memoryStore.indices.get(address) || [];
  }

  const raw = await kv.get(indexKey(address));
  const parsed = safeParseJson<ChatConversationSummary[]>(typeof raw === "string" ? raw : null);
  return Array.isArray(parsed) ? parsed.slice(0, MAX_CONVERSATIONS) : [];
}

async function saveIndex(address: string, summaries: ChatConversationSummary[], kv: KvNamespaceLike | null) {
  const next = summaries.slice(0, MAX_CONVERSATIONS);
  if (!kv) {
    memoryStore.indices.set(address, next);
    return;
  }
  await kv.put(indexKey(address), JSON.stringify(next));
}

async function loadConversation(
  address: string,
  conversationId: string,
  kv: KvNamespaceLike | null,
) {
  const key = conversationKey(address, conversationId);
  if (!kv) {
    return memoryStore.conversations.get(key) || null;
  }

  const raw = await kv.get(key);
  return safeParseJson<ChatConversationRecord>(typeof raw === "string" ? raw : null);
}

async function saveConversation(
  address: string,
  conversation: ChatConversationRecord,
  kv: KvNamespaceLike | null,
) {
  const key = conversationKey(address, conversation.id);
  if (!kv) {
    memoryStore.conversations.set(key, conversation);
    return;
  }
  await kv.put(key, JSON.stringify(conversation));
}

async function deleteConversation(
  address: string,
  conversationId: string,
  kv: KvNamespaceLike | null,
) {
  const key = conversationKey(address, conversationId);
  if (!kv) {
    memoryStore.conversations.delete(key);
    return;
  }
  if (typeof kv.delete === "function") {
    await kv.delete(key);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const addressParam = url.searchParams.get("address");
  const conversationId = url.searchParams.get("conversationId");

  if (!addressParam || !/^0x[a-fA-F0-9]{40}$/.test(addressParam)) {
    return Response.json(
      { error: "Invalid address. Expected a wallet address in query string." },
      { status: 400 },
    );
  }

  const address = addressKey(addressParam);
  const kv = await getChatKv();
  const summaries = await loadIndex(address, kv);
  const sortedSummaries = [...summaries].sort((a, b) => {
    const left = new Date(a.updatedAt).getTime();
    const right = new Date(b.updatedAt).getTime();
    return Number.isFinite(right - left) ? right - left : 0;
  });

  const selectedConversationId =
    conversationId && conversationId.trim().length
      ? conversationId.trim()
      : sortedSummaries[0]?.id || null;

  const conversation =
    selectedConversationId
      ? await loadConversation(address, selectedConversationId, kv)
      : null;

  return Response.json(
    {
      conversations: sortedSummaries,
      activeConversationId: selectedConversationId,
      messages: conversation?.messages || [],
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = PutHistorySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload for chat history update." },
      { status: 400 },
    );
  }

  const address = addressKey(parsed.data.address);
  const conversationId = parsed.data.conversationId.trim();
  const incomingMessages = normalizeMessages(parsed.data.messages);
  const now = new Date().toISOString();
  const kv = await getChatKv();

  const previous = await loadConversation(address, conversationId, kv);
  const title =
    parsed.data.title?.trim() ||
    previous?.title ||
    deriveConversationTitle(incomingMessages);

  const conversation: ChatConversationRecord = {
    id: conversationId,
    title,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    messages: incomingMessages,
  };

  await saveConversation(address, conversation, kv);

  const summaries = await loadIndex(address, kv);
  const nextSummaries = upsertSummary(summaries, {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  });

  const keptIds = new Set(nextSummaries.map((item) => item.id));
  const removed = summaries.filter((item) => !keptIds.has(item.id));
  for (const item of removed) {
    await deleteConversation(address, item.id, kv);
  }

  await saveIndex(address, nextSummaries, kv);

  return Response.json(
    {
      conversationId: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      conversations: nextSummaries,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
