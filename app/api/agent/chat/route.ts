import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
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
    type: z.literal("claim_bco2"),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("leaderboard_rank"),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("leaderboard_top"),
    count: z.number().min(1).max(50),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("btg_claim"),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("stake"),
    tokenIds: z.array(z.number()).optional(),
    stakeAll: z.boolean().optional(),
    tier: z.enum(["Legendary", "Premium", "Standard"]).optional(),
    chainId: z.literal(8453),
  }),
  z.object({
    type: z.literal("unstake"),
    tokenIds: z.array(z.number()).optional(),
    unstakeAll: z.boolean().optional(),
    tier: z.enum(["Legendary", "Premium", "Standard"]).optional(),
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
type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

const GUIDE_DIR = path.join(process.cwd(), "shared", "data", "agent");
let guideTextCache: string | null = null;

async function loadBitgrassGuide() {
  if (guideTextCache !== null) return guideTextCache;
  try {
    const files = await readdir(GUIDE_DIR);
    const textFiles = files.filter((name) => name.toLowerCase().endsWith(".txt")).sort();
    if (!textFiles.length) {
      guideTextCache = "";
      return "";
    }

    const contents = await Promise.all(
      textFiles.map(async (name) => {
        const filePath = path.join(GUIDE_DIR, name);
        const content = await readFile(filePath, "utf8");
        return `# Source: ${name}\n${content}`;
      }),
    );
    const combined = contents.join("\n\n");
    guideTextCache = combined;
    return combined;
  } catch {
    guideTextCache = "";
    return "";
  }
}

function tokenizeSearchTerms(input: string) {
  const stopwords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "my",
    "of",
    "on",
    "or",
    "the",
    "to",
    "what",
    "when",
    "where",
    "with",
    "you",
    "your",
  ]);

  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopwords.has(word));
}

function expandSearchTerms(terms: string[]) {
  const synonyms: Record<string, string[]> = {
    portfolio: ["assets", "wallet", "holdings"],
    transactions: ["history", "activity", "tx"],
    leaderboard: ["rank", "ranking", "claimable", "btg"],
    btg: ["reward", "rewards", "claimable"],
    staking: ["stake", "unstake", "apy"],
    plot: ["plots", "landplot", "landplots", "nft", "nfts"],
    swap: ["exchange", "trade"],
    earnings: ["earned", "bco2", "rewards"],
  };

  const out = new Set<string>(terms);
  for (const term of terms) {
    const extras = synonyms[term];
    if (extras) {
      for (const item of extras) out.add(item);
    }
  }
  return Array.from(out);
}

