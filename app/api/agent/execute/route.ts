import { ethers } from "ethers";
import { z } from "zod";
import { POST as chatPost } from "../chat/route";
import { POST as plotTransactionPost } from "../plots/transaction/route";
import { POST as rewardsClaimPost } from "../rewards/claim/transaction/route";
import { POST as rewardsCurrentPost } from "../rewards/current/route";
import { POST as rewardsTotalPost } from "../rewards/total/route";
import { POST as leaderboardRankPost } from "../leaderboard/rank/route";
import { POST as leaderboardTopPost } from "../leaderboard/top/route";
import { POST as leaderboardBtgClaimPost } from "../leaderboard/btg-claim/route";
import { POST as stakeTransactionPost } from "../staking/stake/transaction/route";
import { POST as unstakeTransactionPost } from "../staking/unstake/transaction/route";
import { POST as transferTransactionPost } from "../transfer/transaction/route";
import { POST as swapTransactionPost } from "../swap/transaction/route";
import { POST as walletBalancePost } from "../wallet/balance/route";
import { POST as walletNftsPost } from "../wallet/nfts/route";
import { POST as privySendTransactionPost } from "../privy/agentic/send-transaction/route";
import { getBaseRpcUrl } from "@/app/base-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  message: z.string().min(1).max(500).optional(),
  intent: z.record(z.any()).optional(),
  dryRun: z.boolean().optional(),
  walletAddress: z.string().optional(),
  privy: z
    .object({
      walletId: z.string().min(1),
      userJwt: z.string().min(1).optional(),
      authorizationKey: z.string().min(1).optional(),
      caip2: z.string().min(1).optional(),
    })
    .optional(),
});

function getExecutor() {
  const privateKey = process.env.AGENT_EXECUTOR_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing AGENT_EXECUTOR_PRIVATE_KEY (or WALLET_PRIVATE_KEY).");
  }

  const provider = new ethers.JsonRpcProvider(getBaseRpcUrl());
  const wallet = new ethers.Wallet(privateKey, provider);

  return { provider, wallet };
}

function toBigIntValue(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return BigInt(0);
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  }
  return BigInt(0);
}

function isHexData(data: unknown): data is `0x${string}` {
  return typeof data === "string" && /^0x[0-9a-fA-F]*$/.test(data);
}

