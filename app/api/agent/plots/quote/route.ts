import { ethers } from "ethers";
import { z } from "zod";
import { BASE_CHAIN_ID, findBestTierListing, getStandardMintQuote } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  tier: z.enum(["Standard", "Premium", "Legendary"]),
  quantity: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          error: "Invalid body. Expected { tier: 'Standard'|'Premium'|'Legendary', quantity?: 1..20 }",
        },
        { status: 400 },
      );
    }

    const { tier } = parsed.data;
    const quantity = parsed.data.quantity ?? 1;

    if (tier === "Standard") {
      const quote = await getStandardMintQuote(quantity);
      return Response.json({
        ok: true,
        chainId: BASE_CHAIN_ID,
        tier,
        quoteType: "seadrop_mint",
        quantity: quote.quantity,
        unitPriceWei: quote.unitPriceWei.toString(),
        totalPriceWei: quote.totalPriceWei.toString(),
        unitPriceEth: ethers.formatEther(quote.unitPriceWei),
        totalPriceEth: ethers.formatEther(quote.totalPriceWei),
      });
    }

    const listing = await findBestTierListing(tier);
    if (!listing) {
      return Response.json(
        { ok: false, error: `No active ${tier} listings are available right now.` },
        { status: 404 },
      );
    }

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      tier,
      quoteType: "seaport_listing",
      orderHash: listing.orderHash,
      protocolAddress: listing.protocolAddress,
      tokenId: listing.tokenId,
      priceWei: listing.priceWei,
      priceEth: ethers.formatEther(BigInt(listing.priceWei)),
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to build quote.",
      },
      { status: 500 },
    );
  }
}
