"use client"

import React, { useMemo, useState } from "react"

import { PoolView, poolUsageRatio } from "../lib/chain"
import { BTG_TOKEN, NETWORK_ICON, NETWORK_LABEL, StakingKind, getStakingContract } from "../lib/config"
import {
  effectiveApyPercent,
  formatAmount,
  formatCompact,
  formatCountdown,
  formatPercent,
  formatUsd,
  isPoolExpired,
  toUnits,
  unlockTimestamp,
} from "../lib/math"
import { PortalData } from "../lib/usePortal"
import { useTx } from "../lib/useTx"
import { StakeModal } from "./StakeModal"
import { EmptyState, Notice, ProgressBar, Spinner, StatTile, StatusBadge } from "./ui"

type PoolRow = { kind: StakingKind; pool: PoolView }

export function InvestorPortal({ data }: { data: PortalData }) {
  const { send, address } = useTx()
  const [stakeTarget, setStakeTarget] = useState<PoolRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const allPools = useMemo<PoolRow[]>(() => {
    const rows: PoolRow[] = []
    ;(["compound", "liquidity"] as StakingKind[]).forEach((kind) => {
      data.snapshots[kind]?.pools.forEach((pool) => rows.push({ kind, pool }))
    })
    return rows
  }, [data.snapshots])

  const availablePools = useMemo(() => allPools.filter((row) => !isPoolExpired(row.pool.endDate)), [allPools])

  const totals = useMemo(() => {
    let totalStaked = 0
    let yourStake = 0
    let yourRewards = 0

    allPools.forEach(({ kind, pool }) => {
      const decimals = pool.token.decimals
      totalStaked += toUnits(pool.totalDeposit, decimals)
      const position = data.positions[kind]?.find((item) => item.pid === pool.pid)
      if (position) {
        yourStake += toUnits(position.totalInvested, decimals)
        yourRewards += toUnits(position.pending + position.totalClaimed, pool.rewardToken.decimals)
      }
    })

    return { totalStaked, yourStake, yourRewards }
  }, [allPools, data.positions])

  const positionRows = useMemo(() => {
    const rows: { kind: StakingKind; pool: PoolView; position: NonNullable<PortalData["positions"]["compound"][number]> }[] =
      []
    ;(["compound", "liquidity"] as StakingKind[]).forEach((kind) => {
      data.positions[kind]?.forEach((position) => {
        const pool = data.snapshots[kind]?.pools.find((item) => item.pid === position.pid)
        if (pool && (position.totalInvested > BigInt(0) || position.pending > BigInt(0))) rows.push({ kind, pool, position })
      })
    })
    return rows
  }, [data.positions, data.snapshots])

  const price = data.price

  const runAction = async (
    key: string,
    kind: StakingKind,
    functionName: "claim" | "reinvest" | "unStake" | "unlockAndRemoveLP",
    args: readonly unknown[],
    label: string
  ) => {
    const contract = getStakingContract(kind)
    setActionError(null)
    setBusy(key)
    try {
      await send({ to: contract.address, abi: contract.abi, functionName, args, label })
      await data.refresh(true)
    } catch (err: any) {
      setActionError(err?.message ?? `${label} failed.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-xl bg-gradient-to-r from-primary/25 via-primary/10 to-transparent p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="../../../assets/images/brand-logos/logo-btg.svg" alt="BTG" className="h-11 w-11" />
            <div>
              <p className="text-lg font-semibold">Stake $BTG</p>
              <p className="text-sm text-textmuted">Earn compounding rewards on Base, straight from your wallet.</p>
            </div>
          </div>
          <a
            href="/swap"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            BUY $BTG
          </a>
        </div>
      </div>

      <h6 className="mb-3 text-base font-semibold">Overview</h6>
      <div className="mb-6 grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-6">
          <div className="box h-full">
            <div className="box-body">
              <p className="mb-4 font-semibold">Overview</p>
              <div className="grid grid-cols-2 gap-4">
                <StatTile
                  icon="ri-stack-line"
                  label={`Total ${BTG_TOKEN.symbol} staked`}
                  value={
                    <>
                      {formatCompact(totals.totalStaked)} <span className="text-sm text-textmuted">{BTG_TOKEN.symbol}</span>
                    </>
                  }
                />
                <StatTile
                  icon="ri-money-dollar-circle-line"
                  label="Total value locked"
                  value={price ? formatUsd(totals.totalStaked * price) : "~$0"}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="col-span-12 xl:col-span-6">
          <div className="box h-full">
            <div className="box-body">
              <p className="mb-4 flex items-center gap-1.5 font-semibold">Your Staking Overview</p>
              <div className="grid grid-cols-2 gap-4">
                <StatTile
                  icon="ri-stack-line"
                  label="Your stake"
                  value={
                    <>
                      {formatAmount(totals.yourStake)} <span className="text-sm text-textmuted">{BTG_TOKEN.symbol}</span>
                    </>
                  }
                  sub={price ? formatUsd(totals.yourStake * price) : undefined}
                />
                <StatTile
                  icon="ri-money-dollar-circle-line"
                  label="Your total rewards"
                  value={
                    <>
                      {formatAmount(totals.yourRewards, 4)}{" "}
                      <span className="text-sm text-textmuted">{BTG_TOKEN.symbol}</span>
                    </>
                  }
                  sub={price ? formatUsd(totals.yourRewards * price) : undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {!price ? (
        <div className="mb-6">
          <Notice>Token price data not found on DefiLlama. USD-based analytics are temporarily unavailable.</Notice>
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-6">
          <Notice tone="danger">{actionError}</Notice>
        </div>
      ) : null}

      <h6 className="mb-3 text-base font-semibold">Available pools</h6>
      <div className="box mb-6">
        <div className="box-body !p-0">
          {data.loading ? (
            <Spinner label="Reading pools from Base…" />
          ) : availablePools.length === 0 ? (
            <EmptyState title="No active pools right now" hint="New pools appear here as soon as an admin creates them." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="text-start text-xs text-textmuted">
                    <th className="px-5 py-3 text-start font-normal">Composition &amp; lock period</th>
                    <th className="px-5 py-3 text-start font-normal">Network</th>
                    <th className="px-5 py-3 text-start font-normal">APY</th>
                    <th className="px-5 py-3 text-start font-normal">Total staked</th>
                    <th className="px-5 py-3 text-end font-normal"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-defaultborder/60 dark:divide-white/5">
                  {availablePools.map(({ kind, pool }) => {
                    const decimals = pool.token.decimals
                    const staked = toUnits(pool.totalDeposit, decimals)
                    const cap = toUnits(pool.hardCap, decimals)
                    const ratio = poolUsageRatio(pool)
                    return (
                      <tr key={`${kind}-${pool.pid}`} className="hover:bg-primary/[0.03]">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <img src={BTG_TOKEN.image} alt={pool.token.symbol} className="h-8 w-8" />
                            <div>
                              <p className="font-semibold">{pool.lockPeriodInDays} days lock</p>
                              <p className="text-xs capitalize text-textmuted">{kind}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <img src={NETWORK_ICON} alt={NETWORK_LABEL} className="h-6 w-6" title={NETWORK_LABEL} />
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-primary">
                            {formatPercent(effectiveApyPercent(pool.aprPercent, kind))}
                          </p>
                          <p className="text-xs text-textmuted">{kind === "compound" ? "Compounding" : "Fixed"}</p>
                        </td>
                        <td className="px-5 py-4 min-w-[12rem]">
                          <p className="text-sm">
                            {formatCompact(staked)} {pool.token.symbol}
                            <span className="text-textmuted">
                              {" "}
                              / {pool.hasHardCap ? `${formatCompact(cap)} ${pool.token.symbol}` : "unlimited"}
                            </span>
                          </p>
                          {pool.hasHardCap ? (
                            <div className="mt-2 flex items-center gap-2">
                              <ProgressBar ratio={ratio} />
                              <span className="text-xs text-textmuted">{Math.round(ratio * 100)}%</span>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-4 text-end">
                          <button
                            type="button"
                            onClick={() => setStakeTarget({ kind, pool })}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
                          >
                            Stake
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <h6 className="mb-3 text-base font-semibold">Your positions</h6>
      <div className="box">
        <div className="box-body !p-0">
          {!address ? (
            <EmptyState title="Connect your wallet" hint="Your stakes, rewards and unlock dates show up here." />
          ) : positionRows.length === 0 ? (
            <EmptyState title="You have no active stake yet" hint="Pick a pool above to start earning." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="text-xs text-textmuted">
                    <th className="px-5 py-3 text-start font-normal">Pool</th>
                    <th className="px-5 py-3 text-start font-normal">Your stake</th>
                    <th className="px-5 py-3 text-start font-normal">Claimable rewards</th>
                    <th className="px-5 py-3 text-start font-normal">Lock</th>
                    <th className="px-5 py-3 text-end font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-defaultborder/60 dark:divide-white/5">
                  {positionRows.map(({ kind, pool, position }) => {
                    const decimals = pool.token.decimals
                    const staked = toUnits(position.totalInvested, decimals)
                    const pending = toUnits(position.pending, pool.rewardToken.decimals)
                    const unlockAt = unlockTimestamp(position.depositTime, pool.lockPeriodInDays)
                    const secondsLeft = unlockAt - Math.floor(Date.now() / 1000)
                    const key = `${kind}-${pool.pid}`
                    const boosted = position.multiplier > pool.multiplierBase

                    return (
                      <tr key={key}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <img src={BTG_TOKEN.image} alt={pool.token.symbol} className="h-8 w-8" />
                            <div>
                              <p className="font-semibold">{pool.lockPeriodInDays} days lock</p>
                              <p className="text-xs capitalize text-textmuted">
                                {kind} · {formatPercent(effectiveApyPercent(pool.aprPercent, kind))}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold">
                            {formatAmount(staked, 4)} {pool.token.symbol}
                          </p>
                          {price ? <p className="text-xs text-textmuted">{formatUsd(staked * price)}</p> : null}
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-primary">
                            {formatAmount(pending, 6)} {pool.rewardToken.symbol}
                          </p>
                          {boosted ? (
                            <p className="text-xs text-primary">
                              NFT boost ×{(position.multiplier / pool.multiplierBase).toFixed(1)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-5 py-4">
                          {position.canClaim ? (
                            <StatusBadge status="unlocked" />
                          ) : (
                            <span className="text-sm">
                              {formatCountdown(secondsLeft)}
                              <span className="block text-xs text-textmuted">until unlock</span>
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <ActionButton
                              label="Claim"
                              loading={busy === `${key}-claim`}
                              disabled={!position.canClaim || position.pending === BigInt(0)}
                              onClick={() =>
                                runAction(
                                  `${key}-claim`,
                                  kind,
                                  "claim",
                                  [kind === "compound" ? BigInt(pool.pid) : pool.pid],
                                  "Claim rewards"
                                )
                              }
                            />
                            {kind === "compound" ? (
                              <ActionButton
                                label="Reinvest"
                                loading={busy === `${key}-reinvest`}
                                disabled={position.pending === BigInt(0)}
                                onClick={() =>
                                  runAction(`${key}-reinvest`, kind, "reinvest", [BigInt(pool.pid)], "Reinvest rewards")
                                }
                              />
                            ) : null}
                            <ActionButton
                              label="Unstake"
                              loading={busy === `${key}-unstake`}
                              disabled={!position.canClaim || position.totalInvested === BigInt(0)}
                              onClick={() =>
                                kind === "compound"
                                  ? runAction(
                                      `${key}-unstake`,
                                      kind,
                                      "unStake",
                                      [BigInt(pool.pid), position.totalInvested],
                                      "Unstake"
                                    )
                                  : runAction(
                                      `${key}-unstake`,
                                      kind,
                                      "unlockAndRemoveLP",
                                      [pool.pid, position.totalInvested, BigInt(0), BigInt(0)],
                                      "Unlock LP"
                                    )
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <StakeModal
        open={Boolean(stakeTarget)}
        onClose={() => setStakeTarget(null)}
        pool={stakeTarget?.pool ?? null}
        kind={stakeTarget?.kind ?? "compound"}
        onDone={() => void data.refresh(true)}
      />
    </>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
  loading,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/40 border-t-primary"></span> : null}
      {label}
    </button>
  )
}
