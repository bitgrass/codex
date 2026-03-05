import { ethers } from "ethers";
import { z } from "zod";
import { BASE_CHAIN_ID, getStakeState, isValidAddress } from "../../staking/_lib";

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
      total: {
        rewardsWei: state.totalRewardsWei.toString(),
        rewardsReadable: ethers.formatUnits(state.totalRewardsWei, 18),
      },
      pools: {
        legendary: {
          rewardsWei: state.legendary.rewardsWei.toString(),
          rewardsReadable: ethers.formatUnits(state.legendary.rewardsWei, 18),
          stakedCount: state.legendary.tokenIds.length,
        },
        premium: {
          rewardsWei: state.premium.rewardsWei.toString(),
          rewardsReadable: ethers.formatUnits(state.premium.rewardsWei, 18),
          stakedCount: state.premium.tokenIds.length,
        },
        standard: {
          rewardsWei: state.standard.rewardsWei.toString(),
          rewardsReadable: ethers.formatUnits(state.standard.rewardsWei, 18),
          stakedCount: state.standard.tokenIds.length,
        },
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch current rewards.",
      },
      { status: 500 },
    );
  }
}
