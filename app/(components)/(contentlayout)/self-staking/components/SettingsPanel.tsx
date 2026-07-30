"use client"

import React, { useEffect, useMemo, useState } from "react"
import { isAddress } from "viem"

import { PositionView, readPositions } from "../lib/chain"
import { BTG_TOKEN, STAKING_CONTRACTS, StakingKind, getStakingContract } from "../lib/config"
import {
  effectiveApyPercent,
  formatAmount,
  formatPercent,
  formatUtcDate,
  shortAddress,
  toUnits,
  unlockTimestamp,
} from "../lib/math"
import { PortalData } from "../lib/usePortal"
import { useTx } from "../lib/useTx"
import { AddressLink, EmptyState, Field, Modal, Notice, PrimaryButton, Row, Rows, StatusBadge, UnitInput } from "./ui"

type SettingsTab = "tokens" | "managers" | "lookup"

const LABELS_KEY = "self-staking-manager-labels-v1"

export function SettingsPanel({ data }: { data: PortalData }) {
  const [tab, setTab] = useState<SettingsTab>("tokens")

  return (
    <div className="box">
      <div className="box-body">
        <h6 className="mb-4 text-lg font-semibold">Settings</h6>
        <div className="mb-6 flex flex-wrap gap-6 border-b border-defaultborder/60 dark:border-white/10">
          {(
            [
              ["tokens", "Tokens"],
              ["managers", "Managers"],
              ["lookup", "Wallet lookup"],
            ] as [SettingsTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 pb-3 text-sm transition ${
                tab === key ? "border-primary font-semibold text-defaulttextcolor" : "border-transparent text-textmuted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "tokens" ? <TokensTab data={data} /> : null}
        {tab === "managers" ? <ManagersTab data={data} /> : null}
        {tab === "lookup" ? <WalletLookupTab data={data} /> : null}
      </div>
    </div>
  )
}

function TokensTab({ data }: { data: PortalData }) {
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 md:col-span-4">
        <p className="mb-1 font-semibold">Staking token</p>
        <p className="text-sm text-textmuted">
          The token linked to each staking contract. Pools are created against this token, so it is read straight from
          the contract instead of being configurable here.
        </p>
      </div>
      <div className="col-span-12 md:col-span-8">
        {STAKING_CONTRACTS.map((contract) => {
          const snapshot = data.snapshots[contract.kind]
          const token = snapshot?.token
          return (
            <div key={contract.kind} className="mb-4 rounded-lg border border-defaultborder/60 p-4 dark:border-white/10">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <img src={BTG_TOKEN.image} alt="" className="h-5 w-5" />
                {contract.label} staking
              </p>
              <Rows>
                <Row label="Staking contract" value={<AddressLink address={contract.address} label={shortAddress(contract.address)} />} />
                <Row
                  label="Token address"
                  value={token ? <AddressLink address={token.address} label={shortAddress(token.address)} /> : "—"}
                />
                <Row label="Ticker" value={token?.symbol ?? "—"} />
                <Row label="Pools" value={snapshot ? snapshot.pools.length : 0} />
              </Rows>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ManagersTab({ data }: { data: PortalData }) {
  const [contractKind, setContractKind] = useState<StakingKind>("compound")
  const [addOpen, setAddOpen] = useState(false)
  const [labels, setLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LABELS_KEY)
      if (stored) setLabels(JSON.parse(stored))
    } catch {
      /* labels are cosmetic */
    }
  }, [])

  const managers = data.managers[contractKind] ?? []
  const canManage = data.roles[contractKind]?.isAdmin

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {STAKING_CONTRACTS.map((contract) => (
            <button
              key={contract.kind}
              type="button"
              onClick={() => setContractKind(contract.kind)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                contractKind === contract.kind ? "bg-primary text-white" : "bg-primary/10 text-primary"
              }`}
            >
              {contract.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={!canManage}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-primary/40"
        >
          <i className="ri-add-circle-line"></i>
          Add managers
        </button>
      </div>

      <Notice>
        Managers can create and edit pools and move the reward buffer. Roles live on the staking contract itself
        (<code>MANAGER_ROLE</code>), so every change is one onchain transaction. Only the contract admin can grant or
        revoke them.
      </Notice>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="text-xs text-textmuted">
              <th className="px-4 py-3 text-start font-normal">Role</th>
              <th className="px-4 py-3 text-start font-normal">Wallet</th>
              <th className="px-4 py-3 text-start font-normal">Date added</th>
              <th className="px-4 py-3 text-start font-normal">Labels</th>
              <th className="px-4 py-3 text-end font-normal"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-defaultborder/60 dark:divide-white/5">
            {managers.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No role holders found" hint="Role events are read from the contract logs." />
                </td>
              </tr>
            ) : (
              managers.map((manager) => (
                <tr key={manager.address}>
                  <td className="px-4 py-3 text-sm font-medium">{manager.isAdmin ? "Admin" : "Manager"}</td>
                  <td className="px-4 py-3 text-sm">
                    <AddressLink address={manager.address} label={shortAddress(manager.address)} />
                  </td>
                  <td className="px-4 py-3 text-sm">{manager.addedAt ? formatUtcDate(manager.addedAt) : "—"}</td>
                  <td className="px-4 py-3 text-sm text-textmuted">{labels[manager.address.toLowerCase()] ?? "—"}</td>
                  <td className="px-4 py-3 text-end">
                    <RevokeButton kind={contractKind} address={manager.address} disabled={!canManage || manager.isAdmin} data={data} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AddManagerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        kind={contractKind}
        onDone={(address, label) => {
          if (label) {
            const next = { ...labels, [address.toLowerCase()]: label }
            setLabels(next)
            try {
              localStorage.setItem(LABELS_KEY, JSON.stringify(next))
            } catch {
              /* ignore */
            }
          }
          void data.refresh(true)
        }}
      />
    </>
  )
}

function RevokeButton({
  kind,
  address,
  disabled,
  data,
}: {
  kind: StakingKind
  address: `0x${string}`
  disabled?: boolean
  data: PortalData
}) {
  const { send } = useTx()
  const [busy, setBusy] = useState(false)

  const revoke = async () => {
    const contract = getStakingContract(kind)
    setBusy(true)
    try {
      await send({
        to: contract.address,
        abi: contract.abi,
        functionName: "setManagerRole",
        args: [address, false],
        label: "Revoke manager",
      })
      await data.refresh(true)
    } catch {
      /* surfaced by the tx state */
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={disabled || busy}
      className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? "Revoking…" : "Revoke"}
    </button>
  )
}

function AddManagerModal({
  open,
  onClose,
  kind,
  onDone,
}: {
  open: boolean
  onClose: () => void
  kind: StakingKind
  onDone: (address: string, label: string) => void
}) {
  const { send, walletReady } = useTx()
  const [address, setAddress] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const contract = getStakingContract(kind)
    setError(null)
    setBusy(true)
    try {
      await send({
        to: contract.address,
        abi: contract.abi,
        functionName: "setManagerRole",
        args: [address as `0x${string}`, true],
        label: "Add manager",
      })
      onDone(address, label)
      setAddress("")
      setLabel("")
      onClose()
    } catch (err: any) {
      setError(err?.message ?? "Adding the manager failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add manager" description="Managers have full access to all available products.">
      <Field label="Wallet address" error={address && !isAddress(address) ? "Enter a valid wallet address." : null}>
        <UnitInput value={address} onChange={setAddress} placeholder="Enter wallet address" />
      </Field>
      <Field label="Label" hint="Each label can be up to 10 characters. Stored locally in this browser.">
        <UnitInput value={label} onChange={(value) => setLabel(value.slice(0, 10))} placeholder="Add a new tag" />
      </Field>

      <div className="mb-4">
        <Notice tone="warning">
          You will sign <strong>1 transaction</strong> to grant <code>MANAGER_ROLE</code> on the {kind} staking contract.
        </Notice>
      </div>

      {error ? (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <PrimaryButton onClick={submit} loading={busy} disabled={!walletReady || !isAddress(address)}>
        Add manager
      </PrimaryButton>
    </Modal>
  )
}

function WalletLookupTab({ data }: { data: PortalData }) {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<
    | null
    | {
        address: string
        rows: { kind: StakingKind; pid: number; position: PositionView }[]
      }
  >(null)

  const lookup = async () => {
    if (!isAddress(query)) return
    setLoading(true)
    try {
      const rows: { kind: StakingKind; pid: number; position: PositionView }[] = []
      for (const contract of STAKING_CONTRACTS) {
        const snapshot = data.snapshots[contract.kind]
        if (!snapshot?.pools.length) continue
        const positions = await readPositions(contract, snapshot.pools, query as `0x${string}`)
        positions.forEach((position) => {
          if (position.totalInvested > BigInt(0) || position.totalClaimed > BigInt(0)) {
            rows.push({ kind: contract.kind, pid: position.pid, position })
          }
        })
      }
      setResult({ address: query, rows })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <p className="mb-1 text-lg font-semibold">Staker lookup</p>
      <p className="mb-4 text-sm text-textmuted">
        Enter any wallet address to see its active staking positions and related pool data.
      </p>

      <div className="mb-6 flex gap-3">
        <div className="flex-1">
          <UnitInput
            value={query}
            onChange={setQuery}
            placeholder="Enter wallet address…"
            action={
              <button type="button" onClick={lookup} disabled={!isAddress(query) || loading} className="text-primary">
                <i className="ri-search-line"></i>
              </button>
            }
          />
        </div>
      </div>

      {loading ? <p className="text-sm text-textmuted">Reading positions…</p> : null}

      {result && !loading ? (
        result.rows.length === 0 ? (
          <EmptyState title="No staking positions found" hint={`${result.address} has never staked in these pools.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="text-xs text-textmuted">
                  <th className="px-4 py-3 text-start font-normal">Pool</th>
                  <th className="px-4 py-3 text-start font-normal">Staked</th>
                  <th className="px-4 py-3 text-start font-normal">Pending</th>
                  <th className="px-4 py-3 text-start font-normal">Claimed</th>
                  <th className="px-4 py-3 text-start font-normal">Unlocks</th>
                  <th className="px-4 py-3 text-start font-normal">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-defaultborder/60 dark:divide-white/5">
                {result.rows.map(({ kind, pid, position }) => {
                  const pool = data.snapshots[kind]?.pools.find((item) => item.pid === pid)
                  if (!pool) return null
                  return (
                    <tr key={`${kind}-${pid}`}>
                      <td className="px-4 py-3 text-sm">
                        <p className="font-semibold">{pool.lockPeriodInDays} days lock</p>
                        <p className="text-xs capitalize text-textmuted">
                          {kind} · {formatPercent(effectiveApyPercent(pool.aprPercent, kind))}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatAmount(toUnits(position.totalInvested, pool.token.decimals), 4)} {pool.token.symbol}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatAmount(toUnits(position.pending, pool.rewardToken.decimals), 6)} {pool.rewardToken.symbol}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatAmount(toUnits(position.totalClaimed, pool.rewardToken.decimals), 6)}{" "}
                        {pool.rewardToken.symbol}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatUtcDate(unlockTimestamp(position.depositTime, pool.lockPeriodInDays))}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={position.canClaim ? "unlocked" : "locked"} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </>
  )
}
