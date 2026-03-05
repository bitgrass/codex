import { ethers } from "ethers";

export const BASE_CHAIN_ID = 8453;
export const NFT_COLLECTION_ADDRESS = "0x95273ead1dc63b4d809018f10c3e659c5fb0b8a5" as const;
export const LEGENDARY_POOL_ADDRESS = "0xAbdD77516765235e3121773bcB4E33984c604D7C" as const;
export const PREMIUM_POOL_ADDRESS = "0xCe6409e0146ffFa252Dbb3105c1D5285c73b4274" as const;
export const STANDARD_POOL_ADDRESS = "0xE70886Db1d0F52B3B8Ced3538E048d8263C16302" as const;
export const REWARD_TOKEN_ADDRESS = "0x20429F731096e359910921994A267d32ef576720" as const;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const LEADERBOARD_API = "https://durable-object-starter.bitgrass-crypto.workers.dev" as const;

export type PlotTier = "Legendary" | "Premium" | "Standard";

export type PoolInfo = {
  tier: PlotTier;
  address: `0x${string}`;
  minTokenId: number;
  maxTokenId: number;
};

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const NFT_APPROVAL_ABI = [
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
];

const STAKING_ABI = [
  "function getStakeInfo(address _staker) view returns (uint256[] _tokensStaked, uint256 _rewards)",
  "function stake(uint256[] _tokenIds)",
  "function withdraw(uint256[] _tokenIds)",
  "function claimRewards()",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const pools: PoolInfo[] = [
  {
    tier: "Legendary",
    address: LEGENDARY_POOL_ADDRESS,
    minTokenId: 1,
    maxTokenId: 400,
  },
  {
    tier: "Premium",
    address: PREMIUM_POOL_ADDRESS,
    minTokenId: 401,
    maxTokenId: 1200,
  },
  {
    tier: "Standard",
    address: STANDARD_POOL_ADDRESS,
    minTokenId: 1201,
    maxTokenId: 3200,
  },
];

function getRpcUrl() {
  return process.env.BASE_MAINNET_RPC_URL || process.env.BASE_RPC_URL || "https://mainnet.base.org";
}

function getMoralisApiKey() {
  const value = process.env.MORALIS_API_KEY || process.env.NEXT_PUBLIC_MORALIS_APY_KEY;
  if (!value) {
    throw new Error("Moralis API key is not configured.");
  }
  return value;
}

function createProvider() {
  return new ethers.JsonRpcProvider(getRpcUrl());
}

export function isValidAddress(value: string) {
  return ADDRESS_REGEX.test(value);
}

export function toRpcHexQuantity(value: unknown): `0x${string}` {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      return trimmed as `0x${string}`;
    }
    if (/^\d+$/.test(trimmed)) {
      return `0x${BigInt(trimmed).toString(16)}` as `0x${string}`;
    }
  }
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}` as `0x${string}`;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return `0x${BigInt(Math.trunc(value)).toString(16)}` as `0x${string}`;
  }
  return "0x0";
}

export function normalizeTokenIds(tokenIds: unknown[] | undefined) {
  if (!tokenIds?.length) return [];
  const unique = new Set<number>();
  for (const raw of tokenIds) {
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) {
      unique.add(value);
    }
  }
  return Array.from(unique);
}

export function getPoolForTokenId(tokenId: number): PoolInfo | null {
  return pools.find((pool) => tokenId >= pool.minTokenId && tokenId <= pool.maxTokenId) ?? null;
}

export function getPoolForTier(tier: PlotTier): PoolInfo {
  return pools.find((pool) => pool.tier === tier)!;
}

export function getAllPools() {
  return pools;
}

export function groupTokenIdsByPool(tokenIds: number[]) {
  const grouped = new Map<`0x${string}`, { pool: PoolInfo; tokenIds: number[] }>();
  for (const tokenId of tokenIds) {
    const pool = getPoolForTokenId(tokenId);
    if (!pool) continue;
    const existing = grouped.get(pool.address);
    if (existing) {
      existing.tokenIds.push(tokenId);
    } else {
      grouped.set(pool.address, { pool, tokenIds: [tokenId] });
    }
  }
  return Array.from(grouped.values());
}

export async function getStakeInfoForPool(walletAddress: `0x${string}`, pool: PoolInfo) {
  const provider = createProvider();
  const contract = new ethers.Contract(pool.address, STAKING_ABI, provider);
  const info = await contract.getStakeInfo(walletAddress);
  const tokens = Array.isArray(info?.[0]) ? (info[0] as bigint[]) : [];
  const rewards = (info?.[1] as bigint) ?? BigInt(0);
  const tokenIds = tokens
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  return {
    pool,
    tokenIds,
    rewardsWei: rewards,
  };
}

export async function getStakeState(walletAddress: `0x${string}`) {
  const [legendary, premium, standard] = await Promise.all([
    getStakeInfoForPool(walletAddress, getPoolForTier("Legendary")),
    getStakeInfoForPool(walletAddress, getPoolForTier("Premium")),
    getStakeInfoForPool(walletAddress, getPoolForTier("Standard")),
  ]);

  const totalRewardsWei = legendary.rewardsWei + premium.rewardsWei + standard.rewardsWei;

  return {
    legendary,
    premium,
    standard,
    totalRewardsWei,
  };
}

export async function isApprovedForAll(
  ownerAddress: `0x${string}`,
  operatorAddress: `0x${string}`,
) {
  const provider = createProvider();
  const contract = new ethers.Contract(NFT_COLLECTION_ADDRESS, NFT_APPROVAL_ABI, provider);
  return Boolean(await contract.isApprovedForAll(ownerAddress, operatorAddress));
}

export function buildApprovalTransaction(operatorAddress: `0x${string}`) {
  const iface = new ethers.Interface(NFT_APPROVAL_ABI);
  const data = iface.encodeFunctionData("setApprovalForAll", [operatorAddress, true]);
  return {
    to: NFT_COLLECTION_ADDRESS,
    data,
    value: "0x0" as `0x${string}`,
  };
}

export function buildStakeTransaction(poolAddress: `0x${string}`, tokenIds: number[]) {
  const iface = new ethers.Interface(STAKING_ABI);
  const ids = tokenIds.map((id) => BigInt(id));
  const data = iface.encodeFunctionData("stake", [ids]);
  return {
    to: poolAddress,
    data,
    value: "0x0" as `0x${string}`,
  };
}

export function buildUnstakeTransaction(poolAddress: `0x${string}`, tokenIds: number[]) {
  const iface = new ethers.Interface(STAKING_ABI);
  const ids = tokenIds.map((id) => BigInt(id));
  const data = iface.encodeFunctionData("withdraw", [ids]);
  return {
    to: poolAddress,
    data,
    value: "0x0" as `0x${string}`,
  };
}

export async function fetchWalletNftTokenIds(walletAddress: `0x${string}`) {
  const apiKey = getMoralisApiKey();
  const allItems: any[] = [];
  const limit = 50;
  const maxItems = 200;
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({
      chain: "base",
      format: "decimal",
      normalizeMetadata: "false",
      media_items: "false",
      include_prices: "false",
      token_addresses: NFT_COLLECTION_ADDRESS.toLowerCase(),
      limit: String(limit),
    });
    if (cursor) params.append("cursor", cursor);

    const res = await fetch(`https://deep-index.moralis.io/api/v2.2/${walletAddress}/nft?${params.toString()}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Moralis NFT request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.result) ? payload.result : [];
    allItems.push(...items);

    cursor = typeof payload?.cursor === "string" && payload.cursor.length > 0 ? payload.cursor : null;
    if (allItems.length >= maxItems) break;
  } while (cursor);

  const tokenIds = allItems
    .map((item) => Number(item?.token_id))
    .filter((id) => Number.isInteger(id) && id > 0);

  return normalizeTokenIds(tokenIds);
}

