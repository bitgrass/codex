import { z } from "zod";
import {
  BASE_CHAIN_ID,
  buildApprovalTransaction,
  buildStakeTransaction,
  getPoolForTier,
  groupTokenIdsByPool,
  isApprovedForAll,
  isValidAddress,
  resolveStakeTokenIds,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  walletAddress: z.string().min(42).max(42),
  tokenIds: z.array(z.number().int().positive()).optional(),
  stakeAll: z.boolean().optional(),
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
            "Invalid body. Expected { walletAddress, tokenIds?: number[], stakeAll?: boolean, tier?: 'Legendary'|'Premium'|'Standard', chainId?: 8453 }",
        },
        { status: 400 },
      );
    }

    const walletAddress = parsed.data.walletAddress as `0x${string}`;
    const stakeAll = parsed.data.stakeAll ?? false;
    const tokenIds = parsed.data.tokenIds;
    const tier = parsed.data.tier;

    if (!isValidAddress(walletAddress)) {
      return Response.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    if (!stakeAll && (!tokenIds || tokenIds.length === 0)) {
      return Response.json(
        { ok: false, error: "Provide tokenIds or set stakeAll=true." },
        { status: 400 },
      );
    }

    const resolved = await resolveStakeTokenIds({
      walletAddress,
      tokenIds,
      stakeAll,
      tier,
    });

    if (!resolved.resolvedTokenIds.length) {
      return Response.json(
        {
          ok: false,
          error: "No eligible plots found to stake.",
          details: {
            skippedAlreadyStaked: resolved.skippedAlreadyStaked,
            skippedInvalid: resolved.skippedInvalid,
          },
        },
        { status: 404 },
      );
    }

    const grouped = groupTokenIdsByPool(resolved.resolvedTokenIds);
    const transactions: Array<{
      kind: "approval" | "stake";
      tier: "Legendary" | "Premium" | "Standard";
      poolAddress: `0x${string}`;
      tokenIds: number[];
      to: `0x${string}`;
      data: `0x${string}`;
      value: `0x${string}`;
    }> = [];

    for (const group of grouped) {
      const operator = group.pool.address;
      const approved = await isApprovedForAll(walletAddress, operator);
      const targetTier = tier ?? group.pool.tier;
      const poolAddress = tier ? getPoolForTier(targetTier).address : group.pool.address;

      if (!approved) {
        const approvalTx = buildApprovalTransaction(operator);
        transactions.push({
          kind: "approval",
          tier: group.pool.tier,
          poolAddress,
          tokenIds: [],
          to: approvalTx.to,
          data: approvalTx.data as `0x${string}`,
          value: approvalTx.value,
        });
      }

      const stakeTx = buildStakeTransaction(poolAddress, group.tokenIds);
      transactions.push({
        kind: "stake",
        tier: group.pool.tier,
        poolAddress,
        tokenIds: group.tokenIds,
        to: stakeTx.to,
        data: stakeTx.data as `0x${string}`,
        value: stakeTx.value,
      });
    }

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      flow: "stake",
      walletAddress,
      resolvedTokenIds: resolved.resolvedTokenIds,
      skippedTokenIds: {
        alreadyStaked: resolved.skippedAlreadyStaked,
        invalid: resolved.skippedInvalid,
      },
      transactions,
      summary: {
        approvalCount: transactions.filter((tx) => tx.kind === "approval").length,
        stakeCalls: transactions.filter((tx) => tx.kind === "stake").length,
        totalPlots: resolved.resolvedTokenIds.length,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to build stake transactions.",
      },
      { status: 500 },
    );
  }
}
