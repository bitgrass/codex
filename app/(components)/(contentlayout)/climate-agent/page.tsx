"use client";

import Seo from "@/shared/layout-components/seo/seo";
import React, { Fragment, useEffect, useRef, useState } from "react";
import { useConnectedAddress } from "../useConnectedAddress";
import { buildSwapTransaction } from "@coinbase/onchainkit/api";
import type { Token } from "@coinbase/onchainkit/token";
import { formatUnits, isAddress, parseUnits } from "viem";
import { Seaport } from "@opensea/seaport-js";
import { ethers } from "ethers";
import {
  CONTRACT_ADDRESS_INFO,
  SEADROP_ADDRESS_INFO,
  SEADROP_CONDUIT_INFO,
  SeaDropABIData,
} from "@/shared/data/tokens/data";

type ChatStatus = "pending" | "success" | "error";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: ChatStatus;
  txHash?: string;
  nfts?: {
    id: string;
    name: string;
    tokenId: string;
    image: string | null;
    collectionName?: string | null;
  }[];
  nftTruncated?: boolean;
};

const BASE_CHAIN_ID = 8453;

const ETH_TOKEN: Token = {
  name: "ETH",
  address: "",
  symbol: "ETH",
  decimals: 18,
  image: null,
  chainId: BASE_CHAIN_ID,
};

const USDC_TOKEN: Token = {
  name: "USDC",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC",
  decimals: 6,
  image: null,
  chainId: BASE_CHAIN_ID,
};

type ParsedIntent =
  | {
      type: "swap";
      amount: string;
      fromSymbol: "ETH";
      toSymbol: "USDC";
      chainId: 8453;
    }
  | {
      type: "transfer";
      amount: string;
      symbol: "ETH" | "USDC";
      toAddress: `0x${string}`;
      chainId: 8453;
    }
  | {
      type: "balance";
      chainId: 8453;
    }
  | {
      type: "nfts";
      chainId: 8453;
    }
  | {
      type: "buy_plot";
      tier: "Standard" | "Premium" | "Legendary";
      size: "100" | "500" | "1000";
      chainId: 8453;
    }
  | { type: "unknown"; reason?: string };

type AgentResponse = {
  reply: string;
  intent: ParsedIntent;
};

function isApiError(value: any): value is { code: string; error: string; message: string } {
  return (
    value &&
    typeof value === "object" &&
    typeof value.code === "string" &&
    typeof value.error === "string" &&
    typeof value.message === "string"
  );
}

function bigintToHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

function safeFormatUnits(value: string, decimals: number) {
  if (value.includes(".")) return value;
  try {
    return formatUnits(BigInt(value), decimals);
  } catch {
    return value;
  }
}

function parseTransferLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  const match = normalized.match(
    /(send|transfer)\s+([\d.]+)\s*(eth|usdc)\s+to\s+(0x[a-f0-9]{40})/i,
  );

  if (!match) return null;

  const amount = match[2];
  const symbol = match[3]?.toUpperCase();
  const toAddress = match[4] as `0x${string}`;

  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) return null;
  if (symbol !== "ETH" && symbol !== "USDC") return null;

  return {
    type: "transfer",
    amount,
    symbol: symbol as "ETH" | "USDC",
    toAddress,
    chainId: 8453,
  };
}

function parseBalanceLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  const match = normalized.match(
    /(balance|balances|wallet balance|check balance|check my balance|check my wallet)/i,
  );
  if (!match) return null;
  return { type: "balance", chainId: 8453 };
}

function parseNftsLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (/(buy|purchase|get|own|mint)/i.test(normalized)) return null;
  const match = normalized.match(
    /(nft|nfts|collectibles|my nfts|my nft|check my nfts|check my nft)/i,
  );
  if (!match) return null;
  return { type: "nfts", chainId: 8453 };
}

function parseBuyPlotLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  const hasBuyVerb = /(buy|purchase|get|own|mint)/i.test(normalized);
  if (!hasBuyVerb) return null;

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

  if (!tier || !size) return null;

  return {
    type: "buy_plot",
    tier,
    size,
    chainId: 8453,
  };
}

function normalizeIpfsUrl(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("ipfs://ipfs/")) {
    return value.replace("ipfs://ipfs/", "https://ipfs.io/ipfs/");
  }
  if (value.startsWith("ipfs://")) {
    return value.replace("ipfs://", "https://ipfs.io/ipfs/");
  }
  return value;
}