export async function resolveStakeTokenIds(params: {
  walletAddress: `0x${string}`;
  tokenIds?: number[];
  stakeAll?: boolean;
  tier?: PlotTier;
}) {
  const { walletAddress, stakeAll = false, tier } = params;
  const candidateIds = stakeAll
    ? await fetchWalletNftTokenIds(walletAddress)
    : normalizeTokenIds(params.tokenIds);

  const tierFiltered = tier
    ? candidateIds.filter((id) => getPoolForTokenId(id)?.tier === tier)
    : candidateIds;

  const validIds: number[] = [];
  const skippedInvalid: number[] = [];
  for (const id of tierFiltered) {
    if (getPoolForTokenId(id)) validIds.push(id);
    else skippedInvalid.push(id);
  }

  const state = await getStakeState(walletAddress);
  const stakedSet = new Set<number>([
    ...state.legendary.tokenIds,
    ...state.premium.tokenIds,
    ...state.standard.tokenIds,
  ]);

  const resolvedTokenIds = validIds.filter((id) => !stakedSet.has(id));
  const skippedAlreadyStaked = validIds.filter((id) => stakedSet.has(id));

  return {
    resolvedTokenIds,
    skippedAlreadyStaked,
    skippedInvalid,
  };
}

export async function resolveUnstakeTokenIds(params: {
  walletAddress: `0x${string}`;
  tokenIds?: number[];
  unstakeAll?: boolean;
  tier?: PlotTier;
}) {
  const { walletAddress, unstakeAll = false, tier } = params;
  const state = await getStakeState(walletAddress);

  const stakedIdsAll = [
    ...state.legendary.tokenIds,
    ...state.premium.tokenIds,
    ...state.standard.tokenIds,
  ];
  const stakedSet = new Set(stakedIdsAll);

  const tierScopedStaked = tier
    ? stakedIdsAll.filter((id) => getPoolForTokenId(id)?.tier === tier)
    : stakedIdsAll;

  if (unstakeAll) {
    return {
      resolvedTokenIds: normalizeTokenIds(tierScopedStaked),
      skippedNotStaked: [] as number[],
      skippedInvalid: [] as number[],
    };
  }

  const candidates = normalizeTokenIds(params.tokenIds);
  const tierFiltered = tier
    ? candidates.filter((id) => getPoolForTokenId(id)?.tier === tier)
    : candidates;

  const validIds: number[] = [];
  const skippedInvalid: number[] = [];
  for (const id of tierFiltered) {
    if (getPoolForTokenId(id)) validIds.push(id);
    else skippedInvalid.push(id);
  }

  const resolvedTokenIds = validIds.filter((id) => stakedSet.has(id));
  const skippedNotStaked = validIds.filter((id) => !stakedSet.has(id));

  return {
    resolvedTokenIds,
    skippedNotStaked,
    skippedInvalid,
  };
}

