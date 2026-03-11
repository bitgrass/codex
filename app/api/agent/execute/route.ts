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
import { POST as walletBalancePost } from "../wallet/balance/route";
import { POST as walletNftsPost } from "../wallet/nfts/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  message: z.string().min(1).max(500).optional(),
  intent: z.record(z.any()).optional(),
  dryRun: z.boolean().optional(),
  walletAddress: z.string().optional(),
});

function isAuthorized(request: Request) {
  const expected = process.env.BITGRASS_AGENT_API_KEY;
  if (!expected) return true;

  const headerKey = request.headers.get("x-agent-api-key") || "";
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return headerKey === expected || bearer === expected;
}

function getExecutor() {
  const privateKey = process.env.AGENT_EXECUTOR_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing AGENT_EXECUTOR_PRIVATE_KEY (or WALLET_PRIVATE_KEY).");
  }

  const rpcUrl =
    process.env.BASE_MAINNET_RPC_URL ||
    process.env.BASE_RPC_URL ||
    "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
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
    if (!isAuthorized(request)) {
      return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { message?, intent?, dryRun?, walletAddress? }." },
        { status: 400 },
      );
    }

    const dryRun = parsed.data.dryRun ?? false;
    const { wallet } = getExecutor();
    const executorAddress = wallet.address;
    const readWalletAddress = parsed.data.walletAddress || executorAddress;

    let intent: any = parsed.data.intent || null;
    if (!intent && parsed.data.message) {
      const chat = await postToRoute(chatPost, {
        message: parsed.data.message,
        walletConnected: true,
        address: executorAddress,
      });
      intent = chat.payload?.intent ?? null;
    }

    if (!intent?.type || intent.type === "unknown") {
      return Response.json(
        { ok: false, error: "Unable to parse actionable intent.", intent },
        { status: 400 },
      );
    }

    // Read intents
    if (intent.type === "balance") {
      const read = await postToRoute(walletBalancePost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "nfts") {
      const read = await postToRoute(walletNftsPost, { walletAddress: readWalletAddress, limit: 80 });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "current_earnings") {
      const read = await postToRoute(rewardsCurrentPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "total_earned") {
      const read = await postToRoute(rewardsTotalPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "leaderboard_rank") {
      const read = await postToRoute(leaderboardRankPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "leaderboard_top") {
      const read = await postToRoute(leaderboardTopPost, { count: intent.count ?? 10 });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }
    if (intent.type === "btg_claim") {
      const read = await postToRoute(leaderboardBtgClaimPost, { walletAddress: readWalletAddress });
      return Response.json({ ok: read.status < 400, mode: "read", intent, result: read.payload }, { status: read.status });
    }

    // Write intents (execute from executor wallet)
    if (intent.type === "buy_plot") {
      const built = await postToRoute(plotTransactionPost, {
        tier: intent.tier,
        buyerAddress: executorAddress,
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
      const txHashes = dryRun ? [] : await sendTransactions(wallet, txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "stake") {
      const built = await postToRoute(stakeTransactionPost, {
        walletAddress: executorAddress,
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

      const txHashes = dryRun ? [] : await sendTransactions(wallet, txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "unstake") {
      const built = await postToRoute(unstakeTransactionPost, {
        walletAddress: executorAddress,
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

      const txHashes = dryRun ? [] : await sendTransactions(wallet, txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "claim_bco2") {
      const built = await postToRoute(rewardsClaimPost, { walletAddress: executorAddress });
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

      const txHashes = dryRun ? [] : await sendTransactions(wallet, txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress,
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
      const txHashes = dryRun ? [] : await sendTransactions(wallet, txs);
      return Response.json({
        ok: true,
        mode: dryRun ? "dry_run" : "executed",
        intent,
        executorAddress,
        transactions: txs,
        txHashes,
      });
    }

    if (intent.type === "swap") {
      return Response.json(
        {
          ok: false,
          intent,
          error: "Swap direct execution is not supported here because only quote endpoint is available.",
        },
        { status: 400 },
      );
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

