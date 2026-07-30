"use client"

import React, { useMemo, useState } from "react"
import { isAddress } from "viem"

import { BTG_TOKEN, NETWORK_ICON, NETWORK_LABEL, StakingKind, getStakingContract } from "../lib/config"
import {
  aprPercentToRate,
  effectiveApyPercent,
  estimatedPoolCost,
  formatAmount,
  formatPercent,
  formatUsd,
  formatUtcDateTime,
  fromUnits,
  fromUtcInputValue,
} from "../lib/math"
import { useTx } from "../lib/useTx"
import { Field, Modal, Notice, PrimaryButton, Row, Rows, Toggle, UnitInput } from "./ui"

type Step = 1 | 2 | "preview"

export function AddPoolModal({
  open,
  onClose,
  onDone,
  price,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  price: number | null
}) {
  const { send, walletReady } = useTx()
  const [step, setStep] = useState<Step>(1)
  const [kind, setKind] = useState<StakingKind>("compound")
  const [tokenAddress, setTokenAddress] = useState(BTG_TOKEN.address as string)
  const [rewardTokenAddress, setRewardTokenAddress] = useState(BTG_TOKEN.address as string)
  const [withdrawLocked, setWithdrawLocked] = useState(true)
  const [capacity, setCapacity] = useState("")
  const [apr, setApr] = useState("")
  const [lockDays, setLockDays] = useState("")
  const [expiry, setExpiry] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contract = getStakingContract(kind)
  const aprValue = Number(apr || 0)
  const capacityValue = Number(capacity || 0)
  const expirySeconds = fromUtcInputValue(expiry)
  const apy = effectiveApyPercent(aprValue, kind)
  const estimatedCost = useMemo(
    () => estimatedPoolCost(capacityValue, aprValue, expirySeconds, kind),
    [capacityValue, aprValue, expirySeconds, kind]
  )

  const reset = () => {
    setStep(1)
    setKind("compound")
    setTokenAddress(BTG_TOKEN.address)
    setRewardTokenAddress(BTG_TOKEN.address)
    setWithdrawLocked(true)
    setCapacity("")
    setApr("")
    setLockDays("")
    setExpiry("")
    setError(null)
    setBusy(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const step1Valid = isAddress(tokenAddress) && (kind === "compound" || isAddress(rewardTokenAddress))
  const step2Valid =
    aprValue > 0 &&
    Number(lockDays || 0) > 0 &&
    expirySeconds > Math.floor(Date.now() / 1000) &&
    (kind === "liquidity" || capacityValue > 0)

  const handleSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (kind === "compound") {
        await send({
          to: contract.address,
          abi: contract.abi,
          functionName: "add",
          args: [
            aprPercentToRate(aprValue),
            BigInt(Math.round(Number(lockDays))),
            BigInt(expirySeconds),
            fromUnits(capacity, BTG_TOKEN.decimals),
            tokenAddress as `0x${string}`,
          ],
          label: "Add pool",
        })
      } else {
        await send({
          to: contract.address,
          abi: contract.abi,
          functionName: "add",
          args: [
            withdrawLocked,
            aprPercentToRate(aprValue),
            Math.round(Number(lockDays)),
            expirySeconds,
            BigInt(0),
            tokenAddress as `0x${string}`,
            rewardTokenAddress as `0x${string}`,
          ],
          label: "Add pool",
        })
      }
      onDone()
      close()
    } catch (err: any) {
      setError(err?.message ?? "Adding the pool failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === "preview" ? "Pool Preview" : "Add Pool"}
      description={
        step === "preview"
          ? "Any future changes will require interacting with the staking smart contract, requiring a transaction fee to save the changes. Please review carefully before proceeding to avoid unnecessary fees."
          : undefined
      }
    >
      {step !== "preview" ? (
        <div className="mb-6 flex items-center justify-center gap-3">
          <StepDot index={1} active={step === 1} done={step === 2} />
          <span className="h-px w-24 bg-defaultborder dark:bg-white/10"></span>
          <StepDot index={2} active={step === 2} done={false} />
        </div>
      ) : null}

      {step === 1 ? (
        <>
          <p className="mb-2 text-sm">Pool type</p>
          <div className="mb-4 flex items-center gap-8">
            <PoolTypeOption label="Compound" checked={kind === "compound"} onSelect={() => setKind("compound")} />
            <PoolTypeOption label="Liquidity" checked={kind === "liquidity"} onSelect={() => setKind("liquidity")} />
          </div>

          <div className="mb-5">
            <Notice>
              {kind === "compound" ? (
                <>
                  <strong>Compound staking:</strong> Automatically reinvest rewards back into the staking pool. Rewards
                  accrue every second and are compounded on each interaction.
                </>
              ) : (
                <>
                  <strong>Liquidity staking:</strong> Users add liquidity to an Aerodrome pair through the contract and
                  the resulting LP tokens are locked. Rewards are paid at a fixed rate in one side of the pair.
                </>
              )}
            </Notice>
          </div>

          <Field
            label={kind === "compound" ? "Token address" : "LP pair address"}
            tip={
              kind === "compound"
                ? "The contract address of the token to be used for staking"
                : "The Aerodrome pair (LP token) users will lock"
            }
            error={tokenAddress && !isAddress(tokenAddress) ? "Enter a valid contract address." : null}
          >
            <UnitInput value={tokenAddress} onChange={setTokenAddress} placeholder="Enter the token address" />
          </Field>

          {kind === "liquidity" ? (
            <>
              <Field
                label="Reward token address"
                tip="Must be token0 or token1 of the pair - the contract validates this onchain."
                error={rewardTokenAddress && !isAddress(rewardTokenAddress) ? "Enter a valid contract address." : null}
              >
                <UnitInput
                  value={rewardTokenAddress}
                  onChange={setRewardTokenAddress}
                  placeholder="Enter the reward token address"
                />
              </Field>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm">Lock withdrawals until the lock period ends</span>
                <Toggle checked={withdrawLocked} onChange={setWithdrawLocked} />
              </div>
            </>
          ) : null}

          <PrimaryButton disabled={!step1Valid} onClick={() => setStep(2)}>
            Next
          </PrimaryButton>
        </>
      ) : null}

      {step === 2 ? (
        <>
          {kind === "compound" ? (
            <Field label="Pool capacity" tip="The maximum number of tokens that can be staked">
              <UnitInput value={capacity} onChange={setCapacity} unit={BTG_TOKEN.symbol} placeholder="Enter pool capacity" />
            </Field>
          ) : (
            <div className="mb-4">
              <Notice tone="warning">
                The liquidity contract ignores the pool capacity - it always stores an unlimited hard cap.
              </Notice>
            </div>
          )}

          <Field label="APR" tip="The annual percentage reward for the pool">
            <UnitInput value={apr} onChange={setApr} placeholder="Enter the APR, e.g. 5" />
          </Field>

          <div className="mb-4 rounded-md border border-primary/30 bg-primary/[0.06] px-4 py-3">
            <p className="text-sm font-medium">
              {kind === "compound" ? "Estimated APY:" : "Fixed APR:"}{" "}
              <span className="font-semibold">~ {formatPercent(apy)}</span>
            </p>
            <p className="mt-1 text-xs text-textmuted">
              {kind === "compound"
                ? "Calculated based on entered APR rate and subject to change based on various external variables. This is a rough estimate and not a guaranteed return."
                : "Liquidity pools pay a flat rate over the lock period, so the APR is the effective return."}
            </p>
          </div>

          <Field label="Lock period" tip="The number of days the user's stake will be locked for">
            <UnitInput value={lockDays} onChange={setLockDays} unit="days" placeholder="Enter pool lock days" />
          </Field>

          <Field label="Pool expiration date (UTC)" tip="The date at which users can no longer stake tokens">
            <UnitInput value={expiry} onChange={setExpiry} type="datetime-local" />
          </Field>

          <div className="mb-5 border-t border-defaultborder/60 pt-4 dark:border-white/10">
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold">Estimated cost of operation</span>
              <span className="text-end text-sm font-semibold">
                {formatAmount(estimatedCost)} {BTG_TOKEN.symbol}
                <span className="block text-xs font-normal text-textmuted">
                  {price ? formatUsd(estimatedCost * price) : "(~$0.0)"}
                </span>
              </span>
            </div>
            <p className="mt-1 text-xs text-textmuted">
              Calculated from full pool capacity, the APY and the expiration date.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
            >
              <i className="ri-arrow-left-line me-1"></i>
              Back
            </button>
            <PrimaryButton disabled={!step2Valid} onClick={() => setStep("preview")}>
              Next
            </PrimaryButton>
          </div>
        </>
      ) : null}

      {step === "preview" ? (
        <>
          <Rows>
            <Row label="Contract" value={<span className="break-all text-xs">{contract.address}</span>} />
            <Row
              label="Pool Network"
              value={
                <span className="inline-flex items-center gap-2">
                  {NETWORK_LABEL}
                  <img src={NETWORK_ICON} alt={NETWORK_LABEL} className="h-5 w-5" />
                </span>
              }
            />
            <Row label="Pool Type" value={<span className="capitalize">{kind}</span>} />
            <Row label="Staked token" value={<span className="break-all text-xs">{tokenAddress}</span>} />
            {kind === "liquidity" ? (
              <Row label="Reward token" value={<span className="break-all text-xs">{rewardTokenAddress}</span>} />
            ) : null}
            <Row label={kind === "compound" ? "Estimated APY" : "Fixed APR"} value={`~ ${formatPercent(apy)}`} />
            <Row label="Lock period" value={`${lockDays} days`} />
            <Row label="Pool expiration date (UTC)" value={formatUtcDateTime(expirySeconds)} />
            <Row
              label="Pool capacity"
              value={kind === "compound" ? `${formatAmount(capacityValue)} ${BTG_TOKEN.symbol}` : "Unlimited"}
            />
            <Row
              label="Estimated cost of operation"
              value={
                <span className="block">
                  {formatAmount(estimatedCost)} {BTG_TOKEN.symbol}
                  <span className="block text-xs font-normal text-textmuted">
                    {price ? formatUsd(estimatedCost * price) : "(~$0.0)"}
                  </span>
                </span>
              }
            />
          </Rows>

          {error ? (
            <div className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
            >
              <i className="ri-arrow-left-line me-1"></i>
              Back
            </button>
            <PrimaryButton onClick={handleSubmit} loading={busy} disabled={!walletReady}>
              Add Pool
            </PrimaryButton>
          </div>
        </>
      ) : null}
    </Modal>
  )
}

function StepDot({ index, active, done }: { index: number; active: boolean; done: boolean }) {
  return (
    <span
      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
        done || active ? "bg-primary text-white" : "bg-primary/15 text-primary"
      }`}
    >
      {done ? <i className="ri-check-line"></i> : index}
    </span>
  )
}

function PoolTypeOption({
  label,
  checked,
  onSelect,
}: {
  label: string
  checked: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" onClick={onSelect} className="inline-flex items-center gap-2 text-sm">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-sm border ${
          checked ? "border-primary bg-primary" : "border-inputborder bg-transparent"
        }`}
      >
        {checked ? <i className="ri-check-line text-xs text-white"></i> : null}
      </span>
      {label}
    </button>
  )
}
