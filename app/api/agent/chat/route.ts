import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  message: z.string().min(1).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(1000),
      }),
    )
    .max(10)
    .optional(),
  walletConnected: z.boolean().optional(),
  address: z.string().optional(),
});

const ParsedIntentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("swap"),
    amount: z.string().min(1),
    fromSymbol: z.enum(["ETH", "USDC"]),
    toSymbol: z.enum(["ETH", "USDC"]),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("current_earnings"),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("total_earned"),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("transfer"),
    amount: z.string().min(1),
    symbol: z.enum(["ETH", "USDC"]),
    toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("balance"),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("nfts"),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("buy_plot"),
    tier: z.enum(["Standard", "Premium", "Legendary"]),
    size: z.enum(["100", "500", "1000"]),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("unknown"),
    reason: z.string().optional(),
  }),
]);

function parseSwapRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  const maxMatch = normalized.match(
    /swap\s+(all|max|100%)(?:\s+my)?\s*(eth|weth|usdc)\s*(to|for|->)\s*([a-z0-9]+)/i,
  );
  const match =
    maxMatch ||
    normalized.match(
      /swap\s+([\d.]+)\s*(eth|weth|usdc)\s*(to|for|->)\s*([a-z0-9]+)/i,
    );

  if (!match) {
    return { type: "unknown" as const, reason: "No swap command detected." };
  }

  const amount = match[1];
  const fromSymbol = match[2]?.toUpperCase();
  const buySymbol = match[4]?.toUpperCase();

  if (!amount) {
    return { type: "unknown" as const, reason: "Invalid amount." };
  }

  const isAllAmount = amount === "all" || amount === "max" || amount === "100%";
  if (!isAllAmount && (Number.isNaN(Number(amount)) || Number(amount) <= 0)) {
    return { type: "unknown" as const, reason: "Invalid amount." };
  }

  const normalizedFrom = fromSymbol === "WETH" ? "ETH" : fromSymbol;
  const normalizedTo =
    buySymbol === "WETH" || buySymbol === "ETHEREUM" ? "ETH" : buySymbol;
  if (!normalizedFrom || (normalizedFrom !== "ETH" && normalizedFrom !== "USDC")) {
    return { type: "unknown" as const, reason: "Only ETH or USDC are supported." };
  }

  if (normalizedTo !== "USDC" && normalizedTo !== "ETH") {
    return { type: "unknown" as const, reason: "Only ETH or USDC are supported." };
  }

  if (normalizedFrom === normalizedTo) {
    return { type: "unknown" as const, reason: "Swap tokens must be different." };
  }

  return {
    type: "swap" as const,
    amount: isAllAmount ? "all" : amount,
    fromSymbol: normalizedFrom as "ETH" | "USDC",
    toSymbol: normalizedTo as "ETH" | "USDC",
    chainId: 8453 as const,
  };
}

function parseTransferRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  const match = normalized.match(
    /(send|transfer)\s+([\d.]+)\s*(eth|usdc)\s+to\s+(0x[a-f0-9]{40})/i,
  );

  if (!match) {
    return { type: "unknown" as const, reason: "No transfer command detected." };
  }

  const amount = match[2];
  const symbol = match[3]?.toUpperCase();
  const toAddress = match[4] as `0x${string}`;

  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return { type: "unknown" as const, reason: "Invalid amount." };
  }

  if (symbol !== "ETH" && symbol !== "USDC") {
    return { type: "unknown" as const, reason: "Only ETH or USDC are supported." };
  }

  return {
    type: "transfer" as const,
    amount,
    symbol: symbol as "ETH" | "USDC",
    toAddress,
    chainId: 8453 as const,
  };
}

function parseBalanceRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  const match = normalized.match(
    /(balance|balances|wallet balance|check balance|check my balance|check my wallet)/i,
  );

  if (!match) {
    return { type: "unknown" as const, reason: "No balance command detected." };
  }

  return {
    type: "balance" as const,
    chainId: 8453 as const,
  };
}

function parseEarningsRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  if (
    /(current|now|pending|unclaimed).*(earn|earning|earned|bco2|bc02)/i.test(normalized) ||
    /(earn|earning).*(current|now|pending|unclaimed)/i.test(normalized)
  ) {
    return { type: "current_earnings" as const, chainId: 8453 as const };
  }
  if (
    /(total|overall|all time).*(earn|earned|earning|bco2|bc02)/i.test(normalized) ||
    /(how much).*(earned|earn|earning|bco2|bc02)/i.test(normalized) ||
    /(earned|earnings?)\s*(bco2|bc02)/i.test(normalized) ||
    /(total|overall|all time)\s*(bco2|bc02)/i.test(normalized) ||
    /(bco2|bc02).*(earned|earnings?|so far|total)/i.test(normalized)
  ) {
    return { type: "total_earned" as const, chainId: 8453 as const };
  }
  return { type: "unknown" as const, reason: "No earnings command detected." };
}

function parseNftsRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  if (/(buy|purchase|get|own|mint)/i.test(normalized)) {
    return { type: "unknown" as const, reason: "Buy intent detected." };
  }
  const match = normalized.match(
    /(nft|nfts|collectibles|my nfts|my nft|check my nfts|check my nft|landplot|landplots|plot|plots|my plots|my plot|check my plots|check my plot)/i,
  );

  if (!match) {
    return { type: "unknown" as const, reason: "No NFT command detected." };
  }

  return {
    type: "nfts" as const,
    chainId: 8453 as const,
  };
}

function parseBuyPlotRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  const hasBuyVerb = /(buy|purchase|get|own|mint)/i.test(normalized);
  if (!hasBuyVerb) {
    return { type: "unknown" as const, reason: "No buy command detected." };
  }

  let tier: "Standard" | "Premium" | "Legendary" | null = null;
  if (/legendary/.test(normalized)) tier = "Legendary";
  if (/premium/.test(normalized)) tier = "Premium";
  if (/standard/.test(normalized)) tier = "Standard";

  let size: "100" | "500" | "1000" | null = null;
  if (/(1000|1000\s*m2|1000m²)/.test(normalized)) size = "1000";
  else if (/(500|500\s*m2|500m²)/.test(normalized)) size = "500";
  else if (/(100|100\s*m2|100m²)/.test(normalized)) size = "100";

  if (!tier && size) {
    tier = size === "1000" ? "Legendary" : size === "500" ? "Premium" : "Standard";
  }

  if (!size && tier) {
    size = tier === "Legendary" ? "1000" : tier === "Premium" ? "500" : "100";
  }

  if (!tier || !size) {
    return { type: "unknown" as const, reason: "Plot tier not recognized." };
  }

  return {
    type: "buy_plot" as const,
    tier,
    size,
    chainId: 8453 as const,
  };
}

