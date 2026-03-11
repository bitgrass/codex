import { z } from "zod";
import {
  extractEmailFromPrivyUser,
  findFirstWalletForUser,
  getPrivyClient,
  getUserPrimaryEmail,
  type AgentAccessMode,
  type PrivyPasswordlessAuthenticateResponse,
  upsertAgentPreferences,
  verifyPrivyEmailOtp,
  verifyPrivyUserJwt,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(10),
  mode: z.enum(["no-signup", "login-or-sign-up"]).optional(),
  createWallet: z.boolean().optional(),
  chainType: z.enum(["ethereum", "solana"]).optional(),
  policyId: z.string().min(1).optional(),
  acceptTerms: z.boolean().optional(),
  access: z.enum(["read_only", "read_write"]).optional(),
  keyName: z.string().min(1).max(64).optional(),
  enableLlm: z.boolean().optional(),
});

function isAuthorized(request: Request) {
  const expected = process.env.BITGRASS_AGENT_API_KEY;
  if (!expected) return true;

  const headerKey = request.headers.get("x-agent-api-key") || "";
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return headerKey === expected || bearer === expected;
}

function pickUserJwt(payload: PrivyPasswordlessAuthenticateResponse) {
  if (payload.privy_access_token && payload.privy_access_token.length > 0) {
    return payload.privy_access_token;
  }
  if (payload.token && payload.token.length > 0) {
    return payload.token;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          error:
            "Invalid body. Expected { email, code, mode?, createWallet?, chainType?, policyId?, acceptTerms?, access?, keyName?, enableLlm? }.",
        },
        { status: 400 },
      );
    }

    const email = parsed.data.email.toLowerCase();
    const chainType = parsed.data.chainType ?? "ethereum";
    const shouldCreateWallet = parsed.data.createWallet ?? true;
    const setupRequested =
      parsed.data.acceptTerms !== undefined ||
      parsed.data.access !== undefined ||
      parsed.data.keyName !== undefined ||
      parsed.data.enableLlm !== undefined;

    if (setupRequested && parsed.data.acceptTerms !== true) {
      return Response.json(
        {
          ok: false,
          error:
            "acceptTerms must be true when setting agent preferences during OTP verification.",
        },
        { status: 400 },
      );
    }

    const auth = await verifyPrivyEmailOtp({
      email,
      code: parsed.data.code,
      mode: parsed.data.mode,
    });

    const userJwt = pickUserJwt(auth);
    let userId = auth.user?.id ? String(auth.user.id) : null;
    if (!userId && userJwt) {
      const verified = await verifyPrivyUserJwt(userJwt).catch(() => null);
      userId = verified?.user_id ? String(verified.user_id) : null;
    }

    if (!userId) {
      return Response.json(
        {
          ok: false,
          error: "OTP verified but could not resolve user ID.",
        },
        { status: 500 },
      );
    }

    const privy = getPrivyClient();
    let wallet = null as Awaited<ReturnType<typeof findFirstWalletForUser>>;
    let walletCreated = false;

    if (shouldCreateWallet) {
      wallet = await findFirstWalletForUser({
        userId,
        chainType,
      });

      if (!wallet) {
        wallet = await privy.wallets().create({
          chain_type: chainType,
          owner: { user_id: userId },
          policy_ids: parsed.data.policyId ? [parsed.data.policyId] : undefined,
        });
        walletCreated = true;
      } else if (parsed.data.policyId && !wallet.policy_ids?.includes(parsed.data.policyId)) {
        wallet = await privy.wallets().update(wallet.id, {
          policy_ids: [parsed.data.policyId],
          authorization_context: userJwt
            ? {
                user_jwts: [userJwt],
              }
            : undefined,
        });
      }
    }

    const session = userJwt
      ? await privy.wallets().authenticateWithJwt({
          user_jwt: userJwt,
        })
      : null;

    let preferences = null as any;
    if (setupRequested) {
      const access: AgentAccessMode = parsed.data.access ?? "read_only";
      preferences = await upsertAgentPreferences({
        userId,
        access,
        keyName: parsed.data.keyName,
        enableLlm: parsed.data.enableLlm,
        acceptTerms: true,
      });
    }

    const linkedEmail = extractEmailFromPrivyUser(auth.user) || (await getUserPrimaryEmail(userId));

    return Response.json({
      ok: true,
      email: linkedEmail || email,
      isNewUser: Boolean(auth.is_new_user),
      userId,
      userJwt,
      refreshToken: auth.refresh_token ?? null,
      identityToken: auth.identity_token ?? null,
      wallet: wallet
        ? {
            id: wallet.id,
            address: wallet.address,
            chainType: wallet.chain_type,
            policyIds: wallet.policy_ids,
            created: walletCreated,
          }
        : null,
      session: session
        ? {
            expiresAt: session.expires_at,
            authorizationKey:
              "authorization_key" in session ? session.authorization_key : undefined,
            encryptedAuthorizationKey:
              "encrypted_authorization_key" in session
                ? session.encrypted_authorization_key
                : undefined,
          }
        : null,
      preferences,
      next: userJwt
        ? "Persist session.authorizationKey and use authorizationKey + wallet.id with /api/agent/privy/agentic/send-transaction."
        : "OTP verified. No userJwt returned; call setup endpoint with a valid userJwt.",
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to verify email OTP.",
      },
      { status: 500 },
    );
  }
}
