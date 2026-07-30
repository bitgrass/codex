import { createPublicClient, http, maxUint256 } from "viem"
import { base } from "viem/chains"

import { erc20Abi } from "./abis"
import {
  BASE_RPC_URL,
  BTG_TOKEN,
  DEFAULT_ADMIN_ROLE,
  MANAGER_ROLE,
  StakingContractConfig,
  StakingKind,
} from "./config"
import { rateToAprPercent, toUnits } from "./math"

export const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
  batch: { multicall: true },
})

export type TokenMeta = {
  address: `0x${string}`
  symbol: string
  decimals: number
}

export type PoolView = {
  pid: number
  kind: StakingKind
  /** Raw contract rate (APR% * 10). */
  rawRate: bigint
  aprPercent: number
  lockPeriodInDays: number
  startDate: number
  endDate: number
  totalDeposit: bigint
  hardCap: bigint
  token: TokenMeta
  /** Liquidity pools pay a different token than the one deposited. */
  rewardToken: TokenMeta
  totalInvestors: number
  isWithdrawLocked: boolean
  /** Compound expresses multipliers in tenths (10 = 1x), the LP locker in hundredths (100 = 1x). */
  multiplierBase: 10 | 100
  /** Liquidity pools ignore the hard cap (it is stored as uint256 max). */
  hasHardCap: boolean
  nft: {
    active: boolean
    name: string
    contractAdd: `0x${string}`
    multiplier: number
    startIdx: number
    endIdx: number
  } | null
}

export type PositionView = {
  pid: number
  totalInvested: bigint
  totalWithdrawn: bigint
  totalClaimed: bigint
  depositTime: number
  lastPayout: number
  pending: bigint
  canClaim: boolean
  multiplier: number
}

export type ContractSnapshot = {
  kind: StakingKind
  address: `0x${string}`
  pools: PoolView[]
  /** Token balance held by the staking contract (principal + reward buffer). */
  balance: bigint
  token: TokenMeta
  feePercent: number
  feeAddress: `0x${string}` | null
  compounder: `0x${string}` | null
  depositFeeBp: number
}

const tokenMetaCache = new Map<string, TokenMeta>()

export async function readTokenMeta(address: `0x${string}`): Promise<TokenMeta> {
  const key = address.toLowerCase()
  const cached = tokenMetaCache.get(key)
  if (cached) return cached

  if (key === BTG_TOKEN.address.toLowerCase()) {
    const meta = { address, symbol: BTG_TOKEN.symbol, decimals: BTG_TOKEN.decimals }
    tokenMetaCache.set(key, meta)
    return meta
  }

  try {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ])
    const meta = { address, symbol: String(symbol), decimals: Number(decimals) }
    tokenMetaCache.set(key, meta)
    return meta
  } catch {
    const meta = { address, symbol: "TOKEN", decimals: 18 }
    tokenMetaCache.set(key, meta)
    return meta
  }
}

