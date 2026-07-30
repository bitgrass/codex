"use client"

import React, { useEffect, useMemo, useState } from "react"
import { isAddress, maxUint256 } from "viem"

import { PoolView } from "../lib/chain"
import { StakingKind, getStakingContract } from "../lib/config"
import {
  aprPercentToRate,
  effectiveApyPercent,
  estimatedPoolCost,
  formatAmount,
  formatPercent,
  formatUsd,
  fromUnits,
  fromUtcInputValue,
  toUnits,
  toUtcInputValue,
} from "../lib/math"
import { useTx } from "../lib/useTx"
import { Field, Modal, Notice, PrimaryButton, Toggle, UnitInput } from "./ui"

type Tab = "setup" | "nft"

export function EditPoolModal({
  open,
  onClose,
  onDone,
  pool,
  kind,
  price,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  pool: PoolView | null
  kind: StakingKind
  price: number | null
}) {
  const contract = getStakingContract(kind)
  const { send, walletReady } = useTx()

  const [tab, setTab] = useState<Tab>("setup")
  const [capacity, setCapacity] = useState("")
  const [apr, setApr] = useState("")
  const [lockDays, setLockDays] = useState("")
  const [expiry, setExpiry] = useState("")
  const [withdrawLocked, setWithdrawLocked] = useState(true)

  const [boostEnabled, setBoostEnabled] = useState(false)
  const [nftContract, setNftContract] = useState("")
  const [nftName, setNftName] = useState("")
  const [multiplier, setMultiplier] = useState("")
  const [firstId, setFirstId] = useState("")
  const [lastId, setLastId] = useState("")

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!pool || !open) return
    setTab("setup")
    setError(null)
    setCapacity(pool.hasHardCap ? String(toUnits(pool.hardCap, pool.token.decimals)) : "")
    setApr(String(pool.aprPercent))
    setLockDays(String(pool.lockPeriodInDays))
    setExpiry(toUtcInputValue(pool.endDate))
    setWithdrawLocked(pool.isWithdrawLocked)
    setBoostEnabled(Boolean(pool.nft?.active))
    setNftContract(pool.nft?.contractAdd && pool.nft.contractAdd !== ZERO ? pool.nft.contractAdd : "")
    setNftName(pool.nft?.name ?? "")
    setMultiplier(pool.nft ? String(pool.nft.multiplier / pool.multiplierBase) : "")
    setFirstId(pool.nft ? String(pool.nft.startIdx) : "")
    setLastId(pool.nft ? String(pool.nft.endIdx) : "")
  }, [pool, open])

  const aprValue = Number(apr || 0)
  const capacityValue = Number(capacity || 0)
  const expirySeconds = fromUtcInputValue(expiry)
  const apy = effectiveApyPercent(aprValue, kind)
  const estimatedCost = useMemo(
    () => estimatedPoolCost(capacityValue, aprValue, expirySeconds, kind),
    [capacityValue, aprValue, expirySeconds, kind]
  )

  if (!pool) return null

  const setupDirty =
    aprValue !== pool.aprPercent ||
    Number(lockDays || 0) !== pool.lockPeriodInDays ||
    expirySeconds !== pool.endDate ||
    (kind === "compound" && capacityValue !== toUnits(pool.hardCap, pool.token.decimals)) ||
    (kind === "liquidity" && withdrawLocked !== pool.isWithdrawLocked)

  const setupValid = aprValue > 0 && Number(lockDays || 0) > 0 && expirySeconds > 0

  const boostValid =
    !boostEnabled ||
    (isAddress(nftContract) &&
      Number(multiplier || 0) >= 1 &&
      Number(firstId || 0) >= 0 &&
      Number(lastId || 0) >= Number(firstId || 0))

  const saveSetup = async () => {
    setError(null)
    setBusy(true)
    try {
      if (kind === "compound") {
        await send({
          to: contract.address,
          abi: contract.abi,
          functionName: "set",
          args: [
            BigInt(pool.pid),
            aprPercentToRate(aprValue),
            BigInt(Math.round(Number(lockDays))),
            BigInt(expirySeconds),
            fromUnits(capacity || "0", pool.token.decimals),
            // maxTransferAmount is kept unlimited, matching how the pools were created.
            maxUint256,
            pool.token.address,
          ],
          label: "Save pool changes",
        })
      } else {
        await send({
          to: contract.address,
          abi: contract.abi,
          functionName: "set",
          args: [
            pool.pid,
            withdrawLocked,
            aprPercentToRate(aprValue),
            Math.round(Number(lockDays)),
            expirySeconds,
            BigInt(0),
            pool.token.address,
            pool.rewardToken.address,
          ],
          label: "Save pool changes",
        })
      }
      onDone()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? "Saving the pool failed.")
    } finally {
      setBusy(false)
    }
  }

  const saveBoost = async () => {
    setError(null)
    setBusy(true)
    try {
      const scaledMultiplier = Math.round(Number(multiplier || 1) * pool.multiplierBase)
      const contractAddress = (isAddress(nftContract) ? nftContract : ZERO) as `0x${string}`

      if (kind === "compound") {
        await send({
          to: contract.address,
          abi: contract.abi,
          functionName: "setNFT",
          args: [
            BigInt(pool.pid),
            nftName,
            contractAddress,
            boostEnabled,
            scaledMultiplier,
            Number(firstId || 0),
            Number(lastId || 0),
          ],
          label: "Save NFT boost",
        })
      } else {
        await send({
          to: contract.address,
          abi: contract.abi,
          functionName: "setMultiplier",
          args: [
            pool.pid,
            nftName,
            contractAddress,
            boostEnabled,
            scaledMultiplier,
            BigInt(firstId || 0),
            BigInt(lastId || 0),
          ],
          label: "Save NFT boost",
        })
      }
      onDone()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? "Saving the NFT boost failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit pool"
      description="Changing the pool requires interacting with the staking smart contract, and a transaction fee will apply to save the changes. Please review everything carefully before proceeding."
    >
      <div className="mb-6 grid grid-cols-2 gap-2 rounded-md">
        <TabButton label="Setup" active={tab === "setup"} onClick={() => setTab("setup")} />
        <TabButton label="NFT Boost" active={tab === "nft"} onClick={() => setTab("nft")} />
      </div>

      {tab === "setup" ? (
        <>
          <Field label="Token address" tip="The contract address of the token to be used for staking">
            <UnitInput value={pool.token.address} disabled />
          </Field>

          {kind === "compound" ? (
            <Field label="Pool capacity" tip="The maximum number of tokens that can be staked">
              <UnitInput value={capacity} onChange={setCapacity} unit={pool.token.symbol} />
            </Field>
          ) : (
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm">Lock withdrawals until the lock period ends</span>
              <Toggle checked={withdrawLocked} onChange={setWithdrawLocked} />
            </div>
          )}

          <Field label="APR" tip="The annual percentage reward for the pool">
            <UnitInput value={apr} onChange={setApr} />
          </Field>

          <div className="mb-4 rounded-md border border-primary/30 bg-primary/[0.06] px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {kind === "compound" ? "Estimated APY:" : "Fixed APR:"} <span className="font-semibold">~ {formatPercent(apy)}</span>
            </p>
            <p className="mt-1 text-xs text-textmuted">
              {kind === "compound"
                ? "Calculated based on entered APR rate and subject to change based on various external variables. This is a rough estimate and not a guaranteed return."
                : "Liquidity pools pay a flat rate over the lock period."}
            </p>
          </div>

          <Field label="Lock period" tip="The number of days the user's stake will be locked for">
            <UnitInput value={lockDays} onChange={setLockDays} unit="days" />
          </Field>

          <Field label="Pool expiration date (UTC)" tip="The date at which users can no longer stake tokens">
            <UnitInput value={expiry} onChange={setExpiry} type="datetime-local" />
          </Field>

          <div className="mb-5 border-t border-defaultborder/60 pt-4 dark:border-white/10">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold">Estimated cost of operation</span>
              <span className="text-end text-sm font-semibold">
                {formatAmount(estimatedCost)} {pool.token.symbol}
                <span className="block text-xs font-normal text-textmuted">
                  {price ? formatUsd(estimatedCost * price) : "(~$0.0)"}
                </span>
              </span>
            </div>
          </div>

          {error ? (
            <div className="mb-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
            >
              Cancel
            </button>
            <PrimaryButton onClick={saveSetup} loading={busy} disabled={!walletReady || !setupDirty || !setupValid}>
              Save changes
            </PrimaryButton>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm">NFT boost setting</span>
            <Toggle checked={boostEnabled} onChange={setBoostEnabled} />
          </div>

          <div className="mb-5">
            <Notice tone={boostEnabled ? "info" : "warning"}>
              <p className="mb-1 font-semibold">
                NFT boost{" "}
                <span className={boostEnabled ? "text-primary" : "text-warning"}>
                  {boostEnabled ? "Enabled" : "Disabled"}
                </span>
              </p>
              {boostEnabled
                ? "Allows users to enhance their staking rewards by holding specific NFTs. Once enabled, participants with eligible NFTs will receive additional rewards based on the boost multiplier you set."
                : "Users will not receive extra rewards based on their NFT holdings, and only the standard staking rewards will apply."}
            </Notice>
          </div>

          <Field
            label="Contract address"
            error={boostEnabled && nftContract && !isAddress(nftContract) ? "Enter a valid contract address." : null}
            hint={
              pool.nft?.contractAdd && pool.nft.contractAdd !== ZERO
                ? "The contract already stores an NFT collection - it cannot be replaced onchain, only re-configured."
                : undefined
            }
          >
            <UnitInput
              value={nftContract}
              onChange={setNftContract}
              placeholder="Enter the contract address of the NFT collection you want to use for the boost"
              disabled={!boostEnabled}
            />
          </Field>

          <Field label="NFT name">
            <UnitInput
              value={nftName}
              onChange={setNftName}
              placeholder="Enter the name of the NFT collection to be displayed to users"
              disabled={!boostEnabled}
            />
          </Field>

          <Field
            label="Boost multiplier (up to one decimal place)"
            hint={`Stored onchain as ${pool.multiplierBase} = 1x. Minimum 1x.`}
          >
            <UnitInput
              value={multiplier}
              onChange={setMultiplier}
              placeholder="Enter the multiplier for calculating the NFT boost, e.g.: 5"
              disabled={!boostEnabled}
            />
          </Field>

          <Field label="First token ID to include">
            <UnitInput
              value={firstId}
              onChange={setFirstId}
              placeholder="Enter the first token ID to include"
              disabled={!boostEnabled}
            />
          </Field>

          <Field label="Last token ID to include">
            <UnitInput
              value={lastId}
              onChange={setLastId}
              placeholder="Enter the last token ID to include"
              disabled={!boostEnabled}
            />
          </Field>

          {error ? (
            <div className="mb-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
            >
              Cancel
            </button>
            <PrimaryButton onClick={saveBoost} loading={busy} disabled={!walletReady || !boostValid}>
              Save changes
            </PrimaryButton>
          </div>
        </>
      )}
    </Modal>
  )
}

const ZERO = "0x0000000000000000000000000000000000000000"

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-2.5 text-sm font-semibold transition ${
        active ? "bg-primary text-white" : "bg-primary/10 text-primary hover:bg-primary/20"
      }`}
    >
      {label}
    </button>
  )
}
