import { z } from "zod";
import {
  BASE_CHAIN_ID,
  buildUnstakeTransaction,
  groupTokenIdsByPool,
  isValidAddress,
  resolveUnstakeTokenIds,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  walletAddress: z.string().min(42).max(42),
  tokenIds: z.array(z.number().int().positive()).optional(),
  unstakeAll: z.boolean().optional(),
  tier: z.enum(["Legendary", "Premium", "Standard"]).optional(),
  chainId: z.literal(8453).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          error:
            "Invalid body. Expected { walletAddress, tokenIds?: number[], unstakeAll?: boolean, tier?: 'Legendary'|'Premium'|'Standard', chainId?: 8453 }",
        },
        { status: 400 },
      );
    }

    const walletAddress = parsed.data.walletAddress as `0x${string}`;
    const unstakeAll = parsed.data.unstakeAll ?? false;
    const tokenIds = parsed.data.tokenIds;
    const tier = parsed.data.tier;

    if (!isValidAddress(walletAddress)) {
      return Response.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    if (!unstakeAll && (!tokenIds || tokenIds.length === 0)) {
      return Response.json(
        { ok: false, error: "Provide tokenIds or set unstakeAll=true." },
        { status: 400 },
      );
    }

    const resolved = await resolveUnstakeTokenIds({
      walletAddress,
      tokenIds,
      unstakeAll,
      tier,
    });

    if (!resolved.resolvedTokenIds.length) {
      return Response.json(
        {
          ok: false,
          error: "No matching staked plots found to unstake.",
          details: {
            skippedNotStaked: resolved.skippedNotStaked,
            skippedInvalid: resolved.skippedInvalid,
          },
        },
        { status: 404 },
      );
    }

    const grouped = groupTokenIdsByPool(resolved.resolvedTokenIds);
    const transactions = grouped.map((group) => {
      const tx = buildUnstakeTransaction(group.pool.address, group.tokenIds);
      return {
        kind: "unstake" as const,
        tier: group.pool.tier,
        poolAddress: group.pool.address,
        tokenIds: group.tokenIds,
        to: tx.to,
        data: tx.data as `0x${string}`,
        value: tx.value,
      };
    });

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      flow: "unstake",
      walletAddress,
      resolvedTokenIds: resolved.resolvedTokenIds,
      skippedTokenIds: {
        notStaked: resolved.skippedNotStaked,
        invalid: resolved.skippedInvalid,
      },
      transactions,
      summary: {
        unstakeCalls: transactions.length,
        totalPlots: resolved.resolvedTokenIds.length,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to build unstake transactions.",
      },
      { status: 500 },
    );
  }
}