export async function readPools(contract: StakingContractConfig): Promise<PoolView[]> {
  const raw = (await publicClient.readContract({
    address: contract.address,
    abi: contract.abi as any,
    functionName: "getPools",
  })) as any[]

  const pools = await Promise.all(
    raw.map(async (pool: any, pid: number) => {
      if (contract.kind === "compound") {
        const token = await readTokenMeta(pool.token as `0x${string}`)
        let nft: PoolView["nft"] = null
        try {
          const info = (await publicClient.readContract({
            address: contract.address,
            abi: contract.abi as any,
            functionName: "nftInfo",
            args: [BigInt(pid)],
          })) as any[]
          nft = {
            active: Boolean(info[0]),
            name: String(info[1] ?? ""),
            contractAdd: info[2] as `0x${string}`,
            multiplier: Number(info[3] ?? 10),
            startIdx: Number(info[4] ?? 0),
            endIdx: Number(info[5] ?? 0),
          }
        } catch {
          nft = null
        }

        return {
          pid,
          kind: contract.kind,
          rawRate: BigInt(pool.apy),
          aprPercent: rateToAprPercent(BigInt(pool.apy)),
          lockPeriodInDays: Number(pool.lockPeriodInDays),
          startDate: Number(pool.startDate),
          endDate: Number(pool.endDate),
          totalDeposit: BigInt(pool.totalDeposit),
          hardCap: BigInt(pool.hardCap),
          token,
          rewardToken: token,
          totalInvestors: 0,
          isWithdrawLocked: true,
          multiplierBase: 10,
          hasHardCap: true,
          nft,
        } satisfies PoolView
      }

      const [token, rewardToken] = await Promise.all([
        readTokenMeta(pool.input as `0x${string}`),
        readTokenMeta(pool.reward as `0x${string}`),
      ])

      let nft: PoolView["nft"] = null
      try {
        const info = (await publicClient.readContract({
          address: contract.address,
          abi: contract.abi as any,
          functionName: "multis",
          args: [BigInt(pid)],
        })) as any[]
        nft = {
          active: Boolean(info[2]),
          name: String(info[0] ?? ""),
          contractAdd: info[1] as `0x${string}`,
          multiplier: Number(info[3] ?? 100),
          startIdx: Number(info[4] ?? 0),
          endIdx: Number(info[5] ?? 0),
        }
      } catch {
        nft = null
      }

      const hardCap = BigInt(pool.hardCap)
      return {
        pid,
        kind: contract.kind,
        rawRate: BigInt(pool.rewardRate),
        aprPercent: rateToAprPercent(BigInt(pool.rewardRate)),
        lockPeriodInDays: Number(pool.lockPeriodInDays),
        startDate: Number(pool.startDate),
        endDate: Number(pool.endDate),
        totalDeposit: BigInt(pool.totalInvested),
        hardCap,
        token,
        rewardToken,
        totalInvestors: Number(pool.totalInvestors ?? 0),
        isWithdrawLocked: Boolean(pool.isWithdrawLocked),
        multiplierBase: 100,
        // The locker hard-codes hardCap to uint256 max, so treat it as uncapped.
        hasHardCap: hardCap < maxUint256 / BigInt(2),
        nft,
      } satisfies PoolView
    })
  )

  return pools
}

export async function readContractSnapshot(contract: StakingContractConfig): Promise<ContractSnapshot> {
  const pools = await readPools(contract)
  const token = pools[0]?.token ?? {
    address: BTG_TOKEN.address,
    symbol: BTG_TOKEN.symbol,
    decimals: BTG_TOKEN.decimals,
  }

  const balance = await publicClient
    .readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [contract.address] })
    .catch(() => BigInt(0))

  let feePercent = 0
  let feeAddress: `0x${string}` | null = null
  let compounder: `0x${string}` | null = null
  let depositFeeBp = 0

  if (contract.kind === "compound") {
    const [fee, feeWallet, comp] = await Promise.all([
      publicClient
        .readContract({ address: contract.address, abi: contract.abi as any, functionName: "feePercent" })
        .catch(() => 0),
      publicClient
        .readContract({ address: contract.address, abi: contract.abi as any, functionName: "feeAddress" })
        .catch(() => null),
      publicClient
        .readContract({ address: contract.address, abi: contract.abi as any, functionName: "compounderContract" })
        .catch(() => null),
    ])
    feePercent = Number(fee ?? 0)
    feeAddress = (feeWallet as `0x${string}`) ?? null
    compounder = (comp as `0x${string}`) ?? null
  } else {
    const fee = (await publicClient
      .readContract({ address: contract.address, abi: contract.abi as any, functionName: "fee" })
      .catch(() => null)) as any
    if (fee) {
      depositFeeBp = Number(fee[0] ?? 0)
      feeAddress = (fee[1] as `0x${string}`) ?? null
    }
  }

  return {
    kind: contract.kind,
    address: contract.address,
    pools,
    balance: balance as bigint,
    token,
    feePercent,
    feeAddress,
    compounder,
    depositFeeBp,
  }
}

