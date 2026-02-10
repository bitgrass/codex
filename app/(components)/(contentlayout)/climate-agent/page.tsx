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
  nftInfo,
  btgInfo,
  EthInfo,
} from "@/shared/data/tokens/data";
import { IconBoxPadding } from "@/public/assets/iconfonts/tabler-icons/icons-react";

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
    status?: "staked" | "available";
  }[];
  nftTruncated?: boolean;
  selectableNfts?: boolean;
};

const BASE_CHAIN_ID = 8453;
const QUICK_PROMPTS = [
  "Check my wallet Balance",
  "Swap 0.0001 ETH to USDC",
  "Check my landplots",
  "Buy Standard 100m2 plot",
];

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

const LEGENDARY_POOL_ADDRESS = "0xAbdD77516765235e3121773bcB4E33984c604D7C";
const PREMIUM_POOL_ADDRESS = "0xCe6409e0146ffFa252Dbb3105c1D5285c73b4274";
const STANDARD_POOL_ADDRESS = "0xE70886Db1d0F52B3B8Ced3538E048d8263C16302";
const REWARD_TOKEN_ADDRESS = "0x20429F731096e359910921994A267d32ef576720";
const NFT_COLLECTION_ADDRESS = nftInfo.address;
const LEADERBOARD_API = "https://durable-object-starter.bitgrass-crypto.workers.dev";

type ParsedIntent =
  | {
    type: "swap";
    amount: string;
    fromSymbol: "ETH" | "USDC";
    toSymbol: "ETH" | "USDC";
    chainId: 8453;
  }
  | {
    type: "current_earnings";
    chainId: 8453;
  }
  | {
    type: "total_earned";
    chainId: 8453;
  }
  | {
    type: "claim_bco2";
    chainId: 8453;
  }
  | {
    type: "leaderboard_rank";
    chainId: 8453;
  }
  | {
    type: "leaderboard_top";
    count: number;
    chainId: 8453;
  }
  | {
    type: "btg_claim";
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
    type: "stake";
    tokenIds?: number[];
    stakeAll?: boolean;
    tier?: "Legendary" | "Premium" | "Standard";
    chainId: 8453;
  }
  | {
    type: "unstake";
    tokenIds?: number[];
    unstakeAll?: boolean;
    tier?: "Legendary" | "Premium" | "Standard";
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

function formatAmountForSwap(value: bigint, decimals: number) {
  const raw = formatUnits(value, decimals);
  const trimmed = raw.replace(/\.?0+$/, "");
  return trimmed.length ? trimmed : "0";
}

function formatUsd(value: number) {
  return value.toFixed(2);
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

function parseEarningsLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (
    /(current|now|pending|unclaimed).*(earn|earning|earned|bco2|bc02)/i.test(normalized) ||
    /(earn|earning).*(current|now|pending|unclaimed)/i.test(normalized)
  ) {
    return { type: "current_earnings", chainId: 8453 };
  }
  if (
    /(total|overall|all time).*(earn|earned|earning|bco2|bc02)/i.test(normalized) ||
    /(how much).*(earned|earn|earning|bco2|bc02)/i.test(normalized) ||
    /(earned|earnings?)\s*(bco2|bc02)/i.test(normalized) ||
    /(total|overall|all time)\s*(bco2|bc02)/i.test(normalized) ||
    /(bco2|bc02).*(earned|earnings?|so far|total)/i.test(normalized)
  ) {
    return { type: "total_earned", chainId: 8453 };
  }
  return null;
}

function parseClaimLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (/(claim|collect|redeem|withdraw).*(bco2|bc02|rewards?)/i.test(normalized)) {
    return { type: "claim_bco2", chainId: 8453 };
  }
  return null;
}

function parseLeaderboardLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (/(leaderboard|rank|ranking|position)/i.test(normalized)) {
    return { type: "leaderboard_rank", chainId: 8453 };
  }
  return null;
}

function parseLeaderboardTopLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  const match = normalized.match(/top\s*(\d+)\s*(leaderboard|ranks|ranking|rankings|users)?/i);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) return null;
  return {
    type: "leaderboard_top",
    count: Math.min(50, Math.max(1, Math.floor(count))),
    chainId: 8453,
  };
}

function parseBtgClaimLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (/(bco2|bc02)/i.test(normalized)) return null;
  if (/(btg).*(claim|claimed|rewards?|earnings?|balance|amount)|((claim|claimed).*(btg))/i.test(normalized)) {
    return { type: "btg_claim", chainId: 8453 };
  }
  return null;
}

function parseStakeLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (/(unstake|unstaek|unstaking|withdraw)/i.test(normalized)) return null;
  if (!/(stake|staking)/i.test(normalized)) return null;

  const tierMatch = normalized.match(/(legendary|premium|standard)/i);
  const tier = tierMatch?.[1]
    ? (tierMatch[1][0].toUpperCase() + tierMatch[1].slice(1)) as
        | "Legendary"
        | "Premium"
        | "Standard"
    : undefined;

  const allMatch = normalized.match(/stake\s+(all|max)(?:\s+my)?/i);
  if (allMatch) {
    return { type: "stake", stakeAll: true, tier, chainId: 8453 };
  }

  const idMatch = normalized.match(/(?:plot|landplot|land|nft).*?(\d{1,6})/i);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (!Number.isNaN(id) && id > 0) {
      return { type: "stake", tokenIds: [id], chainId: 8453 };
    }
  }
  if (/(plot|landplot|land|nft)/i.test(normalized)) {
    return { type: "stake", chainId: 8453 };
  }

  return null;
}

function parseUnstakeLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (!/(unstake|unstaek|unstaking|withdraw)/i.test(normalized)) return null;

  const tierMatch = normalized.match(/(legendary|premium|standard)/i);
  const tier = tierMatch?.[1]
    ? (tierMatch[1][0].toUpperCase() + tierMatch[1].slice(1)) as
        | "Legendary"
        | "Premium"
        | "Standard"
    : undefined;

  const allMatch = normalized.match(/(unstake|unstaek|withdraw)\s+(all|max)(?:\s+my)?/i);
  if (allMatch) {
    return { type: "unstake", unstakeAll: true, tier, chainId: 8453 };
  }

  const idMatch = normalized.match(/(?:plot|landplot|land|nft).*?(\d{1,6})/i);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (!Number.isNaN(id) && id > 0) {
      return { type: "unstake", tokenIds: [id], chainId: 8453 };
    }
  }

  return null;
}