async function getEthBalance(
  walletClient: any,
  account: `0x${string}`,
): Promise<bigint | null> {
  if (!walletClient?.request) return null;
  try {
    const hex = (await walletClient.request({
      method: "eth_getBalance",
      params: [account, "latest"],
    })) as string;
    return BigInt(hex);
  } catch {
    return null;
  }
}

async function getErc20Balance(
  walletClient: any,
  tokenAddress: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint | null> {
  if (!walletClient?.request) return null;
  try {
    const data = `0x70a08231${account.slice(2).padStart(64, "0")}`;
    const hex = (await walletClient.request({
      method: "eth_call",
      params: [{ to: tokenAddress, data }, "latest"],
    })) as string;
    return BigInt(hex);
  } catch {
    return null;
  }
}

async function prepareTransferTx(params: {
  symbol: "ETH" | "USDC";
  amount: string;
  toAddress: `0x${string}`;
  fromAddress: `0x${string}`;
  walletClient: any;
}) {
  const { symbol, amount, toAddress, fromAddress, walletClient } = params;

  if (!isAddress(toAddress)) {
    return { error: "Invalid recipient address." as const };
  }

  let rawAmount: bigint;
  try {
    rawAmount = parseUnits(amount, symbol === "ETH" ? 18 : 6);
  } catch {
    return { error: "Invalid transfer amount." as const };
  }

  if (rawAmount <= 0n) {
    return { error: "Amount must be greater than 0." as const };
  }

  if (symbol === "ETH") {
    const balance = await getEthBalance(walletClient, fromAddress);
    if (balance !== null && balance < rawAmount) {
      return { error: "Insufficient ETH balance." as const };
    }

    return {
      tx: {
        to: toAddress,
        data: "0x" as const,
        value: rawAmount,
      },
    };
  }

  const balance = await getErc20Balance(walletClient, USDC_TOKEN.address as `0x${string}`, fromAddress);
  if (balance !== null && balance < rawAmount) {
    return { error: "Insufficient USDC balance." as const };
  }

  const data = `0xa9059cbb${toAddress.slice(2).padStart(64, "0")}${rawAmount
    .toString(16)
    .padStart(64, "0")}` as `0x${string}`;

  return {
    tx: {
      to: USDC_TOKEN.address as `0x${string}`,
      data,
      value: 0n,
    },
  };
}

async function fetchWalletNfts(address: `0x${string}`) {
  const apiKey = process.env.NEXT_PUBLIC_MORALIS_APY_KEY;
  if (!apiKey) {
    throw new Error("Moralis API key is not configured.");
  }

  const MAX_ITEMS = 200;
  const PAGE_SIZE = 50;

  let cursor: string | null = null;
  const allItems: any[] = [];

  do {
    const params = new URLSearchParams({
      chain: "base",
      format: "decimal",
      normalizeMetadata: "true",
      media_items: "false",
      include_prices: "false",
      limit: PAGE_SIZE.toString(),
    });
    if (cursor) params.append("cursor", cursor);

    const url = `https://deep-index.moralis.io/api/v2.2/${address}/nft?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch NFTs.");
    }

    const data = await res.json();
    const items = Array.isArray(data?.result) ? data.result : [];
    allItems.push(...items);
    cursor = data?.cursor || null;
  } while (cursor && allItems.length < MAX_ITEMS);

  const truncated = Boolean(cursor && allItems.length >= MAX_ITEMS);

  return { items: allItems, truncated };
}

function getTierRange(tier: "Premium" | "Legendary") {
  if (tier === "Legendary") return { min: 1, max: 400 };
  return { min: 401, max: 1200 };
}

async function fetchListingForTier(tier: "Premium" | "Legendary") {
  const collection = process.env.NEXT_PUBLIC_OPENSEA_COLLECTION;
  const apiKey = process.env.NEXT_PUBLIC_OPENSEA_API_KEY;
  const openseaAddress = process.env.NEXT_PUBLIC_OPENSEA_ADDRESS;

  if (!collection || !apiKey || !openseaAddress) {
    throw new Error("OpenSea config is missing. Please set OPENSEA env vars.");
  }

  const { min, max } = getTierRange(tier);
  let cursor: string | null = null;
  let pagesChecked = 0;
  const MAX_PAGES = 5;

  while (pagesChecked < MAX_PAGES) {
    const params = new URLSearchParams({ collection });
    if (cursor) params.set("next", cursor);
    const res = await fetch(`/api/opensea-listings?${params.toString()}`, {
      headers: { "api-key": apiKey },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch OpenSea listings.");
    }

    const data = await res.json();
    const listings = Array.isArray(data?.listings) ? data.listings : [];

    const match = listings.find((listing: any) => {
      const offerer = listing?.protocol_data?.parameters?.offerer;
      const tokenIdRaw = listing?.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria;
      const tokenId = tokenIdRaw ? Number(tokenIdRaw) : NaN;
      return (
        offerer?.toLowerCase?.() === openseaAddress.toLowerCase() &&
        Number.isFinite(tokenId) &&
        tokenId >= min &&
        tokenId <= max
      );
    });

    if (match) return match;

    cursor = data?.next || null;
    pagesChecked += 1;
    if (!cursor) break;
  }

  return null;
}

async function buildStandardMintTx(address: `0x${string}`) {
  const CONTRACT_ADDRESS = CONTRACT_ADDRESS_INFO;
  const SEADROP_ADDRESS = SEADROP_ADDRESS_INFO;
  const SEADROP_CONDUIT = SEADROP_CONDUIT_INFO;
  const SeaDropABI = SeaDropABIData as any;

  const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
  const readSeaDrop = new ethers.Contract(SEADROP_ADDRESS, SeaDropABI, provider);
  const publicDrop = await readSeaDrop.getPublicDrop(CONTRACT_ADDRESS);
  const mintPrice: bigint = BigInt(publicDrop.mintPrice);
  const quantity = 1n;
  const totalPrice = mintPrice * quantity;

  const iface = new ethers.Interface(SeaDropABI);
  const calldata = iface.encodeFunctionData("mintPublic", [
    CONTRACT_ADDRESS,
    SEADROP_CONDUIT,
    address,
    Number(quantity),
  ]) as `0x${string}`;

  return {
    to: SEADROP_ADDRESS as `0x${string}`,
    data: calldata,
    value: totalPrice,
  };
}

async function buildPremiumLegendaryTx(params: {
  order: any;
  buyerAddress: `0x${string}`;
}) {
  const { order, buyerAddress } = params;
  const apiKey = process.env.NEXT_PUBLIC_OPENSEA_API_KEY;
  if (!apiKey) {
    throw new Error("OpenSea API key is missing.");
  }

  const fulfillmentRes = await fetch("https://api.opensea.io/api/v2/listings/fulfillment_data", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      listing: {
        hash: order.order_hash,
        chain: "base",
        protocol_address: order.protocol_address,
      },
      fulfiller: { address: buyerAddress },
    }),
  });

  if (!fulfillmentRes.ok) {
    throw new Error("Failed to get fulfillment data from OpenSea.");
  }

  const fulfillmentResponse = await fulfillmentRes.json();
  const { fulfillment_data } = fulfillmentResponse;

  if (!fulfillment_data?.transaction?.input_data) {
    throw new Error("Invalid fulfillment data from OpenSea.");
  }

  const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
  const seaport = new Seaport(provider, {
    overrides: { contractAddress: order.protocol_address },
  });

  const isBasicOrder = Boolean(fulfillment_data.transaction.input_data.parameters);
  const isAdvancedOrder = Boolean(fulfillment_data.transaction.input_data.advancedOrder);

  let advancedOrder = fulfillment_data.transaction.input_data.advancedOrder;
  if (!advancedOrder && isBasicOrder && fulfillment_data.orders?.[0]) {
    const orderData = fulfillment_data.orders[0];
    advancedOrder = {
      parameters: orderData.parameters,
      signature: orderData.signature,
      numerator: 1,
      denominator: 1,
      extraData: "0x",
    };
  }

  if (!advancedOrder) {
    throw new Error("Invalid order data from OpenSea.");
  }

  const parameters = advancedOrder.parameters;
  const value = (parameters.consideration || [])
    .filter((i: any) => i.token === ethers.ZeroAddress)
    .reduce((sum: bigint, i: any) => sum + BigInt(i.startAmount), BigInt(0));

  let calldata: `0x${string}`;
  let transactionValue: bigint = value;

  if (isBasicOrder) {
    const basicOrderParams = fulfillment_data.transaction.input_data.parameters;
    const basicOrderParameters = {
      considerationToken: basicOrderParams.considerationToken,
      considerationIdentifier: basicOrderParams.considerationIdentifier,
      considerationAmount: basicOrderParams.considerationAmount,
      offerer: basicOrderParams.offerer,
      zone: basicOrderParams.zone,
      offerToken: basicOrderParams.offerToken,
      offerIdentifier: basicOrderParams.offerIdentifier,
      offerAmount: basicOrderParams.offerAmount,
      basicOrderType: basicOrderParams.basicOrderType,
      startTime: basicOrderParams.startTime,
      endTime: basicOrderParams.endTime,
      zoneHash: basicOrderParams.zoneHash,
      salt: basicOrderParams.salt,
      offererConduitKey: basicOrderParams.offererConduitKey,
      fulfillerConduitKey: basicOrderParams.fulfillerConduitKey,
      totalOriginalAdditionalRecipients: basicOrderParams.totalOriginalAdditionalRecipients,
      additionalRecipients: basicOrderParams.additionalRecipients,
      signature: basicOrderParams.signature,
    };
    calldata = seaport.contract.interface.encodeFunctionData("fulfillBasicOrder", [
      basicOrderParameters,
    ]) as `0x${string}`;
    transactionValue = BigInt(fulfillment_data.transaction.value || value);
  } else {
    const criteriaResolvers = fulfillment_data.transaction.input_data.criteriaResolvers || [];
    const fulfillerConduitKey = fulfillment_data.transaction.input_data.fulfillerConduitKey;
    const recipient = fulfillment_data.transaction.input_data.recipient;
    calldata = seaport.contract.interface.encodeFunctionData("fulfillAdvancedOrder", [
      advancedOrder,
      criteriaResolvers,
      fulfillerConduitKey,
      recipient,
    ]) as `0x${string}`;
  }

  return {
    to: seaport.contract.target as `0x${string}`,
    data: calldata,
    value: transactionValue,
  };
}

const ClimateAgentPage = () => {
  const {
    address,
    shortAddress,
    client: walletClient,
    clientReady,
    clientError,
    isLoading,
    hasExternalWallet,
    hasEmbeddedWallet,
    isUsingExternalWallet,
    needsExternalWalletReconnection,
  } = useConnectedAddress();

  const [input, setInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Tell me what to do. I can swap ETH to USDC on Base. Example: Swap 0.0001 ETH to USDC. " +
        "I can also transfer ETH or USDC. Example: Send 0.0001 ETH to 0x... " +
        "I can also buy tokenized plots (Standard 100m², Premium 500m², Legendary 1000m²).",
    },
  ]);

  const messageIdRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const nextMessageId = () =>
    `msg-${Date.now()}-${messageIdRef.current++}`;

  const addMessage = (message: Omit<ChatMessage, "id">) => {
    const id = nextMessageId();
    setMessages((prev) => [...prev, { id, ...message }]);
    return id;
  };

  const updateMessage = (id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id ? { ...message, ...updates } : message
      )
    );
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const interpret = async (text: string): Promise<AgentResponse> => {
    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        walletConnected: Boolean(address),
        address: address || undefined,
      }),
    });

    if (!res.ok) {
      return {
        reply:
          "I can help with swaps (ETH -> USDC), transfers (ETH/USDC), balances, NFTs, " +
          "or buying plots (Standard 100m², Premium 500m², Legendary 1000m²) on Base.",
        intent: { type: "unknown", reason: "Agent service error." },
      };
    }

    const json = (await res.json().catch(() => null)) as
      | AgentResponse
      | ParsedIntent
      | null;
    if (!json || typeof json !== "object") {
      return {
        reply:
          "I can help with swaps (ETH -> USDC), transfers (ETH/USDC), balances, NFTs, " +
          "or buying plots (Standard 100m², Premium 500m², Legendary 1000m²) on Base.",
        intent: { type: "unknown", reason: "Could not understand your request." },
      };
    }

    // Backward compatibility: handle older { type, ... } responses.
    if ("type" in json) {
      const legacy = json as ParsedIntent;
      const reply =
        legacy.type === "swap"
          ? "Got it — preparing that swap now."
          : legacy.type === "transfer"
          ? "Got it — preparing that transfer now."
          : "I can help with swaps (ETH -> USDC) or transfers (ETH/USDC) on Base. " +
            "Try: Swap 0.0001 ETH to USDC or Send 0.0001 ETH to 0x...";
      return { reply, intent: legacy };
    }

    if (!("intent" in json)) {
      return {
        reply:
          "I can help with swaps (ETH -> USDC), transfers (ETH/USDC), balances, NFTs, " +
          "or buying plots (Standard 100m², Premium 500m², Legendary 1000m²) on Base.",
        intent: { type: "unknown", reason: "Could not understand your request." },
      };
    }

    if (json.intent.type === "unknown") {
      const localTransfer = parseTransferLocal(text);
      if (localTransfer) {
        return { reply: json.reply, intent: localTransfer };
      }
      const localBalance = parseBalanceLocal(text);
      if (localBalance) {
        return { reply: json.reply, intent: localBalance };
      }
      const localBuy = parseBuyPlotLocal(text);
      if (localBuy) {
        return { reply: json.reply, intent: localBuy };
      }
      const localNfts = parseNftsLocal(text);
      if (localNfts) {
        return { reply: json.reply, intent: localNfts };
      }
    }

    return json;
  };

  const ensureBaseChain = async () => {
    if (!walletClient?.request) {
      // If we cannot read/switch chain, we can't reliably enforce it here.
      return true;
    }

    try {
      const chainIdHex = (await walletClient.request({
        method: "eth_chainId",
        params: [],
      })) as string;

      const chainId = Number.parseInt(chainIdHex, 16);
      if (chainId === BASE_CHAIN_ID) return true;

      await walletClient.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }], // 8453
      });

      const afterHex = (await walletClient.request({
        method: "eth_chainId",
        params: [],
      })) as string;

      return Number.parseInt(afterHex, 16) === BASE_CHAIN_ID;
    } catch { return false;
      // If switching isn't supported, the swap may still fail—surface a better error later.
    }
  };

  const sendTx = async (tx: {
    to: string;
    data: `0x${string}`;
    value: bigint;
    gas?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  }) => {
    if (!walletClient) {
      throw new Error("Wallet client not available.");
    }

    // If this is a Viem WalletClient (wagmi), prefer native sendTransaction with bigint params.
    if (typeof (walletClient as any).sendTransaction === "function" && (walletClient as any).account) {
      return (await (walletClient as any).sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        ...(tx.gas && tx.gas > 0n ? { gas: tx.gas } : {}),
        ...(tx.maxFeePerGas ? { maxFeePerGas: tx.maxFeePerGas } : {}),
        ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : {}),
      })) as string;
    }

    if (typeof (walletClient as any).request !== "function") {
      throw new Error("Wallet provider does not support sending transactions.");
    }

    // EIP-1193 path (MetaMask/Privy/etc.) expects hex quantities.
    return (await (walletClient as any).request({
      method: "eth_sendTransaction",
      params: [
        {
          from: address,
          to: tx.to,
          data: tx.data,
          value: bigintToHex(tx.value),
          ...(tx.gas && tx.gas > 0n ? { gas: bigintToHex(tx.gas) } : {}),
          ...(tx.maxFeePerGas ? { maxFeePerGas: bigintToHex(tx.maxFeePerGas) } : {}),
          ...(tx.maxPriorityFeePerGas
            ? { maxPriorityFeePerGas: bigintToHex(tx.maxPriorityFeePerGas) }
            : {}),
        },
      ],
    })) as string;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isWorking) return;

    setInput("");
    addMessage({ role: "user", content: trimmed });

    if (!address) {
      addMessage({
        role: "assistant",
        content: "Please connect a wallet first.",
        status: "error",
      });
      return;
    }

    if (!clientReady || !walletClient) {
      addMessage({
        role: "assistant",
        content: "Your wallet is still initializing. Please try again in a moment.",
        status: "error",
      });
      return;
    }

    const statusId = addMessage({
      role: "assistant",
      content: "Thinking...",
      status: "pending",
    });

    setIsWorking(true);

    let actionId: string | null = null;

    try {
      const agent = await interpret(trimmed);

      updateMessage(statusId, {
        content: agent.reply,
        status: undefined,
      });

      if (agent.intent.type === "unknown") {
        return;
      }

      const intent = agent.intent;

      actionId = addMessage({
        role: "assistant",
        content: "Preparing transaction...",
        status: "pending",
      });

      const isOnBase = await ensureBaseChain();
      if (!isOnBase) {
        updateMessage(actionId, {
          content: "Please switch your wallet network to Base (chainId 8453) and try again.",
          status: "error",
        });
        return;
      }

      if (intent.type === "balance") {
        updateMessage(actionId, {
          content: "Checking your Base wallet balances...",
          status: "pending",
        });

        const isOnBase = await ensureBaseChain();
        if (!isOnBase) {
          updateMessage(actionId, {
            content: "Please switch your wallet network to Base (chainId 8453) and try again.",
            status: "error",
          });
          return;
        }

        const ethBalance = await getEthBalance(walletClient, address as `0x${string}`);
        const usdcBalance = await getErc20Balance(
          walletClient,
          USDC_TOKEN.address as `0x${string}`,
          address as `0x${string}`,
        );

        const ethReadable =
          ethBalance === null ? "Unknown" : `${formatUnits(ethBalance, 18)} ETH`;
        const usdcReadable =
          usdcBalance === null ? "Unknown" : `${formatUnits(usdcBalance, 6)} USDC`;

        updateMessage(actionId, {
          content: `Base balances — ETH: ${ethReadable}, USDC: ${usdcReadable}.`,
          status: "success",
        });
        return;
      }

      if (intent.type === "nfts") {
        updateMessage(actionId, {
          content: "Checking your Base NFTs...",
          status: "pending",
        });

        if (!address) {
          updateMessage(actionId, {
            content: "Please connect a wallet first.",
            status: "error",
          });
          return;
        }

        const isOnBase = await ensureBaseChain();
        if (!isOnBase) {
          updateMessage(actionId, {
            content: "Please switch your wallet network to Base (chainId 8453) and try again.",
            status: "error",
          });
          return;
        }

        const data = await fetchWalletNfts(address as `0x${string}`);
        const items = Array.isArray(data?.items) ? data.items : [];

        if (items.length === 0) {
          updateMessage(actionId, {
            content: "No NFTs found for your wallet on Base.",
            status: "success",
          });
          return;
        }

        const nftCards = items.map((nft: any, index: number) => {
          const name = nft.normalized_metadata?.name || nft.name || "Unnamed NFT";
          const tokenId = nft.token_id?.toString?.() || "0";
          const image =
            normalizeIpfsUrl(
              nft.normalized_metadata?.image ||
                nft.normalized_metadata?.image_url ||
                nft.normalized_metadata?.imageUrl ||
                nft.metadata?.image ||
                nft.image,
            ) || null;
          const collectionName = nft.name || nft.normalized_metadata?.collectionName || null;
          return {
            id: `${nft.token_address || "nft"}-${tokenId}-${index}`,
            name,
            tokenId,
            image,
            collectionName,
          };
        });

        updateMessage(actionId, {
          content: data.truncated
            ? `Found ${items.length}+ NFT(s). Showing the first ${items.length}.`
            : `Found ${items.length} NFT(s).`,
          status: "success",
          nfts: nftCards,
          nftTruncated: data.truncated,
        });
        return;
      }

      if (intent.type === "buy_plot") {
        updateMessage(actionId, {
          content: `Preparing ${intent.tier} ${intent.size}m² plot purchase...`,
          status: "pending",
        });

        if (!address) {
          updateMessage(actionId, {
            content: "Please connect a wallet first.",
            status: "error",
          });
          return;
        }

        const isOnBase = await ensureBaseChain();
        if (!isOnBase) {
          updateMessage(actionId, {
            content: "Please switch your wallet network to Base (chainId 8453) and try again.",
            status: "error",
          });
          return;
        }

        if (intent.tier === "Standard") {
          const mintTx = await buildStandardMintTx(address as `0x${string}`);
          const txHash = await sendTx(mintTx);
          updateMessage(actionId, {
            content: "Standard plot mint submitted successfully.",
            status: "success",
            txHash,
          });
          return;
        }

        const listing = await fetchListingForTier(intent.tier);
        if (!listing) {
          updateMessage(actionId, {
            content: `No ${intent.tier} listings are available right now. Please try again later.`,
            status: "error",
          });
          return;
        }

        const purchaseTx = await buildPremiumLegendaryTx({
          order: listing,
          buyerAddress: address as `0x${string}`,
        });
        const txHash = await sendTx(purchaseTx);
        updateMessage(actionId, {
          content: `${intent.tier} plot purchase submitted successfully.`,
          status: "success",
          txHash,
        });
        return;
      }

      if (intent.type === "swap") {
        updateMessage(actionId, {
          content: `Quoting: ${intent.amount} ${intent.fromSymbol} -> ${intent.toSymbol} on Base...`,
          status: "pending",
        });

        const swapTransaction = await buildSwapTransaction({
          amount: intent.amount,
          fromAddress: address as `0x${string}`,
          from: ETH_TOKEN,
          to: USDC_TOKEN,
          maxSlippage: "0.5",
          useAggregator: false,
        });

        if (isApiError(swapTransaction)) {
          updateMessage(actionId, {
            content: swapTransaction.error || "Swap quote failed. Please try again.",
            status: "error",
          });
          return;
        }

        const quotedOut = safeFormatUnits(
          swapTransaction.quote.toAmount,
          swapTransaction.quote.to.decimals
        );

        updateMessage(actionId, {
          content:
            `Quote: ~${quotedOut} ${swapTransaction.quote.to.symbol}. ` +
            `Submitting transaction (slippage ${swapTransaction.quote.slippage}%).`,
          status: "pending",
        });

        // Approve if required (for ERC-20 sells).
        // OnchainKit can return an "empty" approveTransaction; only run if it has calldata.
        if (swapTransaction.approveTransaction?.data) {
          const approveTx = swapTransaction.approveTransaction;
          await sendTx({
            to: approveTx.to,
            data: approveTx.data as `0x${string}`,
            value: approveTx.value,
            ...(approveTx.gas ? { gas: approveTx.gas } : {}),
            ...(approveTx.maxFeePerGas ? { maxFeePerGas: approveTx.maxFeePerGas } : {}),
            ...(approveTx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: approveTx.maxPriorityFeePerGas } : {}),
          });
        }

        const tx = swapTransaction.transaction;
        const txHash = await sendTx({
          to: tx.to,
          data: tx.data as `0x${string}`,
          value: tx.value,
          ...(tx.gas ? { gas: tx.gas } : {}),
          ...(tx.maxFeePerGas ? { maxFeePerGas: tx.maxFeePerGas } : {}),
          ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : {}),
        });

        updateMessage(actionId, {
          content: "Swap submitted successfully.",
          status: "success",
          txHash,
        });
        return;
      }

      if (intent.type === "transfer") {
        const amountLabel = `${intent.amount} ${intent.symbol}`;

        updateMessage(actionId, {
          content: `Sending ${amountLabel} to ${intent.toAddress}...`,
          status: "pending",
        });

        const prepared = await prepareTransferTx({
          symbol: intent.symbol,
          amount: intent.amount,
          toAddress: intent.toAddress,
          fromAddress: address as `0x${string}`,
          walletClient,
        });

        if ("error" in prepared) {
          updateMessage(actionId, {
            content: prepared.error,
            status: "error",
          });
          return;
        }

        const txHash = await sendTx(prepared.tx);

        updateMessage(actionId, {
          content: "Transfer submitted successfully.",
          status: "success",
          txHash,
        });
      }
    } catch (error: any) {
      const raw =
        typeof error?.message === "string" && error.message.length
          ? error.message
          : "Action failed. Please try again.";
      const isDenied =
        /user denied|user rejected|denied transaction|rejected the request/i.test(raw);
      const message = isDenied
        ? "Transaction signature was rejected in your wallet."
        : raw;

      if (actionId) {
        updateMessage(actionId, {
          content: message,
          status: "error",
        });
      } else {
        updateMessage(statusId, {
          content: message,
          status: "error",
        });
      }
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Fragment>
      <Seo title={"Climate Agent"} />
      <div className="container">
        <div className="grid grid-cols-12 gap-x-6 mt-6">
          <div className="xl:col-span-4 col-span-12">
            <div className="box">
              <div className="box-header">
                <div className="box-title">Agent Status</div>
              </div>
              <div className="box-body space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-defaulttextcolor/70">Wallet</span>
                  <span className="text-sm font-medium">
                    {isLoading ? "Loading..." : shortAddress || "Not connected"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-defaulttextcolor/70">Mode</span>
                  <span className="text-sm font-medium">
                    {isUsingExternalWallet
                      ? "External wallet"
                      : hasEmbeddedWallet
                      ? "Embedded wallet"
                      : hasExternalWallet
                      ? "External wallet"
                      : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-defaulttextcolor/70">Network</span>
                  <span className="text-sm font-medium">Base (8453)</span>
                </div>
                {needsExternalWalletReconnection && (
                  <div className="alert alert-warning" role="alert">
                    External wallet needs reconnection for signing.
                  </div>
                )}
                {clientError && (
                  <div className="alert alert-danger" role="alert">
                    {clientError}
                  </div>
                )}
              </div>
            </div>
            <div className="box">
              <div className="box-header">
                <div className="box-title">Quick Prompts</div>
              </div>
              <div className="box-body flex flex-col gap-2">
                {[
                  "Swap 0.0001 ETH to USDC",
                  "Swap 0.001 ETH to USDC",
                  "Send 0.0001 ETH to 0x...",
                  "Transfer 1 USDC to 0x...",
                  "Check my wallet balance",
                  "Check my NFTs",
                  "Buy Standard 100m² plot",
                  "Buy Premium 500m² plot",
                  "Buy Legendary 1000m² plot",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="w-full px-3 py-2 rounded-md bg-camel10 text-sm text-left hover:bg-camel transition"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
            <div className="box">
              <div className="box-header">
                <div className="box-title">How It Works</div>
              </div>
              <div className="box-body space-y-2 text-sm text-defaulttextcolor/70">
                <div>
                  Swaps execute on the connected wallet. External wallets will
                  prompt for confirmation.
                </div>
                <div>
                  Supported requests: swap ETH to USDC, transfer ETH/USDC, check balances/NFTs, or buy tokenized plots.
                </div>
              </div>
            </div>
          </div>

          <div className="xl:col-span-8 col-span-12">
            <div className="box h-full flex flex-col">
              <div className="box-header">
                <div className="box-title">Climate Agent Chat</div>
              </div>
              <div className="box-body flex flex-col gap-4">
                <div
                  className="flex flex-col gap-3 overflow-y-auto"
                  style={{ minHeight: "360px", maxHeight: "460px" }}
                >
                  {messages.map((message) => {
                    const isUser = message.role === "user";
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-xl px-4 py-3 text-sm shadow-sm ${
                            isUser
                              ? "bg-secondary text-white"
                              : "bg-camel10 text-defaulttextcolor"
                          }`}
                        >
                          <div>{message.content}</div>
                          {message.status === "pending" && (
                            <div className="text-xs mt-2 text-defaulttextcolor/70">
                              Processing...
                            </div>
                          )}
                          {message.status === "error" && (
                            <div className="text-xs mt-2 text-red-500">
                              Action failed
                            </div>
                          )}
                          {message.nfts && message.nfts.length > 0 && (
                            <div className="mt-3">
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {message.nfts.map((nft) => (
                                  <div
                                    key={nft.id}
                                    className="rounded-lg border border-defaultborder/40 bg-white/80 dark:bg-bodybg p-2 shadow-sm"
                                  >
                                    <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-100 dark:bg-bodybg">
                                      {nft.image ? (
                                        <img
                                          src={nft.image}
                                          alt={nft.name}
                                          className="h-full w-full object-cover"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center text-xs text-defaulttextcolor/60">
                                          No image
                                        </div>
                                      )}
                                    </div>
                                    <div className="mt-2 space-y-1">
                                      <div className="text-xs font-medium text-defaulttextcolor">
                                        {nft.name}
                                      </div>
                                      {nft.collectionName && (
                                        <div className="text-[10px] text-defaulttextcolor/60">
                                          {nft.collectionName}
                                        </div>
                                      )}
                                      <div className="text-[10px] text-defaulttextcolor/60">
                                        #{nft.tokenId}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {message.nftTruncated && (
                                <div className="mt-2 text-[11px] text-defaulttextcolor/60">
                                  Showing the first 200 items to keep the UI fast.
                                </div>
                              )}
                            </div>
                          )}
                          {message.txHash && (
                            <a
                              href={`https://basescan.org/tx/${message.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs mt-2 inline-block underline"
                            >
                              View on Basescan
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </div>
              <div className="box-footer border-t dark:border-defaultborder/10">
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Type a command..."
                    className="flex-1 px-3 py-2 rounded-md bg-swap text-sm dark:text-white dark:placeholder:text-white focus:outline-none focus:ring-2 focus:ring-secondary"
                  />
                  <button
                    type="submit"
                    disabled={isWorking}
                    className="px-4 py-2 rounded-md bg-secondary text-white text-sm font-medium hover:bg-secondary/90 transition disabled:opacity-60"
                  >
                    {isWorking ? "Working..." : "Send"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Fragment>
  );
};

export default ClimateAgentPage;