export async function readPositions(
  contract: StakingContractConfig,
  pools: PoolView[],
  user: `0x${string}`
): Promise<PositionView[]> {
  return Promise.all(
    pools.map(async (pool) => {
      const pid = contract.kind === "compound" ? BigInt(pool.pid) : pool.pid
      const [userInfo, pending, claimable, multiplier] = await Promise.all([
        publicClient
          .readContract({
            address: contract.address,
            abi: contract.abi as any,
            functionName: "users",
            args: [BigInt(pool.pid), user],
          })
          .catch(() => [BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)] as any),
        publicClient
          .readContract({
            address: contract.address,
            abi: contract.abi as any,
            functionName: "payout",
            args: [pid, user],
          })
          .catch(() => BigInt(0)),
        publicClient
          .readContract({
            address: contract.address,
            abi: contract.abi as any,
            functionName: "canClaim",
            args: [pid, user],
          })
          .catch(() => false),
        publicClient
          .readContract({
            address: contract.address,
            abi: contract.abi as any,
            functionName: "calcMultiplier",
            args: [pid, user],
          })
          .catch(() => 10),
      ])

      const info = userInfo as any[]
      return {
        pid: pool.pid,
        totalInvested: BigInt(info[0] ?? BigInt(0)),
        totalWithdrawn: BigInt(info[1] ?? BigInt(0)),
        lastPayout: Number(info[2] ?? 0),
        depositTime: Number(info[3] ?? 0),
        totalClaimed: BigInt(info[4] ?? BigInt(0)),
        pending: BigInt((pending as bigint) ?? BigInt(0)),
        canClaim: Boolean(claimable),
        multiplier: Number(multiplier ?? 10),
      } satisfies PositionView
    })
  )
}

export async function readWalletBalances(user: `0x${string}`, token: `0x${string}`) {
  const [native, erc20] = await Promise.all([
    publicClient.getBalance({ address: user }).catch(() => BigInt(0)),
    publicClient
      .readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [user] })
      .catch(() => BigInt(0)),
  ])
  return { native: native as bigint, token: erc20 as bigint }
}

export async function readAllowance(token: `0x${string}`, owner: `0x${string}`, spender: `0x${string}`) {
  return (await publicClient
    .readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] })
    .catch(() => BigInt(0))) as bigint
}

export type RoleInfo = { isAdmin: boolean; isManager: boolean }

export async function readRoles(contract: StakingContractConfig, user: `0x${string}`): Promise<RoleInfo> {
  const [isAdmin, isManager] = await Promise.all([
    publicClient
      .readContract({
        address: contract.address,
        abi: contract.abi as any,
        functionName: "hasRole",
        args: [DEFAULT_ADMIN_ROLE, user],
      })
      .catch(() => false),
    publicClient
      .readContract({
        address: contract.address,
        abi: contract.abi as any,
        functionName: "hasRole",
        args: [MANAGER_ROLE, user],
      })
      .catch(() => false),
  ])
  return { isAdmin: Boolean(isAdmin), isManager: Boolean(isManager) }
}

export type StakerRow = {
  address: `0x${string}`
  pid: number
  staked: bigint
  pending: bigint
  claimed: bigint
  depositTime: number
}

/**
 * The compound contract keeps no staker registry, so the admin views derive it from
 * `Stake` logs and then re-read the live balances. Cheap here: these pools are young.
 */
export async function readStakers(contract: StakingContractConfig, pools: PoolView[]): Promise<StakerRow[]> {
  if (!pools.length) return []

  const eventName = contract.kind === "compound" ? "Stake" : "Lock"
  const addressKey = "user"

  let logs: any[] = []
  try {
    logs = await publicClient.getLogs({
      address: contract.address,
      event: (contract.abi as unknown as any[]).find((e) => e.type === "event" && e.name === eventName),
      fromBlock: contract.deployBlock,
      toBlock: "latest",
    })
  } catch {
    return []
  }

  const candidates = new Set<string>()
  for (const log of logs) {
    const args = log.args ?? {}
    const addr = (args.addr ?? args[addressKey] ?? args.user) as string | undefined
    if (addr) candidates.add(addr.toLowerCase())
  }

  const compounder =
    contract.kind === "compound"
      ? ((await publicClient
          .readContract({ address: contract.address, abi: contract.abi as any, functionName: "compounderContract" })
          .catch(() => null)) as string | null)
      : null

  const rows: StakerRow[] = []
  for (const candidate of Array.from(candidates)) {
    if (compounder && candidate === compounder.toLowerCase()) continue
    const positions = await readPositions(contract, pools, candidate as `0x${string}`)
    positions.forEach((position) => {
      if (position.totalInvested > BigInt(0)) {
        rows.push({
          address: candidate as `0x${string}`,
          pid: position.pid,
          staked: position.totalInvested,
          pending: position.pending,
          claimed: position.totalClaimed,
          depositTime: position.depositTime,
        })
      }
    })
  }

  return rows
}