function fallbackResponse(message: string) {
  const transfer = parseTransferRegex(message);
  if (transfer.type !== "unknown") {
    return {
      reply: "Got it — preparing that transfer now.",
      intent: transfer,
    };
  }

  const balance = parseBalanceRegex(message);
  if (balance.type !== "unknown") {
    return {
      reply: "Got it — checking your Base wallet balances now.",
      intent: balance,
    };
  }

  const buyPlot = parseBuyPlotRegex(message);
  if (buyPlot.type !== "unknown") {
    return {
      reply: `Got it — preparing to buy a ${buyPlot.tier} ${buyPlot.size}m² plot.`,
      intent: buyPlot,
    };
  }

  const nfts = parseNftsRegex(message);
  if (nfts.type !== "unknown") {
    return {
      reply: "Got it — checking your Base NFTs now.",
      intent: nfts,
    };
  }

  const swap = parseSwapRegex(message);
  if (swap.type !== "unknown") {
    return {
      reply: "Got it — preparing that swap now.",
      intent: swap,
    };
  }

  return {
    reply:
      "I can help with swaps (ETH <-> USDC), transfers (ETH/USDC), balances, NFTs, " +
      "or buying plots (Standard 100m², Premium 500m², Legendary 1000m²). " +
      "Try: Buy a Standard 100m² plot.",
    intent: { type: "unknown" as const },
  };
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body. Expected { message: string }" },
      { status: 400 },
    );
  }

  const message = parsed.data.message.trim();
  const history = parsed.data.history ?? [];
  const walletConnected = parsed.data.walletConnected ?? false;
  const address = parsed.data.address ?? "unknown";

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({
      reply:
        "OpenAI API key is not configured on the server. " +
        "Please set OPENAI_API_KEY and restart the dev server.",
      intent: { type: "unknown" as const },
    });
  }

  try {
    const historyText = history
      .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`)
      .join("\n");
    const result = await generateText({
      model: openai("gpt-5.2"),
      system:
        "You are a helpful onchain assistant. " +
        "Be concise, friendly, and accurate. " +
        "You can answer general crypto questions too. " +
        "When answering general questions, keep it short (3-5 lines) and use '-' bullets with line breaks. " +
        "Each bullet must be on its own line, no inline bullets. " +
        "Use HTML <strong> for bold emphasis (not markdown **). " +
        "Start with the direct answer; do not add meta lines like 'To start' unless the user asked for next steps. " +
        "For transaction-related replies, keep it concise and do not use bullets. " +
        "You CAN initiate swaps (ETH <-> USDC) and transfers (ETH/USDC) on Base via the user's connected wallet, " +
        "but the user must approve the transaction in their wallet. " +
        "You CAN check balances and NFTs when a wallet is connected. " +
        "You CAN help buy tokenized plots (Standard 100m², Premium 500m², Legendary 1000m²) on Base. " +
        `Wallet connected: ${walletConnected ? "yes" : "no"}. ` +
        `Connected address: ${address}. ` +
        "Never claim you executed a transaction.",
      prompt: historyText ? `${historyText}\nUser: ${message}` : message,
    });

    let reply = result.text?.trim() || "How can I help?";
    if (reply.includes(" - ")) {
      reply = reply.replace(/\s-\s/g, "\n- ");
    }
    if (reply.includes("**")) {
      reply = reply.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    }

    const balance = parseBalanceRegex(message);
    if (balance.type !== "unknown") {
      reply = walletConnected
        ? "Got it — checking your Base wallet balances now."
        : "Please connect your wallet first so I can check your Base balances.";
      return Response.json({ reply, intent: balance });
    }

    const earnings = parseEarningsRegex(message);
    if (earnings.type !== "unknown") {
      reply = walletConnected
        ? earnings.type === "total_earned"
          ? "Got it — checking your total BCO2 earned now."
          : "Got it — checking your current BCO2 earnings now."
        : "Please connect your wallet first so I can check your BCO2 earnings.";
      return Response.json({ reply, intent: earnings });
    }

    const buyPlot = parseBuyPlotRegex(message);
    if (buyPlot.type !== "unknown") {
      reply = walletConnected
        ? `Got it — preparing to buy a ${buyPlot.tier} ${buyPlot.size}m² plot.`
        : "Please connect your wallet first so I can buy a plot.";
      return Response.json({ reply, intent: buyPlot });
    }

    const nfts = parseNftsRegex(message);
    if (nfts.type !== "unknown") {
      reply = walletConnected
        ? "Got it — checking your Base NFTs now."
        : "Please connect your wallet first so I can check your Base NFTs.";
      return Response.json({ reply, intent: nfts });
    }

    const transfer = parseTransferRegex(message);
    if (transfer.type !== "unknown") {
      reply = "Got it — preparing that transfer now.";
      return Response.json({ reply, intent: transfer });
    }

    const swap = parseSwapRegex(message);
    if (swap.type !== "unknown") {
      reply = "Got it — preparing that swap now.";
      return Response.json({ reply, intent: swap });
    }

    return Response.json({ reply, intent: { type: "unknown" as const } });
  } catch (err: any) {
    const messageText =
      typeof err?.message === "string" && err.message.length
        ? err.message
        : "Unknown error";
    return Response.json({
      reply:
        "OpenAI request failed: " +
        messageText +
        ". Please confirm OPENAI_API_KEY is valid and restart the dev server.",
      intent: { type: "unknown" as const },
    });
  }
}