export function buildClaimRewardsTransaction(poolAddress: `0x${string}`) {
  const iface = new ethers.Interface(STAKING_ABI);
  const data = iface.encodeFunctionData("claimRewards");
  return {
    to: poolAddress,
    data,
    value: "0x0" as `0x${string}`,
  };
}

export async function resolveClaimableRewards(walletAddress: `0x${string}`) {
  const state = await getStakeState(walletAddress);
  const claimablePools = [
    state.legendary,
    state.premium,
    state.standard,
  ].filter((pool) => pool.rewardsWei > BigInt(0));

  const totalClaimableWei = claimablePools.reduce((sum, pool) => sum + pool.rewardsWei, BigInt(0));
  return {
    totalClaimableWei,
    pools: claimablePools.map((pool) => ({
      tier: pool.pool.tier,
      poolAddress: pool.pool.address,
      rewardsWei: pool.rewardsWei.toString(),
      rewardsReadable: ethers.formatUnits(pool.rewardsWei, 18),
    })),
  };
}

export async function fetchTotalEarned(walletAddress: `0x${string}`) {
  const apiKey = getMoralisApiKey();
  const response = await fetch(
    `https://deep-index.moralis.io/api/v2.2/${walletAddress}/erc20/transfers?chain=base&contract_addresses=${REWARD_TOKEN_ADDRESS}&limit=100&order=DESC`,
    {
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch earned rewards.");
  }

  const data = await response.json();
  const items = Array.isArray(data?.result) ? data.result : [];
  const addressLower = walletAddress.toLowerCase();
  const legendaryLower = LEGENDARY_POOL_ADDRESS.toLowerCase();
  const premiumLower = PREMIUM_POOL_ADDRESS.toLowerCase();
  const standardLower = STANDARD_POOL_ADDRESS.toLowerCase();

  let totalAll = BigInt(0);
  let legendaryTotal = BigInt(0);
  let premiumTotal = BigInt(0);
  let standardTotal = BigInt(0);

  for (const tx of items) {
    const fromAddress = String(tx?.from_address || "").toLowerCase();
    const toAddress = String(tx?.to_address || "").toLowerCase();
    if (toAddress !== addressLower) continue;
    const value = BigInt(tx?.value || 0);
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
    totalWei: totalAll,
    legendaryWei: legendaryTotal,
    premiumWei: premiumTotal,
    standardWei: standardTotal,
  };
}

export async function fetchLeaderboardTop(count: number) {
  const safeCount = Math.min(50, Math.max(1, Math.floor(count)));
  const res = await fetch(`${LEADERBOARD_API}/leaderboard`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Leaderboard fetch failed (${res.status})`);
  }

  const body = await res.json();
  const ranked = Array.isArray(body?.result) ? body.result : [];
  return ranked.slice(0, safeCount).map((row: any, idx: number) => ({
    rank: idx + 1,
    address: String(row?.address || ""),
    legendary: Number(row?.legendary || 0),
    premium: Number(row?.premium || 0),
    standard: Number(row?.standard || 0),
    btgClaim: Number(row?.btg_claim || 0),
  }));
}

export async function fetchLeaderboardRow(walletAddress: `0x${string}`) {
  const res = await fetch(`${LEADERBOARD_API}/leaderboard`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Leaderboard fetch failed (${res.status})`);
  }

  const body = await res.json();
  const ranked = Array.isArray(body?.result) ? body.result : [];
  const lower = walletAddress.toLowerCase();
  const index = ranked.findIndex((row: any) => String(row?.address || "").toLowerCase() === lower);
  const row = index >= 0 ? ranked[index] : null;

  return {
    found: Boolean(row),
    rank: index >= 0 ? index + 1 : null,
    total: ranked.length,
    row: row
      ? {
          address: String(row?.address || ""),
          legendary: Number(row?.legendary || 0),
          premium: Number(row?.premium || 0),
          standard: Number(row?.standard || 0),
          btgClaim: Number(row?.btg_claim || 0),
        }
      : null,
  };
}

