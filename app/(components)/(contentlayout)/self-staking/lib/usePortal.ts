"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useConnectedAddress } from "../../useConnectedAddress"
import {
  ContractSnapshot,
  ManagerRow,
  PositionView,
  RoleInfo,
  StakerRow,
  fetchTokenPrice,
  readContractSnapshot,
  readManagers,
  readPositions,
  readRewardsIssued,
  readRoles,
  readStakers,
  readWalletBalances,
} from "./chain"
import { STAKING_CONTRACTS, StakingKind, getStakingContract } from "./config"

const REFRESH_MS = 20_000

export type PortalData = {
  loading: boolean
  refreshing: boolean
  error: string | null
  /** Snapshot per contract kind, so the summary can aggregate both. */
  snapshots: Record<StakingKind, ContractSnapshot | null>
  positions: Record<StakingKind, PositionView[]>
  rewardsIssued: Record<StakingKind, bigint>
  stakers: Record<StakingKind, StakerRow[]>
  managers: Record<StakingKind, ManagerRow[]>
  roles: Record<StakingKind, RoleInfo>
  wallet: { native: bigint; token: bigint }
  price: number | null
  refresh: (silent?: boolean) => Promise<void>
}

const EMPTY_ROLE: RoleInfo = { isAdmin: false, isManager: false }

export function usePortal(options?: { withAdminData?: boolean }) {
  const withAdminData = options?.withAdminData ?? false
  const { address } = useConnectedAddress()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<Record<StakingKind, ContractSnapshot | null>>({
    compound: null,
    liquidity: null,
  })
  const [positions, setPositions] = useState<Record<StakingKind, PositionView[]>>({ compound: [], liquidity: [] })
  const [rewardsIssued, setRewardsIssued] = useState<Record<StakingKind, bigint>>({ compound: BigInt(0), liquidity: BigInt(0) })
  const [stakers, setStakers] = useState<Record<StakingKind, StakerRow[]>>({ compound: [], liquidity: [] })
  const [managers, setManagers] = useState<Record<StakingKind, ManagerRow[]>>({ compound: [], liquidity: [] })
  const [roles, setRoles] = useState<Record<StakingKind, RoleInfo>>({ compound: EMPTY_ROLE, liquidity: EMPTY_ROLE })
  const [wallet, setWallet] = useState({ native: BigInt(0), token: BigInt(0) })
  const [price, setPrice] = useState<number | null>(null)

  const inFlight = useRef(false)

  const load = useCallback(
    async (silent = false) => {
      if (inFlight.current) return
      inFlight.current = true
      if (silent) setRefreshing(true)
      else setLoading(true)

      try {
        const nextSnapshots: Record<StakingKind, ContractSnapshot | null> = { compound: null, liquidity: null }
        const nextPositions: Record<StakingKind, PositionView[]> = { compound: [], liquidity: [] }
        const nextRewards: Record<StakingKind, bigint> = { compound: BigInt(0), liquidity: BigInt(0) }
        const nextStakers: Record<StakingKind, StakerRow[]> = { compound: [], liquidity: [] }
        const nextManagers: Record<StakingKind, ManagerRow[]> = { compound: [], liquidity: [] }
        const nextRoles: Record<StakingKind, RoleInfo> = { compound: EMPTY_ROLE, liquidity: EMPTY_ROLE }

        for (const contract of STAKING_CONTRACTS) {
          const snapshot = await readContractSnapshot(contract)
          nextSnapshots[contract.kind] = snapshot

          if (address) {
            nextPositions[contract.kind] = await readPositions(contract, snapshot.pools, address as `0x${string}`)
            nextRoles[contract.kind] = await readRoles(contract, address as `0x${string}`)
          }

          if (withAdminData) {
            nextRewards[contract.kind] = await readRewardsIssued(contract)
            nextStakers[contract.kind] = await readStakers(contract, snapshot.pools)
            nextManagers[contract.kind] = await readManagers(contract)
          }
        }

        setSnapshots(nextSnapshots)
        setPositions(nextPositions)
        setRewardsIssued(nextRewards)
        setStakers(nextStakers)
        setManagers(nextManagers)
        setRoles(nextRoles)
        setError(null)

        const token = nextSnapshots.compound?.token
        if (address && token) {
          setWallet(await readWalletBalances(address as `0x${string}`, token.address))
        } else {
          setWallet({ native: BigInt(0), token: BigInt(0) })
        }
        if (token) setPrice(await fetchTokenPrice(token.address))
      } catch (err: any) {
        setError(err?.shortMessage || err?.message || "Unable to read the staking contracts.")
      } finally {
        inFlight.current = false
        setLoading(false)
        setRefreshing(false)
      }
    },
    [address, withAdminData]
  )

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => void load(true), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  return useMemo<PortalData>(
    () => ({
      loading,
      refreshing,
      error,
      snapshots,
      positions,
      rewardsIssued,
      stakers,
      managers,
      roles,
      wallet,
      price,
      refresh: load,
    }),
    [loading, refreshing, error, snapshots, positions, rewardsIssued, stakers, managers, roles, wallet, price, load]
  )
}

export { getStakingContract }