async function postToRoute(handler: (request: Request) => Promise<Response>, body: unknown) {
  const req = new Request("http://localhost/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handler(req);
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

type PreparedTx = { to: string; data?: `0x${string}`; value?: bigint };

async function sendTransactionsViaPrivy(
  context: {
    walletId: string;
    userJwt?: string;
    authorizationKey?: string;
    caip2?: string;
  },
  txs: PreparedTx[],
) {
  const hashes: string[] = [];
  for (let i = 0; i < txs.length; i += 1) {
    const tx = txs[i];
    const send = await postToRoute(privySendTransactionPost, {
      walletId: context.walletId,
      userJwt: context.userJwt,
      authorizationKey: context.authorizationKey,
      caip2: context.caip2 || "eip155:8453",
      idempotencyKey: `${context.walletId}:${Date.now()}:${i}`,
      transaction: {
        to: tx.to,
        data: tx.data,
        value: (tx.value ?? BigInt(0)).toString(),
      },
    });

    if (send.status >= 400 || !send.payload?.ok || !send.payload?.hash) {
      throw new Error(send.payload?.error || "Failed to send transaction via Privy wallet.");
    }

    hashes.push(String(send.payload.hash));
  }

  return hashes;
}

async function sendTransactions(
  wallet: ethers.Wallet,
  txs: Array<{ to: string; data?: `0x${string}`; value?: bigint }>,
) {
  const hashes: string[] = [];
  for (const tx of txs) {
    const response = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ?? BigInt(0),
    });
    hashes.push(response.hash);
  }
  return hashes;
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          error:
            "Invalid body. Expected { message?, intent?, dryRun?, walletAddress?, privy?: { walletId, userJwt? | authorizationKey?, caip2? } }.",
        },
        { status: 400 },
      );
    }

    const dryRun = parsed.data.dryRun ?? false;
    const privyContext = parsed.data.privy || null;
    let executorWallet: ethers.Wallet | null = null;

    const requireExecutorWallet = () => {
      if (!executorWallet) {
        executorWallet = getExecutor().wallet;
      }
      return executorWallet;
    };

    const readWalletAddress = parsed.data.walletAddress || null;

    if (privyContext && !privyContext.userJwt && !privyContext.authorizationKey) {
      return Response.json(
        {
          ok: false,
          error: "When privy is provided, include either privy.userJwt or privy.authorizationKey.",
        },
        { status: 400 },
      );
    }

    let intent: any = parsed.data.intent || null;
    if (!intent && parsed.data.message) {
      const chatAddress =
        parsed.data.walletAddress || "0x0000000000000000000000000000000000000000";
      const chat = await postToRoute(chatPost, {
        message: parsed.data.message,
        walletConnected: true,
        address: chatAddress,
      });
      intent = chat.payload?.intent ?? null;
    }

    const writeSourceWalletAddress = privyContext
      ? parsed.data.walletAddress
      : parsed.data.walletAddress;

    if (!intent?.type || intent.type === "unknown") {
      return Response.json(
        { ok: false, error: "Unable to parse actionable intent.", intent },
        { status: 400 },
      );
    }

    if (
      privyContext &&
      ["buy_plot", "stake", "unstake", "claim_bco2"].includes(intent.type) &&
      (!writeSourceWalletAddress || !ethers.isAddress(writeSourceWalletAddress))
    ) {
      return Response.json(
        {
          ok: false,
          error:
            "walletAddress is required in privy mode for buy/stake/unstake/claim actions.",
        },
        { status: 400 },
      );
    }

    // Read intents
    if (intent.type === "balance") {
      if (!readWalletAddress || !ethers.isAddress(readWalletAddress)) {
        return Response.json(
          { ok: false, error: "walletAddress is required for balance reads." },
          { status: 400 },
        );
      }
      const read = await postToRoute(walletBalancePost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "nfts") {
      if (!readWalletAddress || !ethers.isAddress(readWalletAddress)) {
        return Response.json(
          { ok: false, error: "walletAddress is required for NFT reads." },
          { status: 400 },
        );
      }
      const read = await postToRoute(walletNftsPost, { walletAddress: readWalletAddress, limit: 80 });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "current_earnings") {
      if (!readWalletAddress || !ethers.isAddress(readWalletAddress)) {
        return Response.json(
          { ok: false, error: "walletAddress is required for rewards reads." },
          { status: 400 },
        );
      }
      const read = await postToRoute(rewardsCurrentPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "total_earned") {
      if (!readWalletAddress || !ethers.isAddress(readWalletAddress)) {
        return Response.json(
          { ok: false, error: "walletAddress is required for rewards reads." },
          { status: 400 },
        );
      }
      const read = await postToRoute(rewardsTotalPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "leaderboard_rank") {
      if (!readWalletAddress || !ethers.isAddress(readWalletAddress)) {
        return Response.json(
          { ok: false, error: "walletAddress is required for leaderboard rank." },
          { status: 400 },
        );
      }
      const read = await postToRoute(leaderboardRankPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "leaderboard_top") {
      const read = await postToRoute(leaderboardTopPost, { count: intent.count ?? 10 });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "btg_claim") {
      if (!readWalletAddress || !ethers.isAddress(readWalletAddress)) {
        return Response.json(
          { ok: false, error: "walletAddress is required for BTG claim reads." },
          { status: 400 },
        );
      }
      const read = await postToRoute(leaderboardBtgClaimPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }

    // Write intents (execute from executor wallet)
    if (intent.type === "buy_plot") {
      const buyerAddress =
        writeSourceWalletAddress || (privyContext ? null : requireExecutorWallet().address);
      if (!buyerAddress || !ethers.isAddress(buyerAddress)) {
        return Response.json(
          { ok: false, intent, error: "walletAddress is required for plot purchases." },
          { status: 400 },
        );
      }
      const built = await postToRoute(plotTransactionPost, {
        tier: intent.tier,
        buyerAddress,
      });
      if (built.status >= 400 || !built.payload?.ok) {
        return Response.json({ ok: false, intent, error: built.payload?.error || "Failed to build buy tx." }, { status: built.status || 500 });
      }

      const txData = built.payload?.transaction?.data ?? built.payload?.transaction?.inputData;
      if (!isHexData(txData)) {
        return Response.json(
          {
            ok: false,
            intent,
            error:
              "Unsupported listing format for direct execution. Could not find encoded transaction data.",
            metadata: built.payload?.metadata ?? null,
          },
          { status: 422 },
        );
      }

      const txs = [
        {
          to: String(built.payload.transaction.to),
          data: txData,
          value: toBigIntValue(built.payload.transaction.value),
        },
      ];
      const txHashes = dryRun
        ? []
        : privyContext
          ? await sendTransactionsViaPrivy(privyContext, txs)
          : await sendTransactions(requireExecutorWallet(), txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress: privyContext ? null : requireExecutorWallet().address,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "stake") {
      const walletAddress =
        writeSourceWalletAddress || (privyContext ? null : requireExecutorWallet().address);
      if (!walletAddress || !ethers.isAddress(walletAddress)) {
        return Response.json(
          { ok: false, intent, error: "walletAddress is required for staking." },
          { status: 400 },
        );
      }
      const built = await postToRoute(stakeTransactionPost, {
        walletAddress,
        tokenIds: Array.isArray(intent.tokenIds) ? intent.tokenIds : undefined,
        stakeAll: intent.stakeAll ?? !Array.isArray(intent.tokenIds),
        tier: intent.tier,
      });
      if (built.status >= 400 || !built.payload?.ok) {
        return Response.json({ ok: false, intent, error: built.payload?.error || "Failed to build stake tx." }, { status: built.status || 500 });
      }

      const txs = (built.payload.transactions || [])
        .filter((tx: any) => isHexData(tx?.data))
        .map((tx: any) => ({
          to: String(tx.to),
          data: tx.data as `0x${string}`,
          value: toBigIntValue(tx.value),
        }));

      const txHashes = dryRun
        ? []
        : privyContext
          ? await sendTransactionsViaPrivy(privyContext, txs)
          : await sendTransactions(requireExecutorWallet(), txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress: privyContext ? null : requireExecutorWallet().address,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "unstake") {
      const walletAddress =
        writeSourceWalletAddress || (privyContext ? null : requireExecutorWallet().address);
      if (!walletAddress || !ethers.isAddress(walletAddress)) {
        return Response.json(
          { ok: false, intent, error: "walletAddress is required for unstaking." },
          { status: 400 },
        );
      }
      const built = await postToRoute(unstakeTransactionPost, {
        walletAddress,
        tokenIds: Array.isArray(intent.tokenIds) ? intent.tokenIds : undefined,
        unstakeAll: intent.unstakeAll ?? !Array.isArray(intent.tokenIds),
        tier: intent.tier,
      });
      if (built.status >= 400 || !built.payload?.ok) {
        return Response.json({ ok: false, intent, error: built.payload?.error || "Failed to build unstake tx." }, { status: built.status || 500 });
      }

      const txs = (built.payload.transactions || [])
        .filter((tx: any) => isHexData(tx?.data))
        .map((tx: any) => ({
          to: String(tx.to),
          data: tx.data as `0x${string}`,
          value: toBigIntValue(tx.value),
        }));

      const txHashes = dryRun
        ? []
        : privyContext
          ? await sendTransactionsViaPrivy(privyContext, txs)
          : await sendTransactions(requireExecutorWallet(), txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress: privyContext ? null : requireExecutorWallet().address,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "claim_bco2") {
      const walletAddress =
        writeSourceWalletAddress || (privyContext ? null : requireExecutorWallet().address);
      if (!walletAddress || !ethers.isAddress(walletAddress)) {
        return Response.json(
          { ok: false, intent, error: "walletAddress is required for claim actions." },
          { status: 400 },
        );
      }
      const built = await postToRoute(rewardsClaimPost, { walletAddress });
      if (built.status >= 400 || !built.payload?.ok) {
        return Response.json({ ok: false, intent, error: built.payload?.error || "Failed to build claim tx." }, { status: built.status || 500 });
      }

      const txs = (built.payload.transactions || [])
        .filter((tx: any) => isHexData(tx?.data))
        .map((tx: any) => ({
          to: String(tx.to),
          data: tx.data as `0x${string}`,
          value: toBigIntValue(tx.value),
        }));

      const txHashes = dryRun
        ? []
        : privyContext
          ? await sendTransactionsViaPrivy(privyContext, txs)
          : await sendTransactions(requireExecutorWallet(), txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress: privyContext ? null : requireExecutorWallet().address,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "transfer") {
      const built = await postToRoute(transferTransactionPost, {
        symbol: intent.symbol,
        amount: intent.amount,
        toAddress: intent.toAddress,
      });
      if (built.status >= 400 || !built.payload?.ok) {
        return Response.json({ ok: false, intent, error: built.payload?.error || "Failed to build transfer tx." }, { status: built.status || 500 });
      }

      const tx = built.payload.transaction;
      if (!isHexData(tx?.data)) {
        return Response.json({ ok: false, intent, error: "Invalid transfer tx data." }, { status: 422 });
      }

      const txs = [
        {
          to: String(tx.to),
          data: tx.data as `0x${string}`,
          value: toBigIntValue(tx.value),
        },
      ];
      const txHashes = dryRun
        ? []
        : privyContext
          ? await sendTransactionsViaPrivy(privyContext, txs)
          : await sendTransactions(requireExecutorWallet(), txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress: privyContext ? null : requireExecutorWallet().address,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "swap") {
      const swapWalletAddress =
        writeSourceWalletAddress || (privyContext ? null : requireExecutorWallet().address);
      if (!swapWalletAddress || !ethers.isAddress(swapWalletAddress)) {
        return Response.json(
          { ok: false, intent, error: "walletAddress is required for swaps." },
          { status: 400 },
        );
      }

      const built = await postToRoute(swapTransactionPost, {
        amount: intent.amount,
        fromSymbol: intent.fromSymbol,
        toSymbol: intent.toSymbol,
        walletAddress: swapWalletAddress,
      });
      if (built.status >= 400 || !built.payload?.ok) {
        return Response.json(
          { ok: false, intent, error: built.payload?.error || "Failed to build swap tx." },
          { status: built.status || 500 },
        );
      }

      const txs: PreparedTx[] = [];

      // Run approval first if selling ERC-20 (e.g. USDC → ETH)
      if (built.payload.approveTransaction?.data) {
        const approveTx = built.payload.approveTransaction;
        txs.push({
          to: String(approveTx.to),
          data: approveTx.data as `0x${string}`,
          value: toBigIntValue(approveTx.value ?? "0x0"),
        });
      }

      const swapTx = built.payload.transaction;
      if (!isHexData(swapTx?.data)) {
        return Response.json(
          { ok: false, intent, error: "Invalid swap transaction data from CDP." },
          { status: 422 },
        );
      }

      txs.push({
        to: String(swapTx.to),
        data: swapTx.data as `0x${string}`,
        value: toBigIntValue(swapTx.value ?? "0x0"),
      });

      const txHashes = dryRun
        ? []
        : privyContext
          ? await sendTransactionsViaPrivy(privyContext, txs)
          : await sendTransactions(requireExecutorWallet(), txs);

      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress: privyContext ? null : requireExecutorWallet().address,
        transactions: txs,
        txHashes,
        quote: built.payload.quote ?? null,
      });
    }

    return Response.json(
      {
        ok: false,
        intent,
        error: "Intent is recognized but not supported by execute endpoint.",
      },
      { status: 400 },
    );
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Execution failed.",
      },
      { status: 500 },
    );
  }
}
