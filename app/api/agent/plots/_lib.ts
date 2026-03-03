import { ethers } from "ethers";

export const BASE_CHAIN_ID = 8453;
export const NFT_CONTRACT_ADDRESS = "0x95273ead1dc63b4d809018f10c3e659c5fb0b8a5" as const;
export const SEADROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5" as const;
export const SEADROP_CONDUIT = "0x0000a26b00c1F0DF003000390027140000fAa719" as const;

export type PlotTier = "Standard" | "Premium" | "Legendary";
type SecondaryTier = Exclude<PlotTier, "Standard">;

type OpenSeaListing = Record<string, unknown>;

export type NormalizedTierListing = {
  orderHash: string;
  protocolAddress: `0x${string}`;
  tokenId: number;
  priceWei: string;
  raw: OpenSeaListing;
};

const SECONDARY_TIER_RANGES: Record<SecondaryTier, { min: number; max: number }> = {
  Legendary: { min: 1, max: 400 },
  Premium: { min: 401, max: 1200 },
};

const SEADROP_READ_ABI = [
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
];

const SEADROP_MINT_ABI = [
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
];

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const DIGITS_REGEX = /^\d+$/;

function getBaseRpcUrl() {
  return process.env.BASE_MAINNET_RPC_URL || process.env.BASE_RPC_URL || "https://mainnet.base.org";
}

function getCollectionSlug() {
  const value = process.env.OPENSEA_COLLECTION || process.env.NEXT_PUBLIC_OPENSEA_COLLECTION;
  if (!value) {
    throw new Error("OpenSea collection slug is not configured.");
  }
  return value;
}

function getOpenSeaApiKey() {
  const value = process.env.OPENSEA_API_KEY || process.env.NEXT_PUBLIC_OPENSEA_API_KEY;
  if (!value) {
    throw new Error("OpenSea API key is not configured.");
  }
  return value;
}

function parseWei(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return BigInt(Math.trunc(value));
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DIGITS_REGEX.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

function extractTokenId(listing: OpenSeaListing): number | null {
  const raw = (listing as any)?.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria;
  const tokenId = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(tokenId) || tokenId <= 0) return null;
  return tokenId;
}

function extractPriceWei(listing: OpenSeaListing): bigint | null {
  const candidates: unknown[] = [
    (listing as any)?.current_price,
    (listing as any)?.price?.current?.value,
    (listing as any)?.protocol_data?.parameters?.consideration?.[0]?.startAmount,
    (listing as any)?.protocol_data?.parameters?.consideration?.[0]?.endAmount,
  ];
  for (const candidate of candidates) {
    const parsed = parseWei(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function isActiveListing(listing: OpenSeaListing, nowSec: number) {
  const cancelled = Boolean((listing as any)?.cancelled ?? (listing as any)?.canceled);
  const fulfilled = Boolean((listing as any)?.fulfilled);
  const expirationRaw =
    (listing as any)?.expiration_time ?? (listing as any)?.protocol_data?.parameters?.endTime;

  let notExpired = true;
  if (expirationRaw !== undefined && expirationRaw !== null && `${expirationRaw}` !== "") {
    const expiration = Number.parseInt(String(expirationRaw), 10);
    if (Number.isFinite(expiration)) {
      notExpired = expiration > nowSec;
    }
  }

  const requiredOfferer = process.env.NEXT_PUBLIC_OPENSEA_ADDRESS?.toLowerCase();
  if (requiredOfferer) {
    const offerer = String((listing as any)?.protocol_data?.parameters?.offerer ?? "").toLowerCase();
    if (!offerer || offerer !== requiredOfferer) return false;
  }

  return !cancelled && !fulfilled && notExpired;
}

function normalizeListing(listing: OpenSeaListing): NormalizedTierListing | null {
  const orderHash = String((listing as any)?.order_hash ?? "").trim();
  const protocolAddress = String((listing as any)?.protocol_address ?? "").trim();
  const tokenId = extractTokenId(listing);
  const priceWei = extractPriceWei(listing);

  if (!orderHash) return null;
  if (!ADDRESS_REGEX.test(protocolAddress)) return null;
  if (tokenId === null || priceWei === null) return null;

  return {
    orderHash,
    protocolAddress: protocolAddress as `0x${string}`,
    tokenId,
    priceWei: priceWei.toString(),
    raw: listing,
  };
}

function isListingInTierRange(tokenId: number, tier: SecondaryTier) {
  const range = SECONDARY_TIER_RANGES[tier];
  return tokenId >= range.min && tokenId <= range.max;
}

function compareListings(a: NormalizedTierListing, b: NormalizedTierListing) {
  const priceA = BigInt(a.priceWei);
  const priceB = BigInt(b.priceWei);
  if (priceA < priceB) return -1;
  if (priceA > priceB) return 1;
  return a.tokenId - b.tokenId;
}

async function fetchCollectionListings(maxPages = 6, limitPerPage = 50): Promise<OpenSeaListing[]> {
  const apiKey = getOpenSeaApiKey();
  const collection = getCollectionSlug();
  const listings: OpenSeaListing[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`https://api.opensea.io/api/v2/listings/collection/${collection}/all`);
    url.searchParams.set("limit", String(limitPerPage));
    if (cursor) url.searchParams.set("next", cursor);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
        "user-agent": "Bitgrass/1.0 (+dev.bitgrass.com)",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenSea listings request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => null);
    const pageListings = Array.isArray(data?.listings) ? (data.listings as OpenSeaListing[]) : [];
    listings.push(...pageListings);

    cursor = typeof data?.next === "string" && data.next.length > 0 ? data.next : null;
    if (!cursor) break;
  }

  return listings;
}

async function getSecondaryListings(tier: SecondaryTier) {
  const listings = await fetchCollectionListings();
  const nowSec = Math.floor(Date.now() / 1000);

  return listings
    .filter((listing) => isActiveListing(listing, nowSec))
    .map((listing) => normalizeListing(listing))
    .filter((listing): listing is NormalizedTierListing => Boolean(listing))
    .filter((listing) => isListingInTierRange(listing.tokenId, tier));
}

export function isValidAddress(value: string) {
  return ADDRESS_REGEX.test(value);
}

export async function getStandardMintQuote(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("Quantity must be an integer between 1 and 20.");
  }

  const provider = new ethers.JsonRpcProvider(getBaseRpcUrl());
  const contract = new ethers.Contract(SEADROP_ADDRESS, SEADROP_READ_ABI, provider);
  const publicDrop = await contract.getPublicDrop(NFT_CONTRACT_ADDRESS);
  const mintPriceCandidate = publicDrop?.mintPrice ?? (Array.isArray(publicDrop) ? publicDrop[0] : null);

  if (typeof mintPriceCandidate !== "bigint") {
    throw new Error("Failed to read mint price from SeaDrop.");
  }

  const unitPriceWei = mintPriceCandidate;
  const totalPriceWei = unitPriceWei * BigInt(quantity);
  return { quantity, unitPriceWei, totalPriceWei };
}

