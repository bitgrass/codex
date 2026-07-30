"use client"

import React, { useEffect, useMemo, useState } from "react"

import { erc20Abi } from "../lib/abis"
import { ContractSnapshot, readWalletBalances } from "../lib/chain"
import { getStakingContract } from "../lib/config"
import { formatAmount, fromUnits, shortAddress, toUnits } from "../lib/math"
import { useTx } from "../lib/useTx"
import { AddressLink, Field, Modal, Notice, PrimaryButton, Row, Rows, UnitInput } from "./ui"

/** Rewards buffer = contract balance minus everything users have deposited. */
export function rewardBuffer(snapshot: ContractSnapshot) {
  const principal = snapshot.pools
    .filter((pool) => pool.token.address.toLowerCase() === snapshot.token.address.toLowerCase())
    .reduce((total, pool) => total + pool.totalDeposit, BigInt(0))
  return snapshot.balance > principal ? snapshot.balance - principal : BigInt(0)
}

export function DepositFundsModal({
  open,
  onClose,
  onDone,
  snapshot,
  fundsRequired,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  snapshot: ContractSnapshot | null
  fundsRequired: number
}) {
  const { send, address, walletReady } = useTx()
  const [amount, setAmount] = useState("")
  const [balances, setBalances] = useState({ native: BigInt(0), token: BigInt(0) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !snapshot || !address) return
    let cancelled = false
    readWalletBalances(address as `0x${string}`, snapshot.token.address).then((next) => {
      if (!cancelled) setBalances(next)
    })
    return () => {
      cancelled = true
    }
  }, [open, snapshot, address])

  useEffect(() => {
    if (!open) {
      setAmount("")
      setError(null)
    }
  }, [open])

  if (!snapshot) return null

  const decimals = snapshot.token.decimals
  const walletTokens = toUnits(balances.token, decimals)
  const parsed = Number(amount || 0)
  const amountError =
    amount && (!Number.isFinite(parsed) || parsed <= 0)
      ? "Enter an amount greater than zero."
      : amount && parsed > walletTokens
        ? `Not enough ${snapshot.token.symbol} in your wallet.`
        : null

  const handleDeposit = async () => {
    setError(null)
    setBusy(true)
    try {
      await send({
        to: snapshot.token.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [snapshot.address, fromUnits(amount, decimals)],
        label: "Deposit funds",
      })
      onDone()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? "Deposit failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Deposit funds" description="Add funds to the smart contract.">
      <p className="mb-2 text-sm font-semibold">
        Connected wallet <span className="font-normal text-textmuted">(From)</span>
      </p>
      <Rows>
        <Row
          label="Wallet address"
          value={address ? <AddressLink address={address} label={shortAddress(address)} /> : "—"}
        />
        <Row
          label="Wallet balance"
          value={
            <span className="block">
              {formatAmount(walletTokens, 4)} {snapshot.token.symbol}
              <span className="mt-0.5 block font-normal">{formatAmount(toUnits(balances.native, 18), 5)} ETH</span>
              <span className="mt-0.5 block text-[0.7rem] font-normal text-textmuted">
                (ETH is required to complete this transaction)
              </span>
            </span>
          }
        />
      </Rows>

      <p className="mb-2 mt-5 text-sm font-semibold">
        Staking contract <span className="font-normal text-textmuted">(To)</span>
      </p>
      <Rows>
        <Row label="Contract address" value={<AddressLink address={snapshot.address} label={shortAddress(snapshot.address)} />} />
        <Row
          label="Contract balance"
          value={`${formatAmount(toUnits(snapshot.balance, decimals), 4)} ${snapshot.token.symbol}`}
        />
        <Row
          label="Funds required"
          value={`${formatAmount(fundsRequired, 4)} ${snapshot.token.symbol}`}
          tip="Estimated amount needed to cover rewards for the next 3 months, based on the current total staked amount."
        />
      </Rows>

      <div className="mt-5">
        <Field label="Enter amount to fund the contract" error={amountError}>
          <UnitInput
            value={amount}
            onChange={setAmount}
            unit={snapshot.token.symbol}
            placeholder="Enter deposit amount"
            action={
              <button type="button" onClick={() => setAmount(String(walletTokens))} className="text-sm font-semibold text-primary">
                MAX
              </button>
            }
          />
        </Field>
      </div>

      {error ? (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <PrimaryButton onClick={handleDeposit} loading={busy} disabled={!walletReady || !amount || !!amountError}>
        Deposit funds
      </PrimaryButton>
    </Modal>
  )
}

export function WithdrawFundsModal({
  open,
  onClose,
  onDone,
  snapshot,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  snapshot: ContractSnapshot | null
}) {
  const { send, address, walletReady } = useTx()
  const [amount, setAmount] = useState("")
  const [balances, setBalances] = useState({ native: BigInt(0), token: BigInt(0) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !snapshot || !address) return
    let cancelled = false
    readWalletBalances(address as `0x${string}`, snapshot.token.address).then((next) => {
      if (!cancelled) setBalances(next)
    })
    return () => {
      cancelled = true
    }
  }, [open, snapshot, address])

  useEffect(() => {
    if (!open) {
      setAmount("")
      setError(null)
    }
  }, [open])

  const available = useMemo(() => (snapshot ? toUnits(rewardBuffer(snapshot), snapshot.token.decimals) : 0), [snapshot])

  if (!snapshot) return null

  const decimals = snapshot.token.decimals
  const parsed = Number(amount || 0)
  const amountError =
    amount && (!Number.isFinite(parsed) || parsed <= 0)
      ? "Enter an amount greater than zero."
      : amount && parsed > available
        ? "Only the reward buffer can be withdrawn - staked principal stays in the contract."
        : null

  const handleWithdraw = async () => {
    if (!address) return
    setError(null)
    setBusy(true)
    try {
      const contract = getStakingContract(snapshot.kind)
      await send({
        to: contract.address,
        abi: contract.abi,
        functionName: "transferStuckToken",
        args: [snapshot.token.address, address as `0x${string}`, fromUnits(amount, decimals)],
        label: "Withdraw funds",
      })
      onDone()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? "Withdraw failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Withdraw Funds" description="Withdraw funds to the admin wallet address.">
      <p className="mb-2 text-sm font-semibold">
        Staking contract <span className="font-normal text-textmuted">(From)</span>
      </p>
      <Rows>
        <Row
          label="Contract balance: Available"
          value={`${formatAmount(available, 4)} ${snapshot.token.symbol}`}
          tip="Contract balance minus the principal users have staked. Only this buffer can leave the contract."
        />
      </Rows>

      <p className="mb-2 mt-5 text-sm font-semibold">
        Admin wallet <span className="font-normal text-textmuted">(To)</span>
      </p>
      <Rows>
        <Row label="Wallet address" value={address ? <AddressLink address={address} label={shortAddress(address)} /> : "—"} />
        <Row
          label="Wallet balance"
          value={
            <span className="block">
              {formatAmount(toUnits(balances.token, decimals), 4)} {snapshot.token.symbol}
              <span className="mt-0.5 block font-normal">{formatAmount(toUnits(balances.native, 18), 5)} ETH</span>
              <span className="mt-0.5 block text-[0.7rem] font-normal text-textmuted">
                (ETH is required to complete this transaction)
              </span>
            </span>
          }
        />
      </Rows>

      <div className="mt-5">
        <Field label="Enter amount to withdraw from the contract" error={amountError}>
          <UnitInput
            value={amount}
            onChange={setAmount}
            unit={snapshot.token.symbol}
            placeholder="Enter withdraw amount"
            action={
              <button type="button" onClick={() => setAmount(String(available))} className="text-sm font-semibold text-primary">
                MAX
              </button>
            }
          />
        </Field>
      </div>

      {error ? (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <PrimaryButton onClick={handleWithdraw} loading={busy} disabled={!walletReady || !amount || !!amountError}>
        Withdraw funds
      </PrimaryButton>
    </Modal>
  )
}