/** Total rewards paid out of the contract, summed from `Claim` logs. */
export async function readRewardsIssued(contract: StakingContractConfig): Promise<bigint> {
  try {
    const logs = await publicClient.getLogs({
      address: contract.address,
      event: (contract.abi as unknown as any[]).find((e) => e.type === "event" && e.name === "Claim"),
      fromBlock: contract.deployBlock,
      toBlock: "latest",
    })
    return logs.reduce((total: bigint, log: any) => total + BigInt(log.args?.amount ?? BigInt(0)), BigInt(0))
  } catch {
    return BigInt(0)
  }
}

export type ManagerRow = {
  address: `0x${string}`
  isAdmin: boolean
  isManager: boolean
  addedAt: number | null
}

/** Role holders, reconstructed from AccessControl `RoleGranted` / `RoleRevoked` logs. */
export async function readManagers(contract: StakingContractConfig): Promise<ManagerRow[]> {
  const abi = contract.abi as unknown as any[]
  const grantedEvent = abi.find((e) => e.type === "event" && e.name === "RoleGranted")
  const revokedEvent = abi.find((e) => e.type === "event" && e.name === "RoleRevoked")

  let events: { grant: boolean; log: any }[] = []
  try {
    const [grantedLogs, revokedLogs] = await Promise.all([
      publicClient.getLogs({
        address: contract.address,
        event: grantedEvent,
        fromBlock: contract.deployBlock,
        toBlock: "latest",
      }),
      publicClient.getLogs({
        address: contract.address,
        event: revokedEvent,
        fromBlock: contract.deployBlock,
        toBlock: "latest",
      }),
    ])
    events = [
      ...grantedLogs.map((log: any) => ({ grant: true, log })),
      ...revokedLogs.map((log: any) => ({ grant: false, log })),
    ].sort(
      (a, b) =>
        Number((a.log.blockNumber ?? BigInt(0)) - (b.log.blockNumber ?? BigInt(0))) ||
        Number((a.log.logIndex ?? 0) - (b.log.logIndex ?? 0))
    )
  } catch {
    return []
  }

  const blockTimes = new Map<string, number>()
  const holders = new Map<string, ManagerRow>()

  for (const { grant, log } of events) {
    const account = String(log.args?.account ?? "").toLowerCase()
    const role = String(log.args?.role ?? "").toLowerCase()
    if (!account) continue

    const isAdminRole = role === DEFAULT_ADMIN_ROLE.toLowerCase()
    const isManagerRole = role === MANAGER_ROLE.toLowerCase()
    if (!isAdminRole && !isManagerRole) continue

    const blockKey = String(log.blockNumber)
    if (grant && !blockTimes.has(blockKey)) {
      try {
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber })
        blockTimes.set(blockKey, Number(block.timestamp))
      } catch {
        /* timestamps are cosmetic */
      }
    }

    const current: ManagerRow =
      holders.get(account) ?? { address: account as `0x${string}`, isAdmin: false, isManager: false, addedAt: null }

    const next: ManagerRow = {
      ...current,
      isAdmin: isAdminRole ? grant : current.isAdmin,
      isManager: isManagerRole ? grant : current.isManager,
      addedAt: grant ? current.addedAt ?? blockTimes.get(blockKey) ?? null : current.addedAt,
    }

    if (!next.isAdmin && !next.isManager) holders.delete(account)
    else holders.set(account, next)
  }

  return Array.from(holders.values()).sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin))
}

/** DefiLlama price, same source the previous portal used for its USD figures. */
export async function fetchTokenPrice(token: `0x${string}`): Promise<number | null> {
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/base:${token}`)
    if (!res.ok) return null
    const data = await res.json()
    const price = data?.coins?.[`base:${token}`]?.price
    return typeof price === "number" && price > 0 ? price : null
  } catch {
    return null
  }
}

export function poolUsageRatio(pool: PoolView) {
  if (!pool.hasHardCap) return 0
  const cap = toUnits(pool.hardCap, pool.token.decimals)
  if (cap <= 0) return 0
  return Math.min(1, toUnits(pool.totalDeposit, pool.token.decimals) / cap)
}
