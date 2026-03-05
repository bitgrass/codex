import { ethers } from "ethers";
import { z } from "zod";
import { BASE_CHAIN_ID, getStakeState, isValidAddress } from "../_lib";

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

    const state = await getStakeState(walletAddress);

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      walletAddress,
      totals: {
        stakedCount:
          state.legendary.tokenIds.length +
          state.premium.tokenIds.length +
          state.standard.tokenIds.length,
        rewardsWei: state.totalRewardsWei.toString(),
        rewardsReadable: ethers.formatUnits(state.totalRewardsWei, 18),
      },
      pools: {
        legendary: {
          tokenIds: state.legendary.tokenIds,
          rewardsWei: state.legendary.rewardsWei.toString(),
          rewardsReadable: ethers.formatUnits(state.legendary.rewardsWei, 18),
          count: state.legendary.tokenIds.length,
        },
        premium: {
          tokenIds: state.premium.tokenIds,
          rewardsWei: state.premium.rewardsWei.toString(),
          rewardsReadable: ethers.formatUnits(state.premium.rewardsWei, 18),
          count: state.premium.tokenIds.length,
        },
        standard: {
          tokenIds: state.standard.tokenIds,
          rewardsWei: state.standard.rewardsWei.toString(),
          rewardsReadable: ethers.formatUnits(state.standard.rewardsWei, 18),
          count: state.standard.tokenIds.length,
        },
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch staking status.",
      },
      { status: 500 },
    );
  }
}
