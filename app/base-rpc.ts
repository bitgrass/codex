import { base } from "viem/chains";

export const DEFAULT_BASE_RPC_URL =
  "https://lb.drpc.live/base/AvfhoJ8RAU6hp7av6t9X6iwipgXaOOsR8ZYctiKh6MJI";

export const BASE_CHAIN_ID = base.id;
export const BASE_HEX_CHAIN_ID = `0x${base.id.toString(16)}` as const;

export function getBaseRpcUrl() {
  const configured =
    process.env.NEXT_PUBLIC_BASE_RPC_URL ||
    process.env.BASE_MAINNET_RPC_URL ||
    process.env.BASE_RPC_URL;

  const normalized = String(configured || "").trim();

  // Guard against stale envs still pointing to Moralis node URL.
  if (/moralis-nodes\.com\/base/i.test(normalized)) {
    return DEFAULT_BASE_RPC_URL;
  }

  if (!normalized) {
    return DEFAULT_BASE_RPC_URL;
  }

  return normalized;
}

export const BASE_RPC_URL = getBaseRpcUrl();

export const BASE_WALLET_CHAIN_PARAMS = {
  chainId: BASE_HEX_CHAIN_ID,
  chainName: base.name,
  nativeCurrency: base.nativeCurrency,
  rpcUrls: [BASE_RPC_URL],
  blockExplorerUrls: [base.blockExplorers.default.url],
} as const;

export const baseChainWithRpc = {
  ...base,
  rpcUrls: {
    ...base.rpcUrls,
    default: {
      ...base.rpcUrls.default,
      http: [BASE_RPC_URL],
    },
  },
} as typeof base;
