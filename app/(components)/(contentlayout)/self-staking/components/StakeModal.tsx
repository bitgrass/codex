"use client"

import React, { useEffect, useMemo, useState } from "react"

import { erc20Abi } from "../lib/abis"
import { PoolView, publicClient, readAllowance, readWalletBalances } from "../lib/chain"
import { AERODROME_ROUTER, StakingKind, getStakingContract } from "../lib/config"
import { canStakeNow, effectiveApyPercent, formatAmount, formatPercent, fromUnits, toUnits } from "../lib/math"
import { useTx } from "../lib/useTx"
import { Field, Modal, Notice, PrimaryButton, Row, Rows, UnitInput } from "./ui"

const pairAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const

const feeConverterAbi = [
  {
    type: "function",
    name: "convertUSDFeeToWei",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const

type LpContext = {
  /** 0 = token0 is WETH, 1 = token1 is WETH, 2 = plain ERC20 pair. */
  nativePosition: number
  token0: { address: `0x${string}`; symbol: string; decimals: number }
  token1: { address: `0x${string}`; symbol: string; decimals: number }
  feeWei: bigint
}

export function StakeModal({
  open,
  onClose,
  pool,
  kind,
  onDone,
}: {
  open: boolean
  onClose: () => void
  pool: PoolView | null
  kind: StakingKind
  onDone: () => void
}) {
  const contract = getStakingContract(kind)
  const { send, address, walletReady } = useTx()

  const [amount, setAmount] = useState("")
  const [lpAmounts, setLpAmounts] = useState({ token0: "", token1: "" })
  const [lp, setLp] = useState<LpContext | null>(null)
  const [balances, setBalances] = useState({ native: BigInt(0), token: BigInt(0) })
  const [allowance, setAllowance] = useState(BigInt(0))
  const [busy, setBusy] = useState<null | "approve" | "stake">(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const decimals = pool?.token.decimals ?? 18
  const symbol = pool?.token.symbol ?? "TOKEN"

  useEffect(() => {
    if (!open) {
      setAmount("")
      setLpAmounts({ token0: "", token1: "" })
      setError(null)
      setBusy(null)
      setLp(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || !pool || !address) return
    let cancelled = false

    const load = async () => {
      const [walletBalances, currentAllowance] = await Promise.all([
        readWalletBalances(address as `0x${string}`, pool.token.address),
        readAllowance(pool.token.address, address as `0x${string}`, contract.address),
      ])
      if (cancelled) return
      setBalances(walletBalances)
      setAllowance(currentAllowance)

      if (kind !== "liquidity") return

      try {
        const [token0, token1, nativePosition, minFeeUSD, feeConverter] = await Promise.all([
          publicClient.readContract({ address: pool.token.address, abi: pairAbi, functionName: "token0" }),
          publicClient.readContract({ address: pool.token.address, abi: pairAbi, functionName: "token1" }),
          publicClient.readContract({
            address: contract.address,
            abi: contract.abi as any,
            functionName: "isWrappedNative",
            args: [pool.token.address],
          }),
          publicClient.readContract({ address: contract.address, abi: contract.abi as any, functionName: "minFeeUSD" }),
          publicClient.readContract({ address: contract.address, abi: contract.abi as any, functionName: "feeConverter" }),
        ])

        const [meta0, meta1] = await Promise.all([
          readErc20(token0 as `0x${string}`),
          readErc20(token1 as `0x${string}`),
        ])

        let feeWei = BigInt(0)
        if (BigInt(minFeeUSD as bigint) > BigInt(0)) {
          feeWei = (await publicClient
            .readContract({
              address: feeConverter as `0x${string}`,
              abi: feeConverterAbi,
              functionName: "convertUSDFeeToWei",
              args: [minFeeUSD as bigint],
            })
            .catch(() => BigInt(0))) as bigint
        }

        if (!cancelled) {
          setLp({ nativePosition: Number(nativePosition), token0: meta0, token1: meta1, feeWei })
        }
      } catch {
        if (!cancelled) setLp(null)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, pool, address, contract.address, contract.abi, kind, reloadKey])

  const remainingCapacity = useMemo(() => {
    if (!pool) return Number.POSITIVE_INFINITY
    if (!pool.hasHardCap) return Number.POSITIVE_INFINITY
    return Math.max(0, toUnits(pool.hardCap - pool.totalDeposit, decimals))
  }, [pool, decimals])

  const walletTokens = toUnits(balances.token, decimals)
  const parsedAmount = Number(amount || 0)
  const needsApproval = kind === "compound" && fromUnits(amount || "0", decimals) > allowance
  const depositsOpen = pool ? canStakeNow(pool.endDate, pool.lockPeriodInDays) : false

  const amountError = useMemo(() => {
    if (!amount) return null
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return "Enter an amount greater than zero."
    if (parsedAmount > walletTokens) return `Not enough ${symbol} in your wallet.`
    if (parsedAmount > remainingCapacity) return "Amount exceeds the remaining pool capacity."
    return null
  }, [amount, parsedAmount, walletTokens, remainingCapacity, symbol])

  if (!pool) return null

  const apy = effectiveApyPercent(pool.aprPercent, kind)

  const handleApprove = async () => {
    setError(null)
    setBusy("approve")
    try {
      await send({
        to: pool.token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [contract.address, fromUnits(amount || "0", decimals)],
        label: `Enable ${symbol}`,
      })
      setAllowance(await readAllowance(pool.token.address, address as `0x${string}`, contract.address))
    } catch (err: any) {
      setError(err?.message ?? "Approval failed.")
    } finally {
      setBusy(null)
    }
  }

  const handleStakeCompound = async () => {
    setError(null)
    setBusy("stake")
    try {
      await send({
        to: contract.address,
        abi: contract.abi,
        functionName: "stake",
        args: [BigInt(pool.pid), fromUnits(amount, decimals)],
        label: "Stake",
      })
      onDone()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? "Stake failed.")
    } finally {
      setBusy(null)
    }
  }

  /**
   * The locker adds liquidity through the Aerodrome router itself. When the pair holds
   * WETH the matching leg must arrive as native value, on top of the flat USD fee the
   * contract charges in ETH.
   */
  const handleStakeLiquidity = async () => {
    if (!lp) {
      setError("Could not read the pair configuration for this pool.")
      return
    }
    setError(null)
    setBusy("stake")
    try {
      const amount0 = fromUnits(lpAmounts.token0 || "0", lp.token0.decimals)
      const amount1 = fromUnits(lpAmounts.token1 || "0", lp.token1.decimals)

      let value = lp.feeWei
      let arg0 = amount0
      let arg1 = amount1

      if (lp.nativePosition === 0) {
        // token0 is WETH: its leg is paid with native value, the argument must be 0.
        value += amount0
        arg0 = BigInt(0)
      } else if (lp.nativePosition === 1) {
        value += amount1
        arg1 = BigInt(0)
      }

      await send({
        to: contract.address,
        abi: contract.abi,
        functionName: "addLiquidityAndLock",
        args: [pool.pid, arg0, arg1, (amount0 * BigInt(99)) / BigInt(100), (amount1 * BigInt(99)) / BigInt(100)],
        value,
        label: "Add liquidity and lock",
      })
      onDone()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? "Add liquidity failed.")
    } finally {
      setBusy(null)
    }
  }

  const approveLpLeg = async (legIndex: 0 | 1) => {
    if (!lp) return
    const leg = legIndex === 0 ? lp.token0 : lp.token1
    const raw = legIndex === 0 ? lpAmounts.token0 : lpAmounts.token1
    setError(null)
    setBusy("approve")
    try {
      await send({
        to: leg.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [contract.address, fromUnits(raw || "0", leg.decimals)],
        label: `Enable ${leg.symbol}`,
      })
      setReloadKey((key) => key + 1)
    } catch (err: any) {
      setError(err?.message ?? "Approval failed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Stake">
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2 border-b border-defaultborder/50 pb-5 text-sm font-semibold dark:border-white/10">
        <span>{formatPercent(apy)}</span>
        <span className="text-textmuted">|</span>
        <span>{pool.lockPeriodInDays} days lock</span>
        <span className="text-textmuted">|</span>
        <span>
          {symbol} <span className="font-normal text-textmuted">(Stake/Earn)</span>
        </span>
      </div>

      {!depositsOpen ? (
        <div className="mb-4">
          <Notice tone="warning">
            This pool no longer accepts deposits. The contract blocks new stakes once the remaining time is shorter than
            the {pool.lockPeriodInDays}-day lock period.
          </Notice>
        </div>
      ) : null}

      {kind === "compound" ? (
        <Field label="Stake amount" error={amountError}>
          <UnitInput
            value={amount}
            onChange={setAmount}
            unit={symbol}
            placeholder="0"
            action={
              <button
                type="button"
                onClick={() => setAmount(String(Math.min(walletTokens, remainingCapacity)))}
                className="text-sm font-semibold text-primary"
              >
                MAX
              </button>
            }
          />
        </Field>
      ) : (
        <>
          <Notice>
            Liquidity pools take both sides of the Aerodrome pair, add liquidity through the router and lock the LP
            tokens in a single transaction. Each leg has to be enabled first (native ETH legs do not).
          </Notice>
          <div className="mt-4">
            <Field label={`${lp?.token0.symbol ?? "Token 0"} amount`}>
              <UnitInput
                value={lpAmounts.token0}
                onChange={(value) => setLpAmounts((prev) => ({ ...prev, token0: value }))}
                unit={lp?.nativePosition === 0 ? "ETH" : lp?.token0.symbol}
                placeholder="0"
                action={
                  lp && lp.nativePosition !== 0 ? (
                    <button
                      type="button"
                      onClick={() => void approveLpLeg(0)}
                      className="whitespace-nowrap text-xs font-semibold text-primary"
                    >
                      Enable
                    </button>
                  ) : null
                }
              />
            </Field>
            <Field label={`${lp?.token1.symbol ?? "Token 1"} amount`}>
              <UnitInput
                value={lpAmounts.token1}
                onChange={(value) => setLpAmounts((prev) => ({ ...prev, token1: value }))}
                unit={lp?.nativePosition === 1 ? "ETH" : lp?.token1.symbol}
                placeholder="0"
                action={
                  lp && lp.nativePosition !== 1 ? (
                    <button
                      type="button"
                      onClick={() => void approveLpLeg(1)}
                      className="whitespace-nowrap text-xs font-semibold text-primary"
                    >
                      Enable
                    </button>
                  ) : null
                }
              />
            </Field>
          </div>
        </>
      )}

      <Rows>
        <Row
          label="Wallet balance"
          value={
            <span className="block">
              {formatAmount(walletTokens, 4)} {symbol}
              <span className="mt-0.5 block font-normal">{formatAmount(toUnits(balances.native, 18), 5)} ETH</span>
              <span className="mt-0.5 block text-[0.7rem] font-normal text-textmuted">
                (ETH is required to complete this transaction)
              </span>
            </span>
          }
        />
        <Row
          label="Remaining pool's capacity"
          value={
            pool.hasHardCap ? `${formatAmount(remainingCapacity)} ${symbol}` : "Unlimited"
          }
        />
        {kind === "liquidity" && lp ? (
          <>
            <Row label="Router" value={`${AERODROME_ROUTER.slice(0, 10)}…`} />
            <Row
              label="Protocol fee"
              value={`${formatAmount(toUnits(lp.feeWei, 18), 6)} ETH`}
              tip="Flat USD-denominated fee the locker charges in native ETH on every deposit."
            />
            <Row label="Slippage floor" value="1% on both legs" />
          </>
        ) : null}
      </Rows>

      {error ? (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {kind === "compound" ? (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <PrimaryButton
            onClick={handleApprove}
            loading={busy === "approve"}
            disabled={!walletReady || !!amountError || !amount || !needsApproval || !depositsOpen}
          >
            1. Enable
          </PrimaryButton>
          <PrimaryButton
            onClick={handleStakeCompound}
            loading={busy === "stake"}
            disabled={!walletReady || !!amountError || !amount || needsApproval || !depositsOpen}
          >
            2. Deposit
          </PrimaryButton>
        </div>
      ) : (
        <div className="mt-5">
          <PrimaryButton
            onClick={handleStakeLiquidity}
            loading={busy === "stake"}
            disabled={!walletReady || !depositsOpen || !lp || (!lpAmounts.token0 && !lpAmounts.token1)}
          >
            Add liquidity and lock
          </PrimaryButton>
        </div>
      )}

      {!walletReady ? <p className="mt-3 text-center text-xs text-textmuted">Connect your wallet to continue.</p> : null}
    </Modal>
  )
}

async function readErc20(address: `0x${string}`) {
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => "TOKEN"),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
  ])
  return { address, symbol: String(symbol), decimals: Number(decimals) }
}
