import { isAddress } from "ethers";
import { z } from "zod";
import {
  findFirstWalletForUser,
  getUserPrimaryEmail,
  getPrivyClient,
  verifyPrivyUserJwt,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  userJwt: z.string().min(1),
  walletId: z.string().min(1),
  caip2: z.string().min(1).optional(),
  transaction: z.object({
    to: z.string().min(42).max(42),
    data: z.string().optional(),
    value: z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/).optional(),
    nonce: z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/).optional(),
    gasLimit: z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/).optional(),
    gasPrice: z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/).optional(),
    maxFeePerGas: z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/).optional(),
    maxPriorityFeePerGas: z
      .string()
      .regex(/^(0x[0-9a-fA-F]+|\d+)$/)
      .optional(),
    type: z.number().int().optional(),
  }),
  idempotencyKey: z.string().min(1).optional(),
});

function normalizeRpcNumeric(value: string | undefined) {
  if (!value) return undefined;
  if (/^0x/i.test(value)) return value;
  return value;
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
            "Invalid body. Expected { userJwt, walletId, transaction: { to, data?, value?, nonce?, gasLimit?, gasPrice?, maxFeePerGas?, maxPriorityFeePerGas?, type? }, caip2?, idempotencyKey? }.",
        },
        { status: 400 },
      );
    }

    if (!isAddress(parsed.data.transaction.to)) {
      return Response.json(
        { ok: false, error: "Invalid transaction.to address." },
        { status: 400 },
      );
    }

    const verified = await verifyPrivyUserJwt(parsed.data.userJwt);
    const userId = verified.user_id;
    const email = await getUserPrimaryEmail(userId);
    if (!email) {
      return Response.json(
        {
          ok: false,
          error:
            "Email OTP login is required. This user has no email account linked in Privy.",
        },
        { status: 403 },
      );
    }

    const privy = getPrivyClient();

    // Verify ownership: ensure wallet exists for this user on ethereum.
    let ownedWallet = null as any;
    for await (const wallet of privy.wallets().list({
      user_id: userId,
      chain_type: "ethereum",
    })) {
      if (wallet.id === parsed.data.walletId) {
        ownedWallet = wallet;
        break;
      }
    }

    if (!ownedWallet) {
      const firstWallet = await findFirstWalletForUser({
        userId,
        chainType: "ethereum",
      });
      return Response.json(
        {
          ok: false,
          error:
            "walletId is not owned by this user or no ethereum wallet found for user.",
          firstWalletHint: firstWallet
            ? { id: firstWallet.id, address: firstWallet.address }
            : null,
        },
        { status: 403 },
      );
    }

    const tx = parsed.data.transaction;
    const result = await privy.wallets().ethereum().sendTransaction(
      parsed.data.walletId,
      {
        caip2: parsed.data.caip2 || "eip155:8453",
        params: {
          transaction: {
            to: tx.to,
            data: tx.data,
            value: normalizeRpcNumeric(tx.value),
            nonce: normalizeRpcNumeric(tx.nonce),
            gas_limit: normalizeRpcNumeric(tx.gasLimit),
            gas_price: normalizeRpcNumeric(tx.gasPrice),
            max_fee_per_gas: normalizeRpcNumeric(tx.maxFeePerGas),
            max_priority_fee_per_gas: normalizeRpcNumeric(tx.maxPriorityFeePerGas),
            type: tx.type as 0 | 1 | 2 | 4 | undefined,
          },
        },
        idempotency_key: parsed.data.idempotencyKey,
        authorization_context: {
          user_jwts: [parsed.data.userJwt],
        },
      },
    );

    return Response.json({
      ok: true,
      email,
      walletId: parsed.data.walletId,
      hash: result.hash,
      caip2: result.caip2,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to send transaction with Privy agent wallet.",
      },
      { status: 500 },
    );
  }
}
