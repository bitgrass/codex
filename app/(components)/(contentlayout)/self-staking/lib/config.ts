import { BASE_RPC_URL, BASE_CHAIN_ID } from "@/app/base-rpc"

import { compoundStakingAbi, liquidityStakingAbi } from "./abis"

export type StakingKind = "compound" | "liquidity"

export type StakingContractConfig = {
  kind: StakingKind
  /** Label used in the contract selector, matches the third party portal wording. */
  label: string
  address: `0x${string}`
  /** Block the beacon proxy was deployed in, used as the lower bound for log scans. */
  deployBlock: bigint
  abi: typeof compoundStakingAbi | typeof liquidityStakingAbi
}

/** Compound (auto reinvest) staking - DecubateMasterChef behind a beacon proxy. */
export const COMPOUND_STAKING: StakingContractConfig = {
  kind: "compound",
  label: "Compound",
  address: "0xfB5908484503dE709c6457D1bEE74610be931527",
  deployBlock: BigInt(31941400),
  abi: compoundStakingAbi,
}

/** Liquidity staking - DCBLiqLocker behind a beacon proxy (Aerodrome LP). */
export const LIQUIDITY_STAKING: StakingContractConfig = {
  kind: "liquidity",
  label: "Liquidity",
  address: "0x1ea3678700f1394567731DBE4c44dD67fcB4dD02",
  deployBlock: BigInt(31941403),
  abi: liquidityStakingAbi,
}

export const STAKING_CONTRACTS: StakingContractConfig[] = [COMPOUND_STAKING, LIQUIDITY_STAKING]

export function getStakingContract(kind: StakingKind) {
  return kind === "liquidity" ? LIQUIDITY_STAKING : COMPOUND_STAKING
}

/** $BTG on Base - the staked / reward token of every pool created so far. */
export const BTG_TOKEN = {
  address: "0xF0D560f492CE0DBb3B5BEa7f003030c71ff4b2E4" as `0x${string}`,
  symbol: "BTG",
  decimals: 18,
  image: "../../../assets/images/brand-logos/logo-btg.svg",
}

export const NETWORK_LABEL = "Base"
export const NETWORK_ICON = "../../../assets/images/svg/coinbase.svg"

export { BASE_RPC_URL, BASE_CHAIN_ID }

export const EXPLORER_URL = "https://basescan.org"

export function explorerAddress(address: string) {
  return `${EXPLORER_URL}/address/${address}`
}

export function explorerTx(hash: string) {
  return `${EXPLORER_URL}/tx/${hash}`
}

/**
 * The compound contract stores apy scaled by DIVISOR = 1000, i.e. `apy = APR% * 10`.
 * The liquidity contract stores rewardRate in basis points with the same effective
 * divisor (`reward = amount * rewardRate / 1000 / 365 days`).
 */
export const APR_DIVISOR = BigInt(1000)

/** Rewards accrue every second, so the compound pools quote a compounded APY. */
export const SECONDS_PER_YEAR = 31_536_000

export const DAY_SECONDS = 86_400

/** MANAGER_ROLE = keccak256("MANAGER_ROLE") - the role the admin portal needs. */
export const MANAGER_ROLE = "0x241ecf16d79d0f8dbfb92cbc07fe17840425976cf0667f022fe9877caa831b08" as `0x${string}`

export const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

/** Aerodrome router used by the liquidity locker for add/remove liquidity. */
export const AERODROME_ROUTER = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" as `0x${string}`

export const WETH_BASE = "0x4200000000000000000000000000000000000006" as `0x${string}`

/** Funds-required horizon used by the admin dashboard (matches the portal wording). */
export const FUNDS_REQUIRED_MONTHS = 3