function buildGuideContext(question: string, guideText: string, maxSnippets = 4) {
  if (!guideText.trim()) return "";

  const blocks = guideText
    .split(/(?:\r?\n|`n)+/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 40);
  if (!blocks.length) return "";

  const questionNorm = question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const terms = expandSearchTerms(tokenizeSearchTerms(question));
  if (!terms.length) return "";

  const scored = blocks
    .map((block) => {
      const lower = block.toLowerCase();
      const uniqueHits = terms.filter((term) => lower.includes(term));
      const exactPhraseBoost =
        questionNorm.length >= 12 && lower.includes(questionNorm.slice(0, 48)) ? 4 : 0;
      const score = uniqueHits.length + exactPhraseBoost;
      return { block, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return "";

  return scored
    .slice(0, maxSnippets)
    .map((item, index) => `[Guide ${index + 1}] ${item.block}`)
    .join("\n");
}

function isBitgrassDocsQuestion(message: string) {
  const normalized = message.trim().toLowerCase();
  return /(bitgrass|portfolio|leaderboard|own plot|landplot|plot|plots|staking|claim|bco2|btg|dashboard|projects|swap)/i.test(
    normalized,
  );
}

type IntentKind = ParsedIntent["type"];

function isInformationalForIntent(message: string, intentType: IntentKind) {
  const normalized = message.trim().toLowerCase();

  // NFT checks should only execute for explicit ownership/account requests.
  if (intentType === "nfts") {
    const explicitNftAccountQuery =
      /\b(check|show|get|list|fetch|view)\b.*\b(my|wallet|owned|own|have)\b.*\b(nft|nfts|plot|plots|landplot|landplots)\b/i.test(
        normalized,
      ) ||
      /\b(my|wallet|owned|own|have)\b.*\b(nft|nfts|plot|plots|landplot|landplots)\b/i.test(
        normalized,
      );
    return !explicitNftAccountQuery;
  }

  const educationalCue =
    /\bhow to\b|\bhow do i\b|\bhow can i\b|\bexplain\b|\bguide me\b|\btutorial\b|\bsteps?\b|\bwalk me through\b|\btell me about\b|\bwhen should i\b|\bwhy\b/i.test(
      normalized,
    );

  if (!educationalCue) return false;

  // Read intents should still execute when user asks for their own current state.
  if (
    intentType === "balance" ||
    intentType === "current_earnings" ||
    intentType === "total_earned" ||
    intentType === "leaderboard_rank" ||
    intentType === "leaderboard_top" ||
    intentType === "btg_claim"
  ) {
    const directAccountQuery =
      /\b(check|show|get|fetch|what(?:'s| is)|how much)\b.*\b(my|me|mine|wallet|balance|earning|earnings|bco2|nft|nfts|plot|plots|rank|claimed)\b/i.test(
        normalized,
      );
    if (directAccountQuery) return false;
  }

  return true;
}

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
    /(balance|balances|wallet balance|check balance|check my balance|check my wallet|can you check my balance|what is my balance|what's my balance|show my balance|how much (eth|usdc).*(do i have|i have)|how.*(much|many)?.*(have|got).*(wallet|wllaet|wallet|account)|check all|show all assets|check all assets|check everything in my wallet)/i,
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
    /(earn|earning).*(current|now|pending|unclaimed)/i.test(normalized) ||
    /(what is|what's|can you check|check).*(my)?.*(current|pending|unclaimed).*(earn|earning|bco2|bc02)/i.test(normalized)
  ) {
    return { type: "current_earnings" as const, chainId: 8453 as const };
  }
  if (
    /(total|overall|all time).*(earn|earned|earning|bco2|bc02)/i.test(normalized) ||
    /(how much).*(earned|earn|earning|bco2|bc02)/i.test(normalized) ||
    /(earned|earnings?)\s*(bco2|bc02)/i.test(normalized) ||
    /(total|overall|all time)\s*(bco2|bc02)/i.test(normalized) ||
    /(bco2|bc02).*(earned|earnings?|so far|total)/i.test(normalized) ||
    /(what is|what's|can you check|check).*(my)?.*(total|overall|all time).*(earn|earning|earned|bco2|bc02)/i.test(normalized)
  ) {
    return { type: "total_earned" as const, chainId: 8453 as const };
  }
  return { type: "unknown" as const, reason: "No earnings command detected." };
}

function parseNftsRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  if (/(unstake|unstaek|unstaking|withdraw)/i.test(normalized)) {
    return { type: "unknown" as const, reason: "Unstake command detected." };
  }
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

function parseClaimRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  const match = normalized.match(
    /(claim|collect|withdraw)\s*(my)?\s*(bco2|bc02|rewards|earnings)/i,
  );

  if (!match) {
    return { type: "unknown" as const, reason: "No claim command detected." };
  }

  return { type: "claim_bco2" as const, chainId: 8453 as const };
}

function parseLeaderboardRankRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  const match = normalized.match(
    /(leaderboard|rank|ranking|position).*(me|my|mine)?/i,
  );

  if (!match) {
    return { type: "unknown" as const, reason: "No leaderboard rank command detected." };
  }

  return { type: "leaderboard_rank" as const, chainId: 8453 as const };
}

function parseLeaderboardTopRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  const match = normalized.match(/top\s*(\d+)\s*(leaderboard|ranks|ranking|rankings|users)?/i);
  if (!match) {
    return { type: "unknown" as const, reason: "No leaderboard top command detected." };
  }
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) {
    return { type: "unknown" as const, reason: "Invalid top count." };
  }
  return {
    type: "leaderboard_top" as const,
    count: Math.min(50, Math.max(1, Math.floor(count))),
    chainId: 8453 as const,
  };
}

function parseBtgClaimRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  if (/(bco2|bc02)/i.test(normalized)) {
    return { type: "unknown" as const, reason: "BCO2 mention detected." };
  }
  const match = normalized.match(
    /(btg).*(claim|claimed|rewards?|earnings?|balance|amount)|((claim|claimed).*(btg))/i,
  );

  if (!match) {
    return { type: "unknown" as const, reason: "No BTG claim command detected." };
  }

  return { type: "btg_claim" as const, chainId: 8453 as const };
}

function parseStakeRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  if (/(unstake|unstaking|withdraw)/i.test(normalized)) {
    return { type: "unknown" as const, reason: "Unstake command detected." };
  }
  if (!/(stake|staking)/i.test(normalized)) {
    return { type: "unknown" as const, reason: "No stake command detected." };
  }

  const tierMatch = normalized.match(/(legendary|premium|standard)/i);
  const tier = tierMatch?.[1]
    ? (tierMatch[1][0].toUpperCase() + tierMatch[1].slice(1)) as
        | "Legendary"
        | "Premium"
        | "Standard"
    : undefined;

  const allMatch = normalized.match(/stake\s+(all|max)(?:\s+my)?/i);
  if (allMatch) {
    return { type: "stake" as const, stakeAll: true, tier, chainId: 8453 as const };
  }

  const idMatch = normalized.match(/(?:plot|landplot|land|nft).*?(\d{1,6})/i);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (!Number.isNaN(id) && id > 0) {
      return { type: "stake" as const, tokenIds: [id], chainId: 8453 as const };
    }
  }

  if (/(plot|landplot|land|nft)/i.test(normalized)) {
    return { type: "stake" as const, chainId: 8453 as const };
  }

  return { type: "unknown" as const, reason: "No stake id detected." };
}

function parseUnstakeRegex(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!/(unstake|unstaek|unstaking|withdraw)/i.test(normalized)) {
    return { type: "unknown" as const, reason: "No unstake command detected." };
  }

  const tierMatch = normalized.match(/(legendary|premium|standard)/i);
  const tier = tierMatch?.[1]
    ? (tierMatch[1][0].toUpperCase() + tierMatch[1].slice(1)) as
        | "Legendary"
        | "Premium"
        | "Standard"
    : undefined;

  const allMatch = normalized.match(/(unstake|unstaek|withdraw)\s+(all|max)(?:\s+my)?/i);
  if (allMatch) {
    return { type: "unstake" as const, unstakeAll: true, tier, chainId: 8453 as const };
  }

  const idMatch = normalized.match(/(?:plot|landplot|land|nft).*?(\d{1,6})/i);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (!Number.isNaN(id) && id > 0) {
      return { type: "unstake" as const, tokenIds: [id], chainId: 8453 as const };
    }
  }

  return { type: "unknown" as const, reason: "No unstake id detected." };
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

function isPortfolioTransactionsQuestion(message: string) {
  const normalized = message.trim().toLowerCase();
  const asksPortfolio = /(portfolio|assets tab|portfolio page)/i.test(normalized);
  const asksTransactions = /(transaction|transactions|history|activity)/i.test(normalized);
  return asksPortfolio && asksTransactions;
}

function isWhereTransactionsQuestion(message: string) {
  const normalized = message.trim().toLowerCase();
  const asksTransactions = /(transaction|transactions|history|activity)/i.test(normalized);
  const asksWhere = /\b(where|see|find|show)\b/i.test(normalized);
  return asksTransactions && asksWhere;
}

function isOwnPlotQuestion(message: string) {
  const normalized = message.trim().toLowerCase();
  const asksOwnPlot = /(own plot|ownplot)/i.test(normalized);
  const asksMeaning = /\b(what is|what's|explain|about|mean)\b/i.test(normalized);
  return asksOwnPlot && asksMeaning;
}

function isBtgClaimFormulaQuestion(message: string) {
  const normalized = message.trim().toLowerCase();
  const asksBtg = /(btg|claimable|claimed)/i.test(normalized);
  const asksFormula =
    /\b(what is|what's|how|calculated|calculate|formula|why|explain)\b/i.test(normalized);
  return asksBtg && asksFormula;
}

function getPlotDefinitionReply(message: string) {
  const normalized = message.trim().toLowerCase();
  const asksDefinition = /\b(what is|what's|explain|define|meaning|describe|details)\b/i.test(
    normalized,
  );
  const shortTierPrompt =
    /^\s*(standard|premium|legendary)\s*(plot|tier)?\s*\??\s*$/i.test(normalized) ||
    /\b(explain me|tell me about)\b.*\b(standard|premium|legendary)\b.*\b(plot|tier)?/i.test(
      normalized,
    );
  if (!asksDefinition && !shortTierPrompt) return null;

  const asksAllTiers =
    /\bstandard\b/i.test(normalized) &&
    /\bpremium\b/i.test(normalized) &&
    /\blegendary\b/i.test(normalized);
  if (asksAllTiers) {
    return (
      "Bitgrass has 3 plot tiers: " +
      "Standard (100m², 0.05 ETH, supply 2000, up to 0.1 tCO2/year, 5,000 BTG early-adopter reward), " +
      "Premium (500m², 0.2 ETH, supply 800, up to 0.1 tCO2/year, 20,000 BTG), " +
      "Legendary (1000m², 0.35 ETH, supply 400, up to 0.1 tCO2/year, 35,000 BTG)."
    );
  }

  if (/\bstandard\b(?:.*\bplot\b)?|\bplot\b.*\bstandard\b/i.test(normalized)) {
    return "A Standard plot is the 100m² Bitgrass land NFT tier: 0.05 ETH, supply 2000, carbon removal potential up to 0.1 tCO2/year, and 5,000 BTG early-adopter reward per eligible NFT.";
  }
  if (/\bpremium\b(?:.*\bplot\b)?|\bplot\b.*\bpremium\b/i.test(normalized)) {
    return "A Premium plot is the 500m² Bitgrass land NFT tier: 0.2 ETH, supply 800, carbon removal potential up to 0.1 tCO2/year, and 20,000 BTG early-adopter reward per eligible NFT.";
  }
  if (/\blegendary\b(?:.*\bplot\b)?|\bplot\b.*\blegendary\b/i.test(normalized)) {
    return "A Legendary plot is the 1000m² Bitgrass land NFT tier: 0.35 ETH, supply 400, carbon removal potential up to 0.1 tCO2/year, and 35,000 BTG early-adopter reward per eligible NFT.";
  }
  return null;
}

function getTierBco2EducationReply(message: string) {
  const normalized = message.trim().toLowerCase();

  const asksTierDiff =
    /(difference|diff|compare|comparison|between|tiers|categories)/i.test(normalized) &&
    /(plot|plots|standard|premium|legendary|tier|category)/i.test(normalized);

  const asksBco2Meaning = /(what is|what's|explain|define|meaning)/i.test(normalized) &&
    /(bco2|bc02|carbon credit|carbon credits)/i.test(normalized);

  const asksHowToEarnBco2 =
    /(how can i|how to|how do i|ways to|earn|get)/i.test(normalized) &&
    /(bco2|bc02|carbon credit|carbon credits)/i.test(normalized);

  if (!asksTierDiff && !asksBco2Meaning && !asksHowToEarnBco2) return null;

  const tierSummary =
    "Plot tiers: Standard (100m², 0.05 ETH, supply 2000), Premium (500m², 0.2 ETH, supply 800), Legendary (1000m², 0.35 ETH, supply 400).";
  const bco2Summary =
    "BCO2 represents carbon-credit rewards linked to your tokenized land plots and their carbon-removal potential.";
  const earnFlow =
    "How to earn BCO2: own a plot, stake it in the staking portal, then claim accrued BCO2 rewards from staking.";
  const capacity =
    "Per current guide data, each tier lists carbon removal potential up to 0.1 tCO2/year.";

  return [tierSummary, bco2Summary, earnFlow, capacity].join(" ");
}

function fallbackResponse(message: string) {
  const transfer = parseTransferRegex(message);
  if (transfer.type !== "unknown") {
    return {
      reply: "Got it - preparing that transfer now.",
      intent: transfer,
    };
  }

  const balance = parseBalanceRegex(message);
  if (balance.type !== "unknown") {
    return {
      reply: "Got it - checking your Base wallet balances now.",
      intent: balance,
    };
  }

  const buyPlot = parseBuyPlotRegex(message);
  if (buyPlot.type !== "unknown") {
    return {
      reply: `Got it - preparing to buy a ${buyPlot.tier} ${buyPlot.size}m² plot.`,
      intent: buyPlot,
    };
  }

  const nfts = parseNftsRegex(message);
  if (nfts.type !== "unknown") {
    return {
      reply: "Got it - checking your Base NFTs now.",
      intent: nfts,
    };
  }

  const swap = parseSwapRegex(message);
  if (swap.type !== "unknown") {
    return {
      reply: "Got it - preparing that swap now.",
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
    const guideText = await loadBitgrassGuide();
    const guideContext = buildGuideContext(message, guideText);
    const isDocsQuestion = isBitgrassDocsQuestion(message);

    if (isPortfolioTransactionsQuestion(message)) {
      return Response.json({
        reply:
          "Yes. In Portfolio, open the Transactions tab (the third tab) to see your transaction history, including type, value, date/time, and a View Transaction link.",
        intent: { type: "unknown" as const },
      });
    }

    if (isWhereTransactionsQuestion(message)) {
      return Response.json({
        reply:
          "You can see transactions in two places: Portfolio -> Transactions tab, and your wallet Activity (or BaseScan) for full onchain details.",
        intent: { type: "unknown" as const },
      });
    }

    if (isOwnPlotQuestion(message)) {
      return Response.json({
        reply:
          "Own Plot is the page for discovering and buying Bitgrass tokenized land plots (Standard, Premium, Legendary). After purchase, your plots appear in Portfolio (NFTs tab) where you can manage owned assets.",
        intent: { type: "unknown" as const },
      });
    }

    if (isBtgClaimFormulaQuestion(message)) {
      return Response.json({
        reply:
          "Claimable BTG is the amount available to claim from leaderboard rewards. " +
          "It is calculated from your eligible early-adopter plots: Standard = 5,000 BTG each, " +
          "Premium = 20,000 BTG each, Legendary = 35,000 BTG each. " +
          "Example: 8 Standard + 1 Premium + 1 Legendary = 95,000 BTG.",
        intent: { type: "unknown" as const },
      });
    }

    const plotDefinitionReply = getPlotDefinitionReply(message);
    if (plotDefinitionReply) {
      return Response.json({
        reply: plotDefinitionReply,
        intent: { type: "unknown" as const },
      });
    }

    const tierBco2EducationReply = getTierBco2EducationReply(message);
    if (tierBco2EducationReply) {
      return Response.json({
        reply: tierBco2EducationReply,
        intent: { type: "unknown" as const },
      });
    }

    const claim = parseClaimRegex(message);
    if (claim.type !== "unknown" && !isInformationalForIntent(message, claim.type)) {
      const reply = walletConnected
        ? "Got it - claiming your BCO2 rewards now."
        : "Please connect your wallet first so I can claim your BCO2 rewards.";
      return Response.json({ reply, intent: claim });
    }

    const leaderboardTop = parseLeaderboardTopRegex(message);
    if (
      leaderboardTop.type !== "unknown" &&
      !isInformationalForIntent(message, leaderboardTop.type)
    ) {
      const reply = "Got it - fetching the top leaderboard now.";
      return Response.json({ reply, intent: leaderboardTop });
    }

    const leaderboardRank = parseLeaderboardRankRegex(message);
    if (
      leaderboardRank.type !== "unknown" &&
      !isInformationalForIntent(message, leaderboardRank.type)
    ) {
      const reply = walletConnected
        ? "Got it - checking your leaderboard rank now."
        : "Please connect your wallet first so I can check your leaderboard rank.";
      return Response.json({ reply, intent: leaderboardRank });
    }

    const btgClaim = parseBtgClaimRegex(message);
    if (btgClaim.type !== "unknown" && !isInformationalForIntent(message, btgClaim.type)) {
      const reply = walletConnected
        ? "Got it - checking your claimed BTG amount now."
        : "Please connect your wallet first so I can check your claimed BTG amount.";
      return Response.json({ reply, intent: btgClaim });
    }

    // Deterministic executable intents should run before LLM chat responses.
    const earnings = parseEarningsRegex(message);
    if (earnings.type !== "unknown" && !isInformationalForIntent(message, earnings.type)) {
      const reply = walletConnected
        ? earnings.type === "total_earned"
          ? "Got it - checking your total BCO2 earned now."
          : "Got it - checking your current BCO2 earnings now."
        : "Please connect your wallet first so I can check your BCO2 earnings.";
      return Response.json({ reply, intent: earnings });
    }

    const balance = parseBalanceRegex(message);
    if (balance.type !== "unknown" && !isInformationalForIntent(message, balance.type)) {
      const reply = walletConnected
        ? "Got it - checking your Base wallet balances now."
        : "Please connect your wallet first so I can check your Base balances.";
      return Response.json({ reply, intent: balance });
    }

    const buyPlot = parseBuyPlotRegex(message);
    if (buyPlot.type !== "unknown" && !isInformationalForIntent(message, buyPlot.type)) {
      const reply = walletConnected
        ? `Got it - preparing to buy a ${buyPlot.tier} ${buyPlot.size}m² plot.`
        : "Please connect your wallet first so I can buy a plot.";
      return Response.json({ reply, intent: buyPlot });
    }

    const stake = parseStakeRegex(message);
    if (stake.type !== "unknown" && !isInformationalForIntent(message, stake.type)) {
      const reply = walletConnected
        ? "Got it - preparing to stake your land plots now."
        : "Please connect your wallet first so I can stake your land plots.";
      return Response.json({ reply, intent: stake });
    }

    const unstake = parseUnstakeRegex(message);
    if (unstake.type !== "unknown" && !isInformationalForIntent(message, unstake.type)) {
      const reply = walletConnected
        ? "Got it - preparing to unstake your land plots now."
        : "Please connect your wallet first so I can unstake your land plots.";
      return Response.json({ reply, intent: unstake });
    }

    const nfts = parseNftsRegex(message);
    if (nfts.type !== "unknown" && !isInformationalForIntent(message, nfts.type)) {
      const reply = walletConnected
        ? "Got it - checking your Base NFTs now."
        : "Please connect your wallet first so I can check your Base NFTs.";
      return Response.json({ reply, intent: nfts });
    }

    const transfer = parseTransferRegex(message);
    if (transfer.type !== "unknown" && !isInformationalForIntent(message, transfer.type)) {
      const reply = "Got it - preparing that transfer now.";
      return Response.json({ reply, intent: transfer });
    }

    const swap = parseSwapRegex(message);
    if (swap.type !== "unknown" && !isInformationalForIntent(message, swap.type)) {
      const reply = "Got it - preparing that swap now.";
      return Response.json({ reply, intent: swap });
    }

    if (isDocsQuestion && !guideContext) {
      // Allow a normal assistant response style; avoid exposing retrieval internals to end users.
    }

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
        "You CAN claim BCO2 rewards for staked land plots when asked. " +
        "You CAN stake and unstake land plots (Legendary/Premium/Standard) when asked. " +
        "You CAN help buy tokenized plots (Standard 100m², Premium 500m², Legendary 1000m²) on Base. " +
        "If the user asks about Bitgrass modules/features/how-to usage, use the provided Bitgrass guide context as primary source. " +
        "Do not invent module details that are not in the guide context. " +
        "If context is present, prefer it over prior assumptions. " +
        `Wallet connected: ${walletConnected ? "yes" : "no"}. ` +
        `Connected address: ${address}. ` +
        "Never claim you executed a transaction.",
      prompt:
        (historyText ? `${historyText}\n` : "") +
        (guideContext ? `Bitgrass guide context:\n${guideContext}\n\n` : "") +
        `User: ${message}`,
    });

    let reply = result.text?.trim() || "How can I help?";
    if (reply.includes(" - ")) {
      reply = reply.replace(/\s-\s/g, "\n- ");
    }
    if (reply.includes("**")) {
      reply = reply.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
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

