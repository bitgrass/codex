import { ethers } from "ethers";
import { z } from "zod";
import {
  BASE_CHAIN_ID,
  buildClaimRewardsTransaction,
  isValidAddress,
  resolveClaimableRewards,
} from "../../../staking/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  walletAddress: z.string().min(42).max(42),
  chainId: z.literal(8453).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { walletAddress, chainId?: 8453 }." },
        { status: 400 },
      );
    }

    const walletAddress = parsed.data.walletAddress as `0x${string}`;
    if (!isValidAddress(walletAddress)) {
      return Response.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    const claimable = await resolveClaimableRewards(walletAddress);
    const transactions = claimable.pools.map((pool) => {
      const tx = buildClaimRewardsTransaction(pool.poolAddress as `0x${string}`);
      return {
        kind: "claim_rewards" as const,
        tier: pool.tier,
        poolAddress: pool.poolAddress,
        to: tx.to,
        data: tx.data as `0x${string}`,
        value: tx.value,
        claimableWei: pool.rewardsWei,
      };
    });

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      walletAddress,
      claimable: {
        totalWei: claimable.totalClaimableWei.toString(),
        totalReadable: ethers.formatUnits(claimable.totalClaimableWei, 18),
        pools: claimable.pools,
      },
      transactions,
      summary: {
        claimCalls: transactions.length,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to build claim transactions.",
      },
      { status: 500 },
    );
  }
}
