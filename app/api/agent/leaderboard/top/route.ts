import { z } from "zod";
import { BASE_CHAIN_ID, fetchLeaderboardTop } from "../../staking/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  count: z.number().int().min(1).max(50).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { count?: 1..50 }." },
        { status: 400 },
      );
    }

    const count = parsed.data.count ?? 10;
    const rows = await fetchLeaderboardTop(count);
    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      count: rows.length,
      rows,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch leaderboard top.",
      },
      { status: 500 },
    );
  }
}
