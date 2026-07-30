"use client"

import { useCallback, useState } from "react"
import { encodeFunctionData } from "viem"
import { useSwitchChain } from "wagmi"
import { base } from "wagmi/chains"

import { BASE_WALLET_CHAIN_PARAMS } from "@/app/base-rpc"

import { useConnectedAddress } from "../../useConnectedAddress"
import { publicClient } from "./chain"

export type TxState = {
  pending: boolean
  label: string | null
  hash: string | null
  error: string | null
}

export type SendTxArgs = {
  to: `0x${string}`
  abi: readonly unknown[] | any[]
  functionName: string
  args?: readonly unknown[]
  value?: bigint
  label: string
}

const IDLE: TxState = { pending: false, label: null, hash: null, error: null }

/**
 * Wraps the wallet plumbing the rest of the dapp already uses: resolve the active
 * wallet (external, embedded or Farcaster), force Base, send raw calldata, wait for
 * the receipt.
 */
export function useTx() {
  const { address, client: walletClient } = useConnectedAddress()
  const { switchChainAsync } = useSwitchChain()
  const [state, setState] = useState<TxState>(IDLE)

  const ensureBaseChain = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: base.id })
      return true
    } catch {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        try {
          await (window as any).ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x2105" }],
          })
          return true
        } catch (directError: any) {
          if (directError?.code === 4902) {
            try {
              await (window as any).ethereum.request({
                method: "wallet_addEthereumChain",
                params: [BASE_WALLET_CHAIN_PARAMS],
              })
              return true
            } catch {
              return false
            }
          }
          return false
        }
      }
      return false
    }
  }, [switchChainAsync])

  const send = useCallback(
    async ({ to, abi, functionName, args = [], value, label }: SendTxArgs) => {
      if (!address || !walletClient) throw new Error("Connect your wallet first.")
      if (typeof walletClient.request !== "function") throw new Error("This wallet cannot sign transactions here.")

      setState({ pending: true, label, hash: null, error: null })

      try {
        const onBase = await ensureBaseChain()
        if (!onBase) throw new Error("Switch your wallet to the Base network and try again.")

        const data = encodeFunctionData({ abi: abi as any, functionName, args: args as any })

        // Simulate first so contract reverts surface as readable errors instead of
        // an opaque wallet rejection.
        await publicClient.simulateContract({
          address: to,
          abi: abi as any,
          functionName,
          args: args as any,
          account: address as `0x${string}`,
          value,
        })

        const hash = (await walletClient.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: address,
              to,
              data,
              value: value ? `0x${value.toString(16)}` : "0x0",
            },
          ],
        })) as string

        setState({ pending: true, label, hash, error: null })

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: hash as `0x${string}`,
          timeout: 180_000,
        })
        if (receipt.status !== "success") throw new Error(`${label} reverted onchain.`)

        setState({ pending: false, label, hash, error: null })
        return hash
      } catch (error: any) {
        const message = readableError(error)
        setState({ pending: false, label, hash: null, error: message })
        throw new Error(message)
      }
    },
    [address, ensureBaseChain, walletClient]
  )

  const reset = useCallback(() => setState(IDLE), [])

  return { send, state, reset, address, walletReady: Boolean(address && walletClient) }
}

export function readableError(error: any): string {
  const raw =
    error?.shortMessage ||
    error?.details ||
    error?.cause?.shortMessage ||
    error?.cause?.reason ||
    error?.message ||
    "Transaction failed."

  if (/User rejected|User denied|rejected the request/i.test(raw)) return "Transaction rejected in wallet."
  if (/Pool full/i.test(raw)) return "Pool is full - lower the amount."
  if (/Staking disabled for this pool/i.test(raw))
    return "Staking is closed for this pool (deposits stop one lock period before expiry)."
  if (/Stake still locked/i.test(raw)) return "Your stake is still inside the lock period."
  if (/Reward still locked/i.test(raw)) return "Rewards unlock at the end of the lock period."
  if (/Not enough rewards/i.test(raw)) return "The contract does not hold enough tokens to cover this payout."
  if (/Only manager/i.test(raw)) return "This wallet does not have the manager role on the contract."
  if (/insufficient funds/i.test(raw)) return "Not enough ETH on Base to pay for gas."
  return raw.replace(/\s+/g, " ").slice(0, 240)
}