export function buildStandardMintTransaction(params: {
  buyerAddress: `0x${string}`;
  quantity: number;
  unitPriceWei: bigint;
}) {
  const { buyerAddress, quantity, unitPriceWei } = params;

  const iface = new ethers.Interface(SEADROP_MINT_ABI);
  const data = iface.encodeFunctionData("mintPublic", [
    NFT_CONTRACT_ADDRESS,
    SEADROP_CONDUIT,
    buyerAddress,
    BigInt(quantity),
  ]);

  const value = (unitPriceWei * BigInt(quantity)).toString();

  return {
    to: SEADROP_ADDRESS as `0x${string}`,
    data,
    value,
    functionName: "mintPublic",
  };
}

export async function findBestTierListing(tier: SecondaryTier) {
  const matches = await getSecondaryListings(tier);
  if (!matches.length) return null;
  return [...matches].sort(compareListings)[0];
}

export async function findTierListingByOrderHash(tier: SecondaryTier, orderHash: string) {
  const normalizedHash = orderHash.toLowerCase();
  const matches = await getSecondaryListings(tier);
  return (
    matches.find((listing) => listing.orderHash.toLowerCase() === normalizedHash) ?? null
  );
}

export async function fetchFulfillmentData(params: {
  orderHash: string;
  protocolAddress: string;
  buyerAddress: string;
}) {
  const apiKey = getOpenSeaApiKey();
  const { orderHash, protocolAddress, buyerAddress } = params;

  const res = await fetch("https://api.opensea.io/api/v2/listings/fulfillment_data", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      accept: "application/json",
      "user-agent": "Bitgrass/1.0 (+dev.bitgrass.com)",
    },
    body: JSON.stringify({
      listing: {
        hash: orderHash,
        chain: "base",
        protocol_address: protocolAddress,
      },
      fulfiller: {
        address: buyerAddress,
      },
    }),
    cache: "no-store",
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.errors?.[0] || payload?.detail || "OpenSea fulfillment request failed.";
    throw new Error(`${message} (status ${res.status})`);
  }

  if (!payload?.fulfillment_data?.transaction) {
    throw new Error("OpenSea fulfillment response is missing transaction data.");
  }

  return payload;
}
