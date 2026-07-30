"use client"

import React, { useMemo, useState } from "react"

import { PoolView } from "../lib/chain"
import {
  BTG_TOKEN,
  FUNDS_REQUIRED_MONTHS,
  NETWORK_ICON,
  NETWORK_LABEL,
  STAKING_CONTRACTS,
  StakingKind,
} from "../lib/config"
import {
  canStakeNow,
  effectiveApyPercent,
  formatAmount,
  formatCompact,
  formatPercent,
  formatUsd,
  formatUtcDate,
  formatUtcTime,
  isPoolExpired,
  projectedRewardsForMonths,
  toUnits,
} from "../lib/math"
import { PortalData } from "../lib/usePortal"
import { AddPoolModal } from "./AddPoolModal"
import { EditPoolModal } from "./EditPoolModal"
import { DepositFundsModal, WithdrawFundsModal, rewardBuffer } from "./FundsModals"
import { SettingsPanel } from "./SettingsPanel"
import {
  AddressLink,
  EmptyState,
  InfoTip,
  Notice,
  ProgressBar,
  Spinner,
  StatusBadge,
} from "./ui"

export function AdminPortal({ data }: { data: PortalData }) {
  const [selectedKind, setSelectedKind] = useState<StakingKind>("compound")
  const [contractPickerOpen, setContractPickerOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<{ kind: StakingKind; pool: PoolView } | null>(null)

  const snapshot = data.snapshots[selectedKind]
  const price = data.price
  const canManage = data.roles[selectedKind]?.isManager || data.roles[selectedKind]?.isAdmin

  const summary = useMemo(() => {
    let totalStaked = 0
    let totalCapacity = 0
    let projected = 0
    let active = 0
    let expired = 0

    ;(["compound", "liquidity"] as StakingKind[]).forEach((kind) => {
      data.snapshots[kind]?.pools.forEach((pool) => {
        const decimals = pool.token.decimals
        const staked = toUnits(pool.totalDeposit, decimals)
        totalStaked += staked
        if (pool.hasHardCap) totalCapacity += toUnits(pool.hardCap, decimals)
        projected += projectedRewardsForMonths(
          staked,
          pool.aprPercent,
          pool.endDate,
          FUNDS_REQUIRED_MONTHS,
          kind
        )
        if (isPoolExpired(pool.endDate)) expired += 1
        else active += 1
      })
    })

    const issued =
      toUnits(data.rewardsIssued.compound, BTG_TOKEN.decimals) +
      toUnits(data.rewardsIssued.liquidity, BTG_TOKEN.decimals)

    const stakerAddresses = new Set<string>()
    ;(["compound", "liquidity"] as StakingKind[]).forEach((kind) => {
      data.stakers[kind]?.forEach((row) => stakerAddresses.add(row.address.toLowerCase()))
    })

    return {
      totalStaked,
      totalCapacity,
      capacityRatio: totalCapacity > 0 ? Math.min(1, totalStaked / totalCapacity) : 0,
      projected,
      issued,
      active,
      expired,
      stakers: stakerAddresses.size,
    }
  }, [data.snapshots, data.rewardsIssued, data.stakers])

  /** Rewards the currently staked amount needs over the next 3 months, net of the buffer. */
  const fundsRequired = useMemo(() => {
    if (!snapshot) return 0
    const needed = snapshot.pools.reduce(
      (total, pool) =>
        total +
        projectedRewardsForMonths(
          toUnits(pool.totalDeposit, pool.token.decimals),
          pool.aprPercent,
          pool.endDate,
          FUNDS_REQUIRED_MONTHS,
          snapshot.kind
        ),
      0
    )
    const buffer = toUnits(rewardBuffer(snapshot), snapshot.token.decimals)
    return Math.max(0, needed - buffer)
  }, [snapshot])

  const poolRows = useMemo(() => {
    const rows: { kind: StakingKind; pool: PoolView }[] = []
    ;(["compound", "liquidity"] as StakingKind[]).forEach((kind) => {
      data.snapshots[kind]?.pools.forEach((pool) => rows.push({ kind, pool }))
    })
    return rows.sort((a, b) => b.pool.endDate - a.pool.endDate)
  }, [data.snapshots])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h5 className="text-xl font-semibold">Staking</h5>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={!canManage}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
          title={canManage ? undefined : "Connect a wallet with the manager role"}
        >
          <i className="ri-add-circle-line"></i>
          Add new pool
        </button>
      </div>

      <div className="mb-6 grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-8">
          <div className="box h-full">
            <div className="box-body">
              <p className="mb-5 flex items-center gap-1.5 font-semibold">
                Staking summary
                <InfoTip text="Aggregated across both staking contracts on Base." />
              </p>

              <div className="grid grid-cols-12 items-center gap-6">
                <div className="col-span-12 flex justify-center md:col-span-4">
                  <CapacityRing ratio={summary.capacityRatio} />
                </div>
                <div className="col-span-12 md:col-span-8">
                  <SummaryRow
                    label="Total staked"
                    value={`${formatUsd(price ? summary.totalStaked * price : 0)} (${formatAmount(
                      summary.totalStaked,
                      2
                    )} ${BTG_TOKEN.symbol})`}
                  />
                  <SummaryRow
                    label="Total rewards issued"
                    tip="Sum of every reward claim emitted by the staking contracts."
                    value={`${formatUsd(price ? summary.issued * price : 0)} (${formatAmount(summary.issued, 2)} ${
                      BTG_TOKEN.symbol
                    })`}
                  />
                  <SummaryRow
                    label={`${FUNDS_REQUIRED_MONTHS}-month projected rewards`}
                    tip="Rewards the current total staked amount will generate over the next 3 months."
                    value={`${formatUsd(price ? summary.projected * price : 0)} (${formatAmount(
                      summary.projected,
                      2
                    )} ${BTG_TOKEN.symbol})`}
                  />
                  <SummaryRow label="Pools status" value={`${summary.active} active / ${summary.expired} expired`} />
                  <SummaryRow
                    label="Active Stakers"
                    tip="Unique wallets that currently hold a stake, derived from the contract logs."
                    value={summary.stakers}
                    last
                  />
                </div>
              </div>

              {!price ? (
                <p className="mt-5 text-xs text-textmuted">
                  Token price data not found on DefiLlama. USD-based analytics are temporarily unavailable.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="box h-full">
            <div className="box-body">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-semibold">Contract</p>
                <StatusBadge status={fundsRequired > 0 ? "underfunded" : "funded"} />
              </div>

              <div className="relative mb-4">
                <button
                  type="button"
                  onClick={() => setContractPickerOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2.5 text-sm font-medium"
                >
                  <span className="flex items-center gap-2">
                    <img src={NETWORK_ICON} alt="" className="h-5 w-5" />
                    {STAKING_CONTRACTS.find((item) => item.kind === selectedKind)?.label}
                    <span className="text-textmuted">
                      {selectedKind === "compound" ? "0xfB59…1527" : "0x1ea3…dD02"}
                    </span>
                  </span>
                  <i className={contractPickerOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"}></i>
                </button>
                {contractPickerOpen ? (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-defaultborder/60 bg-bodybg2 shadow-lg dark:border-white/10">
                    {STAKING_CONTRACTS.map((contract) => (
                      <button
                        key={contract.kind}
                        type="button"
                        onClick={() => {
                          setSelectedKind(contract.kind)
                          setContractPickerOpen(false)
                        }}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-primary/10"
                      >
                        <span className="flex items-center gap-2">
                          <img src={NETWORK_ICON} alt="" className="h-5 w-5" />
                          {contract.label}
                          <span className="text-textmuted">{`${contract.address.slice(0, 6)}…${contract.address.slice(-4)}`}</span>
                        </span>
                        {selectedKind === contract.kind ? <i className="ri-check-line text-primary"></i> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="divide-y divide-defaultborder/60 text-sm dark:divide-white/5">
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-textmuted">Contract address</span>
                  <AddressLink
                    address={snapshot?.address ?? ""}
                    label={snapshot ? `${snapshot.address.slice(0, 6)}…${snapshot.address.slice(-4)}` : "—"}
                  />
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-textmuted">Number of pools</span>
                  <span className="font-medium">{snapshot?.pools.length ?? 0}</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-textmuted">Balance</span>
                  <span className="font-medium">
                    {snapshot ? formatAmount(toUnits(snapshot.balance, snapshot.token.decimals), 2) : "0.0"}{" "}
                    {snapshot?.token.symbol ?? BTG_TOKEN.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-1.5 text-textmuted">
                    Funds required
                    <InfoTip text="Funds required is an estimated amount needed to cover rewards for the next 3 months, based on the current total staked amount." />
                  </span>
                  <span className="font-medium">
                    {formatAmount(fundsRequired, 2)} {snapshot?.token.symbol ?? BTG_TOKEN.symbol}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setWithdrawOpen(true)}
                  disabled={!canManage}
                  className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Withdraw
                </button>
                <button
                  type="button"
                  onClick={() => setDepositOpen(true)}
                  className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary"
                >
                  Deposit
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!canManage ? (
        <div className="mb-6">
          <Notice tone="warning">
            The connected wallet does not hold the manager role on the {selectedKind} staking contract, so pool changes
            are read-only. Depositing reward funds is still possible - it is a plain token transfer.
          </Notice>
        </div>
      ) : null}

      <div className="box mb-6">
        <div className="box-body !p-0">
          {data.loading ? (
            <Spinner label="Reading pools from Base…" />
          ) : poolRows.length === 0 ? (
            <EmptyState title="No pools yet" hint="Use “Add new pool” to create the first staking pool." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="text-xs text-textmuted">
                    <th className="px-5 py-3 text-start font-normal">Composition</th>
                    <th className="px-5 py-3 text-start font-normal">Reward APY</th>
                    <th className="px-5 py-3 text-start font-normal">Expiration</th>
                    <th className="px-5 py-3 text-start font-normal">Network</th>
                    <th className="px-5 py-3 text-start font-normal">Total staked</th>
                    <th className="px-5 py-3 text-end font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-defaultborder/60 dark:divide-white/5">
                  {poolRows.map(({ kind, pool }) => {
                    const decimals = pool.token.decimals
                    const staked = toUnits(pool.totalDeposit, decimals)
                    const cap = toUnits(pool.hardCap, decimals)
                    const ratio = pool.hasHardCap && cap > 0 ? Math.min(1, staked / cap) : 0
                    const expired = isPoolExpired(pool.endDate)
                    const open = canStakeNow(pool.endDate, pool.lockPeriodInDays)

                    return (
                      <tr key={`${kind}-${pool.pid}`}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <img src={BTG_TOKEN.image} alt="" className="h-8 w-8" />
                            <div>
                              <p className="font-semibold">{pool.lockPeriodInDays} days lock</p>
                              <p className="text-xs capitalize text-textmuted">{kind}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold">{formatPercent(effectiveApyPercent(pool.aprPercent, kind))}</p>
                          <p className="text-xs text-textmuted">{kind === "compound" ? "Compounding" : "Fixed"}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-sm">{formatUtcDate(pool.endDate)}</p>
                          <p className="text-xs text-textmuted">{formatUtcTime(pool.endDate)}</p>
                        </td>
                        <td className="px-5 py-4">
                          <img src={NETWORK_ICON} alt={NETWORK_LABEL} title={NETWORK_LABEL} className="h-6 w-6" />
                        </td>
                        <td className="min-w-[12rem] px-5 py-4">
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
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-3">
                            <StatusBadge status={expired ? "expired" : open ? "active" : "closed"} />
                            <button
                              type="button"
                              onClick={() => setEditTarget({ kind, pool })}
                              disabled={!data.roles[kind]?.isManager && !data.roles[kind]?.isAdmin}
                              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <i className="ri-pencil-line"></i>
                              Edit
                            </button>
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

      <SettingsPanel data={data} />

      <AddPoolModal open={addOpen} onClose={() => setAddOpen(false)} onDone={() => void data.refresh(true)} price={price} />
      <EditPoolModal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        onDone={() => void data.refresh(true)}
        pool={editTarget?.pool ?? null}
        kind={editTarget?.kind ?? "compound"}
        price={price}
      />
      <DepositFundsModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        onDone={() => void data.refresh(true)}
        snapshot={snapshot}
        fundsRequired={fundsRequired}
      />
      <WithdrawFundsModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onDone={() => void data.refresh(true)}
        snapshot={snapshot}
      />
    </>
  )
}

function SummaryRow({
  label,
  value,
  tip,
  last,
}: {
  label: string
  value: React.ReactNode
  tip?: string
  last?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-3 text-sm ${
        last ? "" : "border-b border-defaultborder/60 dark:border-white/5"
      }`}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </span>
      <span className="text-end font-semibold">{value}</span>
    </div>
  )
}

function CapacityRing({ ratio }: { ratio: number }) {
  const percent = Math.round(ratio * 100)
  return (
    <div
      className="relative flex h-40 w-40 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(rgb(var(--primary)) ${percent * 3.6}deg, rgba(var(--primary-rgb), 0.12) 0deg)`,
      }}
    >
      <div className="flex h-[8.5rem] w-[8.5rem] flex-col items-center justify-center rounded-full bg-bodybg2">
        <span className="text-2xl font-semibold">{percent}%</span>
        <span className="text-xs text-textmuted">Total capacity</span>
      </div>
    </div>
  )
}