function parseNftsLocal(text: string): ParsedIntent | null {
  const normalized = text.trim().toLowerCase();
  if (/(buy|purchase|get|own|mint)/i.test(normalized)) return null;
  const match = normalized.match(
    /(nft|nfts|collectibles|my nfts|my nft|check my nfts|check my nft|landplot|landplots|plot|plots|my plots|my plot|check my plots|check my plot)/i,
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

async function getStakeInfo(
  walletClient: any,
  poolAddress: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  if (!walletClient?.request) return BigInt(0);
  try {
    const iface = new ethers.Interface([
      "function getStakeInfo(address _staker) view returns (uint256[] _tokensStaked, uint256 _rewards)",
    ]);
    const data = iface.encodeFunctionData("getStakeInfo", [account]);
    const hex = (await walletClient.request({
      method: "eth_call",
      params: [{ to: poolAddress, data }, "latest"],
    })) as string;
    const decoded = iface.decodeFunctionResult("getStakeInfo", hex);
    const rewards = decoded?.[1] as bigint;
    return rewards ?? BigInt(0);
  } catch {
    return BigInt(0);
  }
}

async function getStakedTokenIds(
  walletClient: any,
  poolAddress: `0x${string}`,
  account: `0x${string}`,
): Promise<number[]> {
  if (!walletClient?.request) return [];
  try {
    const iface = new ethers.Interface([
      "function getStakeInfo(address _staker) view returns (uint256[] _tokensStaked, uint256 _rewards)",
    ]);
    const data = iface.encodeFunctionData("getStakeInfo", [account]);
    const hex = (await walletClient.request({
      method: "eth_call",
      params: [{ to: poolAddress, data }, "latest"],
    })) as string;
    const decoded = iface.decodeFunctionResult("getStakeInfo", hex);
    const tokens = (decoded?.[0] as bigint[]) || [];
    return tokens.map((token) => Number(token)).filter((id) => Number.isFinite(id));
  } catch {
    return [];
  }
}

async function fetchLeaderboardRow(userAddress: string) {
  const res = await fetch(`${LEADERBOARD_API}/leaderboard`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Leaderboard fetch failed (${res.status})`);
  }
  const body = await res.json();
  const ranked = Array.isArray(body?.result) ? body.result : [];
  const lower = userAddress.toLowerCase();
  const index = ranked.findIndex((row: any) => (row.address || "").toLowerCase() === lower);
  const row = index >= 0 ? ranked[index] : null;
  return { row, index, total: ranked.length };
}

function formatLeaderboardAddress(address: string) {
  if (!address || address.length < 10) return address || "Unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function fetchTotalEarned(address: `0x${string}`) {
  const apiKey = process.env.NEXT_PUBLIC_MORALIS_APY_KEY;
  if (!apiKey) {
    throw new Error("Moralis API key is not configured.");
  }

  const response = await fetch(
    `https://deep-index.moralis.io/api/v2.2/${address}/erc20/transfers?chain=base&contract_addresses=${REWARD_TOKEN_ADDRESS}&limit=100&order=DESC`,
    {
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch earned rewards.");
  }

  const data = await response.json();
  const items = Array.isArray(data?.result) ? data.result : [];
  const addressLower = address.toLowerCase();
  const legendaryLower = LEGENDARY_POOL_ADDRESS.toLowerCase();
  const premiumLower = PREMIUM_POOL_ADDRESS.toLowerCase();
  const standardLower = STANDARD_POOL_ADDRESS.toLowerCase();

  let totalAll = BigInt(0);
  let legendaryTotal = BigInt(0);
  let premiumTotal = BigInt(0);
  let standardTotal = BigInt(0);
  for (const tx of items) {
    const fromAddress = String(tx.from_address || "").toLowerCase();
    const toAddress = String(tx.to_address || "").toLowerCase();
    if (toAddress !== addressLower) continue;
    const value = BigInt(tx.value || 0);
    if (
      fromAddress === legendaryLower ||
      fromAddress === premiumLower ||
      fromAddress === standardLower
    ) {
      totalAll += value;
      if (fromAddress === legendaryLower) legendaryTotal += value;
      if (fromAddress === premiumLower) premiumTotal += value;
      if (fromAddress === standardLower) standardTotal += value;
    }
  }

  return {
    total: formatUnits(totalAll, 18),
    legendary: formatUnits(legendaryTotal, 18),
    premium: formatUnits(premiumTotal, 18),
    standard: formatUnits(standardTotal, 18),
  };
}

async function fetchTokenPriceUsd(tokenAddress: string, chain: "base" | "eth") {
  const apiKey = process.env.NEXT_PUBLIC_MORALIS_APY_KEY;
  if (!apiKey) {
    throw new Error("Moralis API key is not configured.");
  }

  const response = await fetch(
    `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/price?chain=${chain}&include=percent_change`,
    {
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch token price.");
  }

  const data = await response.json();
  return Number(data?.usdPrice || 0);
}

async function checkGasBalance(address: `0x${string}`) {
  const apiKey = process.env.NEXT_PUBLIC_MORALIS_APY_KEY;
  if (!apiKey) return true;
  try {
    const response = await fetch(
      `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=base`,
      {
        headers: {
          accept: "application/json",
          "X-API-Key": apiKey,
        },
      },
    );
    const data = await response.json();
    const nativeToken = data?.result?.find((token: any) => token.native_token === true);
    const balanceWei = BigInt(nativeToken?.balance || "0");
    const minGas = BigInt("2000000000000"); // 0.000002 ETH
    return balanceWei >= minGas;
  } catch {
    return true;
  }
}

function getPoolForTokenId(tokenId: number) {
  if (tokenId >= 1 && tokenId <= 400) {
    return { name: "Legendary", address: LEGENDARY_POOL_ADDRESS };
  }
  if (tokenId >= 401 && tokenId <= 1200) {
    return { name: "Premium", address: PREMIUM_POOL_ADDRESS };
  }
  if (tokenId >= 1201 && tokenId <= 3200) {
    return { name: "Standard", address: STANDARD_POOL_ADDRESS };
  }
  return null;
}

async function isApprovedForAll(
  walletClient: any,
  owner: `0x${string}`,
  operator: `0x${string}`,
) {
  if (!walletClient?.request) return false;
  try {
    const iface = new ethers.Interface([
      "function isApprovedForAll(address owner, address operator) view returns (bool)",
    ]);
    const data = iface.encodeFunctionData("isApprovedForAll", [owner, operator]);
    const hex = (await walletClient.request({
      method: "eth_call",
      params: [{ to: NFT_COLLECTION_ADDRESS, data }, "latest"],
    })) as string;
    const decoded = iface.decodeFunctionResult("isApprovedForAll", hex);
    return Boolean(decoded?.[0]);
  } catch {
    return false;
  }
}

async function getPendingNonce(
  walletClient: any,
  account: `0x${string}`,
): Promise<bigint | null> {
  if (!walletClient?.request) return null;
  try {
    const hex = (await walletClient.request({
      method: "eth_getTransactionCount",
      params: [account, "pending"],
    })) as string;
    return BigInt(hex);
  } catch {
    return null;
  }
}

async function waitForReceipt(
  walletClient: any,
  txHash: string,
  timeoutMs = 90_000,
) {
  if (!walletClient?.request) return null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = (await walletClient.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    })) as any;
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
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

  if (rawAmount <= BigInt(0)) {
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
      value: BigInt(0),
    },
  };
}

async function fetchWalletNfts(address: `0x${string}`, collectionAddress?: string) {
  const apiKey = process.env.NEXT_PUBLIC_MORALIS_APY_KEY;
  if (!apiKey) {
    throw new Error("Moralis API key is not configured.");
  }

  const MAX_ITEMS = 200;
  const PAGE_SIZE = 50;

  let cursor: string | null = null;
  const allItems: any[] = [];
  const normalizedCollection = collectionAddress?.toLowerCase();

  do {
    const params = new URLSearchParams({
      chain: "base",
      format: "decimal",
      normalizeMetadata: "true",
      media_items: "false",
      include_prices: "false",
      limit: PAGE_SIZE.toString(),
    });
    if (normalizedCollection) params.append("token_addresses", normalizedCollection);
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

  const filteredItems = normalizedCollection
    ? allItems.filter(
        (item) =>
          String(item?.token_address || "").toLowerCase() === normalizedCollection,
      )
    : allItems;

  const truncated = Boolean(cursor && allItems.length >= MAX_ITEMS);

  return { items: filteredItems, truncated };
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
  const quantity = BigInt(1);
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
    client: walletClient,
    clientReady,
    clientError,
    needsExternalWalletReconnection,
  } = useConnectedAddress();

  const [input, setInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [lastVoicePhrase, setLastVoicePhrase] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "How we can start?",
    },
  ]);
  const [showStakePendingToast, setShowStakePendingToast] = useState(false);
  const [stakeProgress, setStakeProgress] = useState({ current: 0, total: 0 });
  const [stakePendingType, setStakePendingType] = useState<"stake" | "unstake">(
    "stake",
  );
  const [selectedStakeIds, setSelectedStakeIds] = useState<string[]>([]);
  const [stakeSelectionMessageId, setStakeSelectionMessageId] = useState<string | null>(null);

  const messageIdRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const inputBaseRef = useRef("");
  const finalTranscriptRef = useRef("");
  const suppressVoiceSubmitRef = useRef(false);
  const lastTranscriptRef = useRef("");
  const speechIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const renderMessageHtml = (content: string) => {
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const withIcons = escaped
      .replace(
        /\{\{ICON_LEGENDARY\}\}/g,
        '<img src="/assets/images/svg/lsvg.svg" alt="Legendary" class="inline-block w-4 h-4 mr-2 align-text-bottom" />',
      )
      .replace(
        /\{\{ICON_PREMIUM\}\}/g,
        '<img src="/assets/images/svg/psvg.svg" alt="Premium" class="inline-block w-4 h-4 mr-2 align-text-bottom" />',
      )
      .replace(
        /\{\{ICON_STANDARD\}\}/g,
        '<img src="/assets/images/svg/ssvg.svg" alt="Standard" class="inline-block w-4 h-4 mr-2 align-text-bottom" />',
      );
    const withEarnIcon = withIcons.replace(
      /\{\{ICON_EARN\}\}/g,
      '<img src="/assets/images/svg/EarnBo2.svg" alt="Earn BCO2" class="inline-block w-4 h-4 mr-2 align-text-bottom" />',
    );
    return withEarnIcon
      .replace(
        /\{\{ICON_ETH\}\}/g,
        '<img src="/assets/images/brand-logos/eth.png" alt="ETH" class="inline-block w-4 h-4 mr-2 align-text-bottom" />',
      )
      .replace(
        /\{\{ICON_USDC\}\}/g,
        '<img src="/assets/images/faces/usdc.png" alt="USDC" class="inline-block w-4 h-4 mr-2 align-text-bottom" />',
      )
      .replace(
        /\{\{ICON_BTG\}\}/g,
        '<img src="/assets/images/brand-logos/logo-btg.svg" alt="BTG" class="inline-block w-4 h-4 mr-2 align-text-bottom" />',
      )
      .replace(/&lt;strong&gt;([\s\S]*?)&lt;\/strong&gt;/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br />");
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported = Boolean(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    );
    setSpeechSupported(supported);

    return () => {
      if (recognitionRef.current?.stop) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const interpret = async (
    text: string,
    history?: { role: "user" | "assistant"; content: string }[],
  ): Promise<AgentResponse> => {
    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history,
        walletConnected: Boolean(address),
        address: address || undefined,
      }),
    });

    if (!res.ok) {
      return {
        reply:
          "I can help with swaps (ETH <-> USDC), transfers (ETH/USDC), balances, NFTs, " +
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
          "I can help with swaps (ETH <-> USDC), transfers (ETH/USDC), balances, NFTs, " +
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
            : "I can help with swaps (ETH <-> USDC) or transfers (ETH/USDC) on Base. " +
            "Try: Swap 0.0001 ETH to USDC or Send 0.0001 ETH to 0x...";
      return { reply, intent: legacy };
    }

    if (!("intent" in json)) {
      return {
        reply:
          "I can help with swaps (ETH <-> USDC), transfers (ETH/USDC), balances, NFTs, " +
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
      const localEarnings = parseEarningsLocal(text);
      if (localEarnings) {
        return { reply: json.reply, intent: localEarnings };
      }
      const localClaim = parseClaimLocal(text);
      if (localClaim) {
        return { reply: json.reply, intent: localClaim };
      }
      const localLeaderboardTop = parseLeaderboardTopLocal(text);
      if (localLeaderboardTop) {
        return { reply: json.reply, intent: localLeaderboardTop };
      }
      const localLeaderboard = parseLeaderboardLocal(text);
      if (localLeaderboard) {
        return { reply: json.reply, intent: localLeaderboard };
      }
      const localBtgClaim = parseBtgClaimLocal(text);
      if (localBtgClaim) {
        return { reply: json.reply, intent: localBtgClaim };
      }
      const localStake = parseStakeLocal(text);
      if (localStake) {
        return { reply: json.reply, intent: localStake };
      }
      const localUnstake = parseUnstakeLocal(text);
      if (localUnstake) {
        return { reply: json.reply, intent: localUnstake };
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
    } catch {
      return false;
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
    nonce?: bigint;
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
        ...(tx.gas && tx.gas > BigInt(0) ? { gas: tx.gas } : {}),
        ...(tx.maxFeePerGas ? { maxFeePerGas: tx.maxFeePerGas } : {}),
        ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : {}),
        ...(typeof tx.nonce === "bigint" ? { nonce: tx.nonce } : {}),
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
          ...(tx.gas && tx.gas > BigInt(0) ? { gas: bigintToHex(tx.gas) } : {}),
          ...(tx.maxFeePerGas ? { maxFeePerGas: bigintToHex(tx.maxFeePerGas) } : {}),
          ...(tx.maxPriorityFeePerGas
            ? { maxPriorityFeePerGas: bigintToHex(tx.maxPriorityFeePerGas) }
            : {}),
          ...(typeof tx.nonce === "bigint" ? { nonce: bigintToHex(tx.nonce) } : {}),
        },
      ],
    })) as string;
  };

  const stopListening = (suppressSubmit = false) => {
    suppressVoiceSubmitRef.current = suppressSubmit;
    if (recognitionRef.current?.stop) {
      recognitionRef.current.stop();
    }
  };

  const submitMessage = async (rawInput: string, options?: { skipStop?: boolean }) => {
    const trimmed = rawInput.trim();
    if (!trimmed || isWorking) return;

    if (isListening && !options?.skipStop) stopListening(true);

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

    const history = [
      ...messages
        .filter((message) => message.content && !message.status)
        .map((message) => ({ role: message.role, content: message.content })),
      { role: "user" as const, content: trimmed },
    ].slice(-10);

    const statusId = addMessage({
      role: "assistant",
      content: "Thinking...",
      status: "pending",
    });

    setIsWorking(true);

    let actionId: string | null = null;

    try {
      const agent = await interpret(trimmed, history);

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

        const [ethBalance, usdcBalance, btgBalance] = await Promise.all([
          getEthBalance(walletClient, address as `0x${string}`),
          getErc20Balance(
            walletClient,
            USDC_TOKEN.address as `0x${string}`,
            address as `0x${string}`,
          ),
          getErc20Balance(
            walletClient,
            btgInfo.address as `0x${string}`,
            address as `0x${string}`,
          ),
        ]);

        const ethValue =
          ethBalance === null ? 0 : Number(formatUnits(ethBalance, 18));
        const usdcValue =
          usdcBalance === null ? 0 : Number(formatUnits(usdcBalance, 6));
        const btgValue =
          btgBalance === null ? 0 : Number(formatUnits(btgBalance, 18));

        const ethReadable = ethValue === 0 ? "0" : ethValue.toFixed(6);
        const usdcReadable = usdcValue === 0 ? "0" : usdcValue.toFixed(6);
        const btgReadable = btgValue === 0 ? "0" : btgValue.toFixed(6);

        let totalUsd = 0;
        try {
          const [ethPrice, usdcPrice, btgPrice] = await Promise.all([
            fetchTokenPriceUsd(EthInfo.address, "eth"),
            fetchTokenPriceUsd(USDC_TOKEN.address, "base"),
            fetchTokenPriceUsd(btgInfo.address, "base"),
          ]);
          totalUsd =
            Number(ethReadable) * ethPrice +
            Number(usdcReadable) * usdcPrice +
            Number(btgReadable) * btgPrice;
        } catch {
          totalUsd = 0;
        }

        updateMessage(actionId, {
          content:
            `Your Total Balance on base : <strong>$${formatUsd(totalUsd)}</strong>\n` +
            `\n` +
            `{{ICON_ETH}}ETH : ${ethReadable}\n` +
            `{{ICON_USDC}}USDC : ${usdcReadable}\n` +
            `{{ICON_BTG}}BTG : ${btgReadable}`,
          status: "success",
        });
        return;
      }

      if (intent.type === "total_earned") {
        updateMessage(actionId, {
          content: "Checking your total BCO2 earned...",
          status: "pending",
        });

        try {
          const totals = await fetchTotalEarned(address as `0x${string}`);
        updateMessage(actionId, {
          content:
            `Your Total earning from your Lands : <strong>${totals.total} BCO2</strong> {{ICON_EARN}}\n` +
            `\n`+   
            `{{ICON_LEGENDARY}}Legendary Plots : ${totals.legendary} BCO2\n` +
            `{{ICON_PREMIUM}}Premium Plots : ${totals.premium} BCO2\n` +
            `{{ICON_STANDARD}}Standard Plots : ${totals.standard} BCO2`,
          status: "success",
        });
        } catch (error: any) {
          updateMessage(actionId, {
            content:
              typeof error?.message === "string"
                ? error.message
                : "Failed to fetch total earned.",
            status: "error",
          });
        }
        return;
      }

      if (intent.type === "current_earnings") {
        updateMessage(actionId, {
          content: "Checking your current BCO2 earnings...",
          status: "pending",
        });

        const rewardsLegendary = await getStakeInfo(
          walletClient,
          LEGENDARY_POOL_ADDRESS as `0x${string}`,
          address as `0x${string}`,
        );
        const rewardsPremium = await getStakeInfo(
          walletClient,
          PREMIUM_POOL_ADDRESS as `0x${string}`,
          address as `0x${string}`,
        );
        const rewardsStandard = await getStakeInfo(
          walletClient,
          STANDARD_POOL_ADDRESS as `0x${string}`,
          address as `0x${string}`,
        );

        const totalCurrent = rewardsLegendary + rewardsPremium + rewardsStandard;
        const totalReadable = formatUnits(totalCurrent, 18);
        const legendaryReadable = formatUnits(rewardsLegendary, 18);
        const premiumReadable = formatUnits(rewardsPremium, 18);
        const standardReadable = formatUnits(rewardsStandard, 18);

        updateMessage(actionId, {
          content:
            `Current earnings from your Lands :<strong>${totalReadable} BCO2</strong> {{ICON_EARN}} \n` +
            `\n`+            
            `{{ICON_LEGENDARY}}Legendary Plots : ${legendaryReadable} BCO2\n` +
            `{{ICON_PREMIUM}}Premium Plots : ${premiumReadable} BCO2\n` +
            `{{ICON_STANDARD}}Standard Plots : ${standardReadable} BCO2`,
          status: "success",
        });
        return;
      }

      if (intent.type === "claim_bco2") {
        updateMessage(actionId, {
          content: "Claiming your BCO2 rewards...",
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

        const hasGas = await checkGasBalance(address as `0x${string}`);
        if (!hasGas) {
          updateMessage(actionId, {
            content: "Insufficient funds for gas fee. Please fund your wallet with ETH.",
            status: "error",
          });
          return;
        }

        const rewardsLegendary = await getStakeInfo(
          walletClient,
          LEGENDARY_POOL_ADDRESS as `0x${string}`,
          address as `0x${string}`,
        );
        const rewardsPremium = await getStakeInfo(
          walletClient,
          PREMIUM_POOL_ADDRESS as `0x${string}`,
          address as `0x${string}`,
        );
        const rewardsStandard = await getStakeInfo(
          walletClient,
          STANDARD_POOL_ADDRESS as `0x${string}`,
          address as `0x${string}`,
        );

        const pools: { address: string; name: string; rewards: bigint }[] = [];
        if (rewardsLegendary > BigInt(0)) {
          pools.push({ address: LEGENDARY_POOL_ADDRESS, name: "Legendary", rewards: rewardsLegendary });
        }
        if (rewardsPremium > BigInt(0)) {
          pools.push({ address: PREMIUM_POOL_ADDRESS, name: "Premium", rewards: rewardsPremium });
        }
        if (rewardsStandard > BigInt(0)) {
          pools.push({ address: STANDARD_POOL_ADDRESS, name: "Standard", rewards: rewardsStandard });
        }

        if (pools.length === 0) {
          updateMessage(actionId, {
            content: "No rewards available to claim.",
            status: "success",
          });
          return;
        }

        const totalClaimed = pools.reduce((sum, pool) => sum + pool.rewards, BigInt(0));
        const totalClaimedReadable = formatUnits(totalClaimed, 18);

        const claimIface = new ethers.Interface([
          "function claimRewards()",
        ]);

        for (const pool of pools) {
          const claimData = claimIface.encodeFunctionData("claimRewards") as `0x${string}`;
          await sendTx({
            to: pool.address,
            data: claimData,
            value: BigInt(0),
          });
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        updateMessage(actionId, {
          content: `Claimed <strong>${totalClaimedReadable} BCO2</strong> successfully.`,
          status: "success",
        });
        return;
      }

      if (intent.type === "leaderboard_top") {
        const topCount = Math.max(1, Math.min(50, intent.count || 10));
        updateMessage(actionId, {
          content: `Fetching top ${topCount} leaderboard...`,
          status: "pending",
        });

        try {
          const res = await fetch(`${LEADERBOARD_API}/leaderboard`, {
            headers: { accept: "application/json" },
          });
          if (!res.ok) throw new Error("Leaderboard fetch failed.");
          const body = await res.json();
          const ranked = Array.isArray(body?.result) ? body.result : [];
          if (!ranked.length) {
            updateMessage(actionId, {
              content: "Leaderboard data is empty right now.",
              status: "error",
            });
            return;
          }

          const top = ranked.slice(0, topCount);
          const lines = top.map((row: any, idx: number) => {
            const addr = formatLeaderboardAddress(String(row?.address || ""));
            const legendary = Number(row?.legendary || 0);
            const premium = Number(row?.premium || 0);
            const standard = Number(row?.standard || 0);
            const btgClaim = Number(row?.btg_claim || 0);
            return (
              `${idx + 1}) ${addr} ` +
              `{{ICON_LEGENDARY}}${legendary} ` +
              `{{ICON_PREMIUM}}${premium} ` +
              `{{ICON_STANDARD}}${standard} ` +
              `${btgClaim} $BTG {{ICON_BTG}}`
            );
          });

          updateMessage(actionId, {
            content: `Top ${topCount} in Leaderboard:\n${lines.join("\n")}`,
            status: "success",
          });
        } catch (error: any) {
          updateMessage(actionId, {
            content: "Unable to fetch leaderboard data right now. Please try again in a moment.",
            status: "error",
          });
        }
        return;
      }

      if (intent.type === "leaderboard_rank" || intent.type === "btg_claim") {
        updateMessage(actionId, {
          content:
            intent.type === "leaderboard_rank"
              ? "Checking your leaderboard rank..."
              : "Checking your claimed BTG amount...",
          status: "pending",
        });

        if (!address) {
          updateMessage(actionId, {
            content: "Please connect a wallet first.",
            status: "error",
          });
          return;
        }

        try {
          const { row, index, total } = await fetchLeaderboardRow(address);
          if (!row || index < 0) {
            updateMessage(actionId, {
              content:
                "Your wallet was not found in the leaderboard. " +
                "Make sure you hold land plots and try again.",
              status: "error",
            });
            return;
          }

          const rank = `#${String(index + 1).padStart(4, "0")}`;
          const btgClaim = Number(row?.btg_claim || 0);
          const legendary = Number(row?.legendary || 0);
          const premium = Number(row?.premium || 0);
          const standard = Number(row?.standard || 0);

          if (intent.type === "leaderboard_rank") {
            updateMessage(actionId, {
              content:
                `Your leaderboard rank is <strong>${rank}</strong> out of <strong>${total}</strong>.\n` +
                 `\n`+ 
                `{{ICON_LEGENDARY}}Legendary Plots : ${legendary}\n` +
                `{{ICON_PREMIUM}}Premium Plots : ${premium}\n` +
                `{{ICON_STANDARD}}Standard Plots : ${standard}\n` +
                `\n`+ 
                `Claimable $BTG : <strong>${btgClaim} $BTG</strong> {{ICON_BTG}}`,
              status: "success",
            });
          } else {
            updateMessage(actionId, {
              content:
                `Your claimable $BTG is <strong>${btgClaim} $BTG</strong> {{ICON_BTG}}\n` +
                 `\n`+ 
                `{{ICON_LEGENDARY}}Legendary Plots : ${legendary}\n` +
                `{{ICON_PREMIUM}}Premium Plots : ${premium}\n` +
                `{{ICON_STANDARD}}Standard Plots : ${standard}`,
              status: "success",
            });
          }
        } catch (error: any) {
          updateMessage(actionId, {
            content: "Unable to fetch leaderboard data right now. Please try again in a moment.",
            status: "error",
          });
        }
        return;
      }

      if (intent.type === "stake") {
        updateMessage(actionId, {
          content: "Preparing to stake your land plots...",
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

        let tokenIds: number[] = [];
        if (intent.stakeAll) {
          const data = await fetchWalletNfts(
            address as `0x${string}`,
            nftInfo.address,
          );
          const items = Array.isArray(data?.items) ? data.items : [];
          tokenIds = items
            .map((item: any) => Number(item?.token_id))
            .filter((id: number) => Number.isFinite(id) && id > 0);
        } else if (intent.tokenIds?.length) {
          tokenIds = intent.tokenIds;
        }

        if (intent.tier) {
          tokenIds = tokenIds.filter((id) => {
            const pool = getPoolForTokenId(id);
            return pool?.name === intent.tier;
          });
        }

        if (tokenIds.length === 0) {
          const data = await fetchWalletNfts(
            address as `0x${string}`,
            nftInfo.address,
          );
          const items = Array.isArray(data?.items) ? data.items : [];
          const ownedIds = items
            .map((item: any) => Number(item?.token_id))
            .filter((id: number) => Number.isFinite(id) && id > 0);
          const [legendaryIds, premiumIds, standardIds] = await Promise.all([
            getStakedTokenIds(
              walletClient,
              LEGENDARY_POOL_ADDRESS as `0x${string}`,
              address as `0x${string}`,
            ),
            getStakedTokenIds(
              walletClient,
              PREMIUM_POOL_ADDRESS as `0x${string}`,
              address as `0x${string}`,
            ),
            getStakedTokenIds(
              walletClient,
              STANDARD_POOL_ADDRESS as `0x${string}`,
              address as `0x${string}`,
            ),
          ]);
          const stakedSet = new Set([
            ...legendaryIds,
            ...premiumIds,
            ...standardIds,
          ]);
          const availableIds = ownedIds.filter((id) => !stakedSet.has(id));

          if (availableIds.length === 0) {
            updateMessage(actionId, {
              content: "No available land plots found to stake.",
              status: "error",
            });
            return;
          }

          const selectableCards = availableIds.map((id, index) => {
            let placeholder = "/assets/images/apps/100m2v1.jpg";
            if (id >= 1 && id <= 400) placeholder = "/assets/images/apps/1000m2v1.jpg";
            else if (id >= 401 && id <= 1200) placeholder = "/assets/images/apps/500m2v1.jpg";
            return {
              id: `available-${id}-${index}`,
              name: `Tokenized Landplot #${id}`,
              tokenId: String(id),
              image: placeholder,
              collectionName: "Tokenized Landplot",
              status: "available" as const,
            };
          });

          updateMessage(actionId, {
            content: "Select the land plots you want to stake, then confirm.",
            status: "success",
            nfts: selectableCards,
            selectableNfts: true,
          });
          setSelectedStakeIds([]);
          setStakeSelectionMessageId(actionId);
          return;
        }

        await stakeTokenIds(tokenIds, actionId);
        return;
      }

      if (intent.type === "unstake") {
        updateMessage(actionId, {
          content: "Preparing to unstake your land plots...",
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

        const hasGas = await checkGasBalance(address as `0x${string}`);
        if (!hasGas) {
          updateMessage(actionId, {
            content: "Insufficient funds for gas fee. Please fund your wallet with ETH.",
            status: "error",
          });
          return;
        }

        let tokenIds: number[] = [];
        if (intent.unstakeAll) {
          const [legendaryIds, premiumIds, standardIds] = await Promise.all([
            getStakedTokenIds(
              walletClient,
              LEGENDARY_POOL_ADDRESS as `0x${string}`,
              address as `0x${string}`,
            ),
            getStakedTokenIds(
              walletClient,
              PREMIUM_POOL_ADDRESS as `0x${string}`,
              address as `0x${string}`,
            ),
            getStakedTokenIds(
              walletClient,
              STANDARD_POOL_ADDRESS as `0x${string}`,
              address as `0x${string}`,
            ),
          ]);
          tokenIds = [...legendaryIds, ...premiumIds, ...standardIds];
        } else if (intent.tokenIds?.length) {
          tokenIds = intent.tokenIds;
        }

        if (intent.tier) {
          tokenIds = tokenIds.filter((id) => {
            const pool = getPoolForTokenId(id);
            return pool?.name === intent.tier;
          });
        }

        if (tokenIds.length === 0) {
          updateMessage(actionId, {
            content: "No matching staked land plots found to unstake.",
            status: "error",
          });
          return;
        }

        setStakePendingType("unstake");
        setStakeProgress({ current: 0, total: tokenIds.length });
        setShowStakePendingToast(true);

        const byPool = new Map<string, bigint[]>();
        for (const id of tokenIds) {
          const pool = getPoolForTokenId(id);
          if (!pool) continue;
          if (!byPool.has(pool.address)) byPool.set(pool.address, []);
          byPool.get(pool.address)?.push(BigInt(id));
        }

        const withdrawIface = new ethers.Interface([
          "function withdraw(uint256[] _tokenIds)",
        ]);

        let processedCount = 0;
        for (const [poolAddress, ids] of Array.from(byPool.entries())) {
          if (!ids.length) continue;
          const withdrawData = withdrawIface.encodeFunctionData("withdraw", [ids]) as `0x${string}`;
          await sendTx({
            to: poolAddress,
            data: withdrawData,
            value: BigInt(0),
          });
          processedCount += ids.length;
          setStakeProgress({ current: processedCount, total: tokenIds.length });
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        setShowStakePendingToast(false);
        updateMessage(actionId, {
          content: `Unstaked ${tokenIds.length} land plot(s) successfully.`,
          status: "success",
        });
        return;
      }

      if (intent.type === "nfts") {
        updateMessage(actionId, {
          content: "Checking your land plots on Base...",
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

        const data = await fetchWalletNfts(
          address as `0x${string}`,
          nftInfo.address,
        );
        const items = Array.isArray(data?.items) ? data.items : [];

        if (items.length === 0) {
          updateMessage(actionId, {
            content:
              "No land plots found for this wallet in the landplot collection. " +
              "If you just minted, wait a minute for indexing or confirm you're connected to the right wallet.",
            status: "success",
          });
          return;
        }

        const [legendaryIds, premiumIds, standardIds] = await Promise.all([
          getStakedTokenIds(
            walletClient,
            LEGENDARY_POOL_ADDRESS as `0x${string}`,
            address as `0x${string}`,
          ),
          getStakedTokenIds(
            walletClient,
            PREMIUM_POOL_ADDRESS as `0x${string}`,
            address as `0x${string}`,
          ),
          getStakedTokenIds(
            walletClient,
            STANDARD_POOL_ADDRESS as `0x${string}`,
            address as `0x${string}`,
          ),
        ]);
        const stakedSet = new Set([
          ...legendaryIds,
          ...premiumIds,
          ...standardIds,
        ]);

        const nftCards = items.map((nft: any, index: number) => {
          const tokenId = nft.token_id?.toString?.() || "0";
          const tokenNumber = Number(tokenId);
          let placeholder = "/assets/images/apps/100m2v1.jpg";
          if (tokenNumber >= 1 && tokenNumber <= 400) {
            placeholder = "/assets/images/apps/1000m2v1.jpg";
          } else if (tokenNumber >= 401 && tokenNumber <= 1200) {
            placeholder = "/assets/images/apps/500m2v1.jpg";
          }

          const collectionName =
            nft.name || nft.normalized_metadata?.collectionName || "Tokenized Landplot";

          return {
            id: `${nft.token_address || "nft"}-${tokenId}-${index}`,
            name: `Tokenized Landplot #${tokenId}`,
            tokenId,
            image: placeholder,
            collectionName,
            status: (stakedSet.has(tokenNumber) ? "staked" : "available") as
              | "staked"
              | "available",
          };
        });

        const wantsStaked = /(staked|already staked)/i.test(trimmed);
        const wantsAvailable = /(available|unstaked|not staked)/i.test(trimmed);
        const filteredCards = wantsStaked
          ? nftCards.filter((card) => card.status === "staked")
          : wantsAvailable
            ? nftCards.filter((card) => card.status === "available")
            : nftCards;

        updateMessage(actionId, {
          content:
            `Total plots: ${nftCards.length}. ` +
            `Available: ${nftCards.filter((card) => card.status === "available").length}. ` +
            `Staked: ${nftCards.filter((card) => card.status === "staked").length}.` +
            (data.truncated ? " Showing first 200." : ""),
          status: "success",
          nfts: filteredCards,
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
        let swapAmount = intent.amount;
        if (intent.amount === "all") {
          if (intent.fromSymbol === "ETH") {
            const ethBalance = await getEthBalance(walletClient, address as `0x${string}`);
            if (!ethBalance || ethBalance <= BigInt(0)) {
              updateMessage(actionId, {
                content: "No ETH balance available to swap.",
                status: "error",
              });
              return;
            }

            const gasReserve = parseUnits("0.002", 18);
            if (ethBalance <= gasReserve) {
              updateMessage(actionId, {
                content: "Not enough ETH to cover gas after reserving ~0.002 ETH.",
                status: "error",
              });
              return;
            }

            const swappable = ethBalance - gasReserve;
            swapAmount = formatAmountForSwap(swappable, 18);
          } else {
            const usdcBalance = await getErc20Balance(
              walletClient,
              USDC_TOKEN.address as `0x${string}`,
              address as `0x${string}`,
            );
            if (!usdcBalance || usdcBalance <= BigInt(0)) {
              updateMessage(actionId, {
                content: "No USDC balance available to swap.",
                status: "error",
              });
              return;
            }
            swapAmount = formatAmountForSwap(usdcBalance, 6);
          }
        }

        updateMessage(actionId, {
          content: `Quoting: ${swapAmount} ${intent.fromSymbol} -> ${intent.toSymbol} on Base...`,
          status: "pending",
        });

        const fromToken = intent.fromSymbol === "ETH" ? ETH_TOKEN : USDC_TOKEN;
        const toToken = intent.toSymbol === "ETH" ? ETH_TOKEN : USDC_TOKEN;

        const swapTransaction = await buildSwapTransaction({
          amount: swapAmount,
          fromAddress: address as `0x${string}`,
          from: fromToken,
          to: toToken,
          maxSlippage: "0.5",
          useAggregator: intent.fromSymbol === "USDC" || intent.toSymbol === "ETH",
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
          const approveNonce = await getPendingNonce(
            walletClient,
            address as `0x${string}`,
          );
          const approveHash = await sendTx({
            to: approveTx.to,
            data: approveTx.data as `0x${string}`,
            value: approveTx.value,
            ...(approveTx.gas ? { gas: approveTx.gas } : {}),
            ...(approveTx.maxFeePerGas ? { maxFeePerGas: approveTx.maxFeePerGas } : {}),
            ...(approveTx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: approveTx.maxPriorityFeePerGas } : {}),
            ...(typeof approveNonce === "bigint" ? { nonce: approveNonce } : {}),
          });
          await waitForReceipt(walletClient, approveHash);
        }

        const tx = swapTransaction.transaction;
        const swapNonce = await getPendingNonce(walletClient, address as `0x${string}`);
        const txHash = await sendTx({
          to: tx.to,
          data: tx.data as `0x${string}`,
          value: tx.value,
          ...(tx.gas ? { gas: tx.gas } : {}),
          ...(tx.maxFeePerGas ? { maxFeePerGas: tx.maxFeePerGas } : {}),
          ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : {}),
          ...(typeof swapNonce === "bigint" ? { nonce: swapNonce } : {}),
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

  const startListening = () => {
    if (isListening) return;
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      setSpeechError("Voice input is not supported in this browser.");
      return;
    }

    setSpeechError(null);
    suppressVoiceSubmitRef.current = false;
    inputBaseRef.current = input;
    finalTranscriptRef.current = "";
    setLiveTranscript("");
    setLastVoicePhrase("");

    const recognition = new SpeechRecognition();
    const isMobile =
      typeof navigator !== "undefined" &&
      /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
    recognition.continuous = !isMobile;
    recognition.interimResults = !isMobile;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let interim = "";
      let finalText = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }

      finalTranscriptRef.current = finalText.trim();

      const combined = [inputBaseRef.current, finalTranscriptRef.current, interim]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (isMobile && combined === lastTranscriptRef.current) {
        return;
      }
      if (isMobile) {
        lastTranscriptRef.current = combined;
      }

      if (isMobile) {
        setInput(finalTranscriptRef.current || inputBaseRef.current);
        setLiveTranscript("");
      } else {
        setInput(combined);
        setLiveTranscript(interim.trim());
      }

      if (!isMobile) {
        if (speechIdleTimerRef.current) {
          clearTimeout(speechIdleTimerRef.current);
        }
        speechIdleTimerRef.current = setTimeout(() => {
          const finalTextNow = [inputBaseRef.current, finalTranscriptRef.current]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (finalTextNow) {
            void submitMessage(finalTextNow, { skipStop: true });
          }
          stopListening(true);
        }, 1700);
      }
    };

    recognition.onerror = (event: any) => {
      setSpeechError(event?.error ? `Voice error: ${event.error}` : "Voice input error.");
      setIsListening(false);
      setLiveTranscript("");
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      setLiveTranscript("");
      recognitionRef.current = null;
      lastTranscriptRef.current = "";
      if (speechIdleTimerRef.current) {
        clearTimeout(speechIdleTimerRef.current);
        speechIdleTimerRef.current = null;
      }
      if (suppressVoiceSubmitRef.current) {
        suppressVoiceSubmitRef.current = false;
        return;
      }
      const finalText = [inputBaseRef.current, finalTranscriptRef.current]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (finalText) {
        setLastVoicePhrase(finalText);
        submitMessage(finalText);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleMicClick = () => {
    if (isListening) {
      const currentText = input.trim();
      stopListening(true);
      if (currentText) {
        void submitMessage(currentText, { skipStop: true });
      }
    } else {
      startListening();
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitMessage(input);
  };

  const toggleStakeSelection = (tokenId: string) => {
    setSelectedStakeIds((prev) =>
      prev.includes(tokenId) ? prev.filter((id) => id !== tokenId) : [...prev, tokenId],
    );
  };

  const stakeTokenIds = async (tokenIds: number[], actionId?: string) => {
    if (tokenIds.length === 0) return;
    setStakePendingType("stake");
    setStakeProgress({ current: 0, total: tokenIds.length });
    setShowStakePendingToast(true);

    const byPool = new Map<string, bigint[]>();
    for (const id of tokenIds) {
      const pool = getPoolForTokenId(id);
      if (!pool) continue;
      if (!byPool.has(pool.address)) byPool.set(pool.address, []);
      byPool.get(pool.address)?.push(BigInt(id));
    }

    const approvalIface = new ethers.Interface([
      "function setApprovalForAll(address operator, bool approved)",
    ]);
    const stakeIface = new ethers.Interface(["function stake(uint256[] _tokenIds)"]);

    let processedCount = 0;
    for (const [poolAddress, ids] of Array.from(byPool.entries())) {
      if (!ids.length) continue;
      const approved = await isApprovedForAll(
        walletClient,
        address as `0x${string}`,
        poolAddress as `0x${string}`,
      );

      if (!approved) {
        const approvalData = approvalIface.encodeFunctionData("setApprovalForAll", [
          poolAddress,
          true,
        ]) as `0x${string}`;
        await sendTx({
          to: NFT_COLLECTION_ADDRESS,
          data: approvalData,
          value: BigInt(0),
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      const stakeData = stakeIface.encodeFunctionData("stake", [ids]) as `0x${string}`;
      await sendTx({
        to: poolAddress,
        data: stakeData,
        value: BigInt(0),
      });
      processedCount += ids.length;
      setStakeProgress({ current: processedCount, total: tokenIds.length });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    setShowStakePendingToast(false);
    if (actionId) {
      updateMessage(actionId, {
        content: `Staked ${tokenIds.length} land plot(s) successfully.`,
        status: "success",
        selectableNfts: false,
      });
    } else {
      addMessage({
        role: "assistant",
        content: `Staked ${tokenIds.length} land plot(s) successfully.`,
        status: "success",
      });
    }
  };

  const confirmStakeSelection = async () => {
    if (!stakeSelectionMessageId) return;
    const tokenIds = selectedStakeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (tokenIds.length === 0) return;
    updateMessage(stakeSelectionMessageId, {
      content: "Staking selected land plots...",
      status: "pending",
      selectableNfts: false,
    });
    setSelectedStakeIds([]);
    setStakeSelectionMessageId(null);
    await stakeTokenIds(tokenIds, stakeSelectionMessageId);
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (isWorking) return;
    setInput(prompt);
    await submitMessage(prompt);
  };

  return (
    <Fragment>
      <Seo title={"Climate Agent"} />
      <div className="container climate-agent">
        <div className="mt-6 flex justify-center">
          <div className="w-full max-w-4xl">
              <div className="mt-3" style={{padding : 0}}>
                <div className="box-body flex flex-col items-center text-center" style={{padding : 0}}>
                  <div className="agent-face" aria-hidden="true">
                    <span className="agent-pixel" />
                    <span className="agent-pixel" />
                    <span className="agent-pixel" />
                  </div>
                <div className="mt-1">
                  <div className="text-3xl dark:text-white font-semibold">Climate Agent</div>
                  <div className="text-sm text-defaulttextcolor/70">Your ai-assistant</div>
                </div>

                <div className="mt-4 flex flex-col items-center gap-3">
                  {needsExternalWalletReconnection && (
                    <div className="text-[11px] text-amber-500">
                      External wallet needs reconnection for signing.
                    </div>
                  )}
                  {clientError && (
                    <div className="text-[11px] text-red-500">{clientError}</div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-defaulttextcolor/70">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleQuickPrompt(prompt)}
                      className="px-4 py-2 rounded-full bg-camel10 dark:bg-bodybg text-sm font-medium text-defaulttextcolor/70 hover:text-defaulttextcolor hover:bg-camel transition"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="box mt-6 flex flex-col">
              <div className="box-body flex flex-col gap-4">
                <div
                  className="flex flex-col gap-3 overflow-y-auto"
                  style={{ minHeight: "300px", maxHeight: "340px" }}
                >
                  {messages.map((message) => {
                    const isUser = message.role === "user";
                    return (
                      <div
                        key={message.id}
                        className={`flex ${isUser ? "justify-end" : "justify-start"} items-start gap-2`}
                      >
                        {!isUser && (
                          <div className="mt-1 text-secondary">
                            <i className="bx bx-bot text-xl"></i>
                          </div>
                        )}
                        <div
                          className={`max-w-[80%] rounded-xl px-4 py-3 text-sm shadow-sm ${isUser
                              ? "bg-secondary text-white"
                              : "bg-camel10 text-defaulttextcolor"
                            }`}
                        >
                          <div
                            className="leading-relaxed"
                            dangerouslySetInnerHTML={{
                              __html: renderMessageHtml(message.content),
                            }}
                          />
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
                                    className={`rounded-lg border border-defaultborder/40 bg-white/80 dark:bg-bodybg p-2 shadow-sm ${
                                      message.selectableNfts && selectedStakeIds.includes(nft.tokenId)
                                        ? "ring-2 ring-secondary"
                                        : ""
                                    }`}
                                    onClick={
                                      message.selectableNfts
                                        ? () => toggleStakeSelection(nft.tokenId)
                                        : undefined
                                    }
                                  >
                                    <div className="aspect-[4/5] w-full overflow-hidden rounded-md bg-slate-100 dark:bg-bodybg">
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
                                      {nft.status && (
                                        <div className="text-[10px] text-defaulttextcolor/60">
                                          Status: {nft.status}
                                        </div>
                                      )}
                                    </div>
                                    {message.selectableNfts && (
                                      <div className="mt-2 text-[11px] text-secondary font-semibold">
                                        {selectedStakeIds.includes(nft.tokenId)
                                          ? "Selected"
                                          : "Tap to select"}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {message.selectableNfts && (
                                <div className="mt-3 flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={selectedStakeIds.length === 0}
                                    onClick={confirmStakeSelection}
                                    className="px-4 py-2 rounded-md bg-secondary text-white text-sm font-medium hover:bg-secondary/90 transition disabled:opacity-60"
                                  >
                                    Stake Selected
                                  </button>
                                </div>
                              )}
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
                <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-nowrap">
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Type a command..."
                    className="flex-1 min-w-0 px-3 py-2 rounded-md bg-swap text-sm dark:text-white dark:placeholder:text-white focus:outline-none focus:ring-2 focus:ring-secondary"
                  />
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={handleMicClick}
                      disabled={!speechSupported || isWorking}
                      className="px-3 py-2 rounded-md bg-secondary text-white text-sm font-medium hover:bg-secondary/90 transition disabled:opacity-60"
                      aria-pressed={isListening}
                      aria-label={isListening ? "Stop voice input" : "Start voice input"}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3zm5 9a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12z" />
                      </svg>
                    </button>
                    <button
                      type="submit"
                      disabled={isWorking}
                      className="px-3 py-2 rounded-md bg-secondary text-white text-sm font-medium hover:bg-secondary/90 transition disabled:opacity-60"
                    >
                      {isWorking ? "Working..." : "Send"}
                    </button>
                  </div>
                </form>
                {(isListening || liveTranscript || lastVoicePhrase || speechError) && (
                  <div className="mt-2 text-xs text-defaulttextcolor/70">
                    {isListening && (
                      <div>
                        Listening... {liveTranscript ? `"${liveTranscript}"` : "Speak now."}
                      </div>
                    )}
                    {!isListening && lastVoicePhrase && (
                      <div>Last phrase: "{lastVoicePhrase}"</div>
                    )}
                    {speechError && <div className="text-red-500">{speechError}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showStakePendingToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:left-auto md:right-6 md:translate-x-0 max-w-[90vw] md:max-w-none">
          <div
            role="alert"
            className="bg-camel shadow-lg rounded-md w-full max-w-2xl min-w-[320px] px-5 py-4"
          >
            <div className="flex items-center gap-4 w-full">
              <div className="flex-shrink-0">
                <img
                  src={
                    stakePendingType === "stake"
                      ? "/assets/images/svg/Staked.svg"
                      : "/assets/images/svg/Unstaked.svg"
                  }
                  alt={stakePendingType === "stake" ? "Staking" : "Unstaking"}
                  width={30}
                  height={30}
                  className="rounded"
                />
              </div>
              <div className="flex-1 text-center px-2">
                <strong className="text-sm font-bold break-words">
                  Pending {stakePendingType === "stake" ? "Staking" : "Unstaking"}:{" "}
                  {stakeProgress.current}/{stakeProgress.total}
                </strong>
              </div>
              <div className="flex-shrink-0">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Fragment>
  );
};

export default ClimateAgentPage;