export async function fetchWalletNfts(walletAddress: `0x${string}`) {
  const apiKey = getMoralisApiKey();
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
      token_addresses: NFT_COLLECTION_ADDRESS.toLowerCase(),
    });
    if (cursor) params.append("cursor", cursor);

    const url = `https://deep-index.moralis.io/api/v2.2/${walletAddress}/nft?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to fetch wallet NFTs (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const items = Array.isArray(data?.result) ? data.result : [];
    allItems.push(...items);

    cursor = typeof data?.cursor === "string" && data.cursor.length ? data.cursor : null;
    if (allItems.length >= MAX_ITEMS) break;
  } while (cursor);

  const stakeState = await getStakeState(walletAddress);
  const stakedSet = new Set<number>([
    ...stakeState.legendary.tokenIds,
    ...stakeState.premium.tokenIds,
    ...stakeState.standard.tokenIds,
  ]);

  return allItems.map((item: any, index: number) => {
    const tokenId = String(item?.token_id || "0");
    const tokenIdNumber = Number(tokenId);
    const isStaked = Number.isFinite(tokenIdNumber) && stakedSet.has(tokenIdNumber);
    const image =
      item?.normalized_metadata?.image ||
      item?.media?.items?.[0]?.gateway ||
      item?.metadata?.image ||
      null;
    return {
      id: `${item?.token_address || "nft"}-${tokenId}-${index}`,
      tokenId,
      tokenAddress: String(item?.token_address || ""),
      name:
        String(item?.name || "").trim() ||
        String(item?.normalized_metadata?.name || "").trim() ||
        `Tokenized Landplot #${tokenId}`,
      collectionName:
        String(item?.normalized_metadata?.collectionName || "").trim() ||
        String(item?.name || "").trim() ||
        "Tokenized Landplot",
      image,
      status: isStaked ? "staked" : "available",
    };
  });
}

export async function fetchWalletBalances(walletAddress: `0x${string}`) {
  const provider = createProvider();
  const [ethBalanceWei, usdcBalanceWei] = await Promise.all([
    provider.getBalance(walletAddress),
    new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider).balanceOf(walletAddress) as Promise<bigint>,
  ]);

  return {
    ethWei: ethBalanceWei,
    usdcRaw: usdcBalanceWei,
    eth: ethers.formatEther(ethBalanceWei),
    usdc: ethers.formatUnits(usdcBalanceWei, 6),
  };
}

export function buildTransferTransaction(params: {
  symbol: "ETH" | "USDC";
  toAddress: `0x${string}`;
  amount: string;
}) {
  const { symbol, toAddress, amount } = params;
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    throw new Error("Invalid transfer amount.");
  }

  if (symbol === "ETH") {
    const value = ethers.parseEther(amount);
    return {
      to: toAddress,
      data: "0x" as `0x${string}`,
      value: toRpcHexQuantity(value),
      token: "ETH" as const,
      amountRaw: value.toString(),
      decimals: 18,
    };
  }

  const value = ethers.parseUnits(amount, 6);
  const iface = new ethers.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData("transfer", [toAddress, value]);
  return {
    to: USDC_ADDRESS,
    data: data as `0x${string}`,
    value: "0x0" as `0x${string}`,
    token: "USDC" as const,
    amountRaw: value.toString(),
    decimals: 6,
  };
}
