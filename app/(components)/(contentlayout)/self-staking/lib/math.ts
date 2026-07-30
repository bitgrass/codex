import { formatUnits, parseUnits } from "viem"

import { DAY_SECONDS, SECONDS_PER_YEAR, StakingKind } from "./config"

/**
 * Both contracts store the rate scaled by 1000 (`apy = APR% * 10`), so 224 => 22.4% APR.
 */
export function rateToAprPercent(rawRate: bigint | number) {
  return Number(rawRate) / 10
}

export function aprPercentToRate(aprPercent: number) {
  return BigInt(Math.round(aprPercent * 10))
}

/**
 * Compound pools accrue every second (`accrueInterest` on a ray rate), so the effective
 * yield is the continuously compounded APY. Liquidity pools pay a flat/linear rate.
 */
export function effectiveApyPercent(aprPercent: number, kind: StakingKind) {
  if (kind === "liquidity") return aprPercent
  return (Math.exp(aprPercent / 100) - 1) * 100
}

/** Rewards produced by `principal` over `seconds`, using the pool's own accrual model. */
export function projectRewards(principal: number, aprPercent: number, seconds: number, kind: StakingKind) {
  if (principal <= 0 || aprPercent <= 0 || seconds <= 0) return 0
  const years = seconds / SECONDS_PER_YEAR
  if (kind === "liquidity") return principal * (aprPercent / 100) * years
  return principal * (Math.exp((aprPercent / 100) * years) - 1)
}

/**
 * Max reward liability of a pool: full capacity earning until the pool expires.
 * Mirrors the "Estimated cost of operation" figure (capacity + APY + expiration date).
 */
export function estimatedPoolCost(
  capacity: number,
  aprPercent: number,
  endDateSeconds: number,
  kind: StakingKind,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  const window = Math.max(0, endDateSeconds - nowSeconds)
  return projectRewards(capacity, aprPercent, window, kind)
}

/** Rewards the currently staked amount will generate over `months`, capped at pool expiry. */
export function projectedRewardsForMonths(
  staked: number,
  aprPercent: number,
  endDateSeconds: number,
  months: number,
  kind: StakingKind,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  const horizon = Math.round(months * 30.4375 * DAY_SECONDS)
  const untilExpiry = Math.max(0, endDateSeconds - nowSeconds)
  return projectRewards(staked, aprPercent, Math.min(horizon, untilExpiry), kind)
}

export function isPoolExpired(endDateSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)) {
  return endDateSeconds <= nowSeconds
}

/**
 * The contract refuses deposits once `endDate - lockPeriod` has passed, so a pool can be
 * live yet closed for new stakes.
 */
export function stakingClosesAt(endDateSeconds: number, lockPeriodInDays: number) {
  return endDateSeconds - lockPeriodInDays * DAY_SECONDS
}

export function canStakeNow(
  endDateSeconds: number,
  lockPeriodInDays: number,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  return nowSeconds <= stakingClosesAt(endDateSeconds, lockPeriodInDays)
}

export function unlockTimestamp(depositTimeSeconds: number, lockPeriodInDays: number) {
  return depositTimeSeconds + lockPeriodInDays * DAY_SECONDS
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export function toUnits(value: bigint, decimals = 18) {
  try {
    return Number(formatUnits(value, decimals))
  } catch {
    return 0
  }
}

export function fromUnits(value: string | number, decimals = 18): bigint {
  const raw = String(value ?? "").trim()
  if (!raw || Number.isNaN(Number(raw))) return BigInt(0)
  try {
    return parseUnits(raw, decimals)
  } catch {
    return BigInt(0)
  }
}

export function formatAmount(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return "0"
  return value.toLocaleString("en-US", { maximumFractionDigits, minimumFractionDigits: 0 })
}

export function formatToken(value: number, symbol: string, maximumFractionDigits = 2) {
  return `${formatAmount(value, maximumFractionDigits)} ${symbol}`
}

/** 10M / 1.2B style compaction used in the pool rows. */
export function formatCompact(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return "0"
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${trimZeros(value / 1e9, maximumFractionDigits)}B`
  if (abs >= 1e6) return `${trimZeros(value / 1e6, maximumFractionDigits)}M`
  if (abs >= 1e3) return `${trimZeros(value / 1e3, maximumFractionDigits)}K`
  return formatAmount(value, maximumFractionDigits)
}

function trimZeros(value: number, maximumFractionDigits: number) {
  return Number(value.toFixed(maximumFractionDigits)).toString()
}

export function formatPercent(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "0%"
  return `${value.toFixed(digits)}%`
}

export function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "~$0"
  if (value === 0) return "~$0"
  if (value < 0.01) return "~$0.0"
  return `~$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
}

export function shortAddress(address?: string | null, lead = 6, tail = 4) {
  if (!address) return "—"
  if (address.length <= lead + tail) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Sep 30, 2026" + "11:26 UTC" - the portal always renders pool dates in UTC. */
export function formatUtcDate(seconds: number) {
  if (!seconds) return "—"
  const d = new Date(seconds * 1000)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export function formatUtcTime(seconds: number) {
  if (!seconds) return ""
  const d = new Date(seconds * 1000)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function formatUtcDateTime(seconds: number) {
  if (!seconds) return "—"
  return `${formatUtcDate(seconds)} | ${pad(new Date(seconds * 1000).getUTCHours())}:${pad(
    new Date(seconds * 1000).getUTCMinutes()
  )}`
}

/** Value for `<input type="datetime-local">`, kept in UTC so admins type UTC directly. */
export function toUtcInputValue(seconds: number) {
  if (!seconds) return ""
  const d = new Date(seconds * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}`
}

export function fromUtcInputValue(value: string) {
  if (!value) return 0
  const [datePart, timePart = "00:00"] = value.split("T")
  const [y, m, d] = datePart.split("-").map(Number)
  const [hh, mm] = timePart.split(":").map(Number)
  if (!y || !m || !d) return 0
  return Math.floor(Date.UTC(y, m - 1, d, hh || 0, mm || 0) / 1000)
}

export function formatCountdown(secondsLeft: number) {
  if (secondsLeft <= 0) return "Unlocked"
  const days = Math.floor(secondsLeft / DAY_SECONDS)
  const hours = Math.floor((secondsLeft % DAY_SECONDS) / 3600)
  const minutes = Math.floor((secondsLeft % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}
