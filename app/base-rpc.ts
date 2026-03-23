import { base } from "viem/chains";

export const DEFAULT_BASE_RPC_URL =
  "https://site1.moralis-nodes.com/base/a9377391d4f34bdc804a9847fc0d7f30";

export const BASE_CHAIN_ID = base.id;
export const BASE_HEX_CHAIN_ID = `0x${base.id.toString(16)}` as const;

export function getBaseRpcUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_RPC_URL ||
    process.env.BASE_MAINNET_RPC_URL ||
    process.env.BASE_RPC_URL ||
    DEFAULT_BASE_RPC_URL
  );
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
