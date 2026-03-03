import { z } from "zod";
import {
  BASE_CHAIN_ID,
  buildStandardMintTransaction,
  fetchFulfillmentData,
  findBestTierListing,
  findTierListingByOrderHash,
  getStandardMintQuote,
  isValidAddress,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  tier: z.enum(["Standard", "Premium", "Legendary"]),
  buyerAddress: z.string().min(42).max(42),
  quantity: z.number().int().min(1).max(20).optional(),
  orderHash: z.string().min(1).optional(),
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
            "Invalid body. Expected { tier, buyerAddress, quantity?, orderHash? } with buyerAddress as 0x address.",
        },
        { status: 400 },
      );
    }

    const { tier, orderHash } = parsed.data;
    const buyerAddress = parsed.data.buyerAddress as `0x${string}`;
    const quantity = parsed.data.quantity ?? 1;

    if (!isValidAddress(buyerAddress)) {
      return Response.json({ ok: false, error: "Invalid buyerAddress." }, { status: 400 });
    }

    if (tier === "Standard") {
      const quote = await getStandardMintQuote(quantity);
      const tx = buildStandardMintTransaction({
        buyerAddress,
        quantity,
        unitPriceWei: quote.unitPriceWei,
      });

      return Response.json({
        ok: true,
        chainId: BASE_CHAIN_ID,
        tier,
        flow: "seadrop_mint",
        transaction: {
          to: tx.to,
          data: tx.data,
          value: tx.value,
        },
        metadata: {
          functionName: tx.functionName,
          unitPriceWei: quote.unitPriceWei.toString(),
          totalPriceWei: quote.totalPriceWei.toString(),
          quantity,
        },
      });
    }

    const listing =
      orderHash && orderHash.trim().length > 0
        ? await findTierListingByOrderHash(tier, orderHash)
        : await findBestTierListing(tier);

    if (!listing) {
      return Response.json(
        { ok: false, error: `No active ${tier} listing found for the provided criteria.` },
        { status: 404 },
      );
    }

    const fulfillment = await fetchFulfillmentData({
      orderHash: listing.orderHash,
      protocolAddress: listing.protocolAddress,
      buyerAddress,
    });

    const tx = fulfillment?.fulfillment_data?.transaction;
    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      tier,
      flow: "seaport_fulfillment",
      listing: {
        orderHash: listing.orderHash,
        protocolAddress: listing.protocolAddress,
        tokenId: listing.tokenId,
        priceWei: listing.priceWei,
      },
      transaction: {
        to: tx?.to ?? listing.protocolAddress,
        value: String(tx?.value ?? "0"),
        function: tx?.function ?? null,
        inputData: tx?.input_data ?? null,
        data: tx?.data ?? null,
      },
      metadata: {
        note:
          "If transaction.data is present, submit it directly. Otherwise call transaction.function with transaction.inputData on transaction.to.",
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to build transaction.",
      },
      { status: 500 },
    );
  }
}
