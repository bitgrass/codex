import { isAddress } from "ethers";
import { z } from "zod";
import {
  getPrivyClient,
  verifyPrivyUserJwt,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  userJwt: z.string().min(1).optional(),
  authorizationKey: z.string().min(1).optional(),
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

function parseChainIdFromCaip2(caip2: string) {
  const match = /^eip155:(\d+)$/.exec(caip2.trim());
  if (!match) return null;
  return Number(match[1]);
}

function buildAuthorizationContext(input: {
  userJwt?: string;
  authorizationKey?: string;
}) {
  const authorizationContext: {
    user_jwts?: string[];
    authorization_private_keys?: string[];
  } = {};

  if (input.userJwt) {
    authorizationContext.user_jwts = [input.userJwt];
  }
  if (input.authorizationKey) {
    authorizationContext.authorization_private_keys = [input.authorizationKey];
  }

  return authorizationContext;
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
            "Invalid body. Expected { walletId, userJwt? or authorizationKey?, transaction: { to, data?, value?, nonce?, gasLimit?, gasPrice?, maxFeePerGas?, maxPriorityFeePerGas?, type? }, caip2?, idempotencyKey? }.",
        },
        { status: 400 },
      );
    }

    if (!parsed.data.userJwt && !parsed.data.authorizationKey) {
      return Response.json(
        {
          ok: false,
          error: "Provide either userJwt or authorizationKey.",
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

    const privy = getPrivyClient();
    const authorizationContext = buildAuthorizationContext({
      userJwt: parsed.data.userJwt,
      authorizationKey: parsed.data.authorizationKey,
    });

    let userId: string | null = null;
    if (parsed.data.userJwt) {
      const verified = await verifyPrivyUserJwt(parsed.data.userJwt);
      userId = verified.user_id;
    }

    // With userJwt we verify ownership directly. With authorizationKey, Privy validates
    // the request signature at send time, so we only do wallet existence checks here.
    let walletExists = false;
    if (userId) {
      for await (const wallet of privy.wallets().list({
        user_id: userId,
        chain_type: "ethereum",
      })) {
        if (wallet.id === parsed.data.walletId) {
          walletExists = true;
          break;
        }
      }
    } else {
      try {
        await privy.wallets().get(parsed.data.walletId);
        walletExists = true;
      } catch {
        walletExists = false;
      }
    }

    if (!walletExists) {
      return Response.json(
        {
          ok: false,
          error: "walletId was not found.",
        },
        { status: 404 },
      );
    }

    const tx = parsed.data.transaction;
    const caip2 = parsed.data.caip2 || "eip155:8453";
    const chainId = parseChainIdFromCaip2(caip2);
    if (!chainId) {
      return Response.json(
        {
          ok: false,
          error: "Invalid caip2. Expected eip155:<chainId>.",
        },
        { status: 400 },
      );
    }

    const result = await privy.wallets().ethereum().sendTransaction(
      parsed.data.walletId,
      {
        caip2,
        params: {
          transaction: {
            to: tx.to,
            data: tx.data,
            value: normalizeRpcNumeric(tx.value),
            chain_id: chainId,
            nonce: normalizeRpcNumeric(tx.nonce),
            gas_limit: normalizeRpcNumeric(tx.gasLimit),
            gas_price: normalizeRpcNumeric(tx.gasPrice),
            max_fee_per_gas: normalizeRpcNumeric(tx.maxFeePerGas),
            max_priority_fee_per_gas: normalizeRpcNumeric(tx.maxPriorityFeePerGas),
            type: tx.type as 0 | 1 | 2 | 4 | undefined,
          },
        },
        idempotency_key: parsed.data.idempotencyKey,
        authorization_context: authorizationContext,
      },
    );

    return Response.json({
      ok: true,
      walletId: parsed.data.walletId,
      authorizationMode: parsed.data.authorizationKey ? "authorization_key" : "user_jwt",
      userId,
      hash: result.hash,
      caip2: result.caip2,
      chainId,
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
