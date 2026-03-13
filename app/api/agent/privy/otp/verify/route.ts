import { z } from "zod";
import {
  authenticateWalletSession,
  createWalletForUser,
  extractEmailFromPrivyUser,
  findFirstWalletForUser,
  getUserPrimaryEmail,
  resolveVerifiedAuthIdentity,
  type AgentAccessMode,
  updateWalletPolicy,
  upsertAgentPreferences,
  verifyPrivyEmailOtp,
  getPrivyClient,
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

export async function POST(request: Request) {
  try {
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

    const identity = await resolveVerifiedAuthIdentity(auth);
    const userJwt = identity.userJwt;
    const userId = identity.userId;

    if (!userId) {
      return Response.json(
        {
          ok: false,
          error: "OTP verified but could not resolve user ID.",
        },
        { status: 500 },
      );
    }

    let wallet = null as Awaited<ReturnType<typeof findFirstWalletForUser>>;
    let walletCreated = false;

    if (shouldCreateWallet) {
      wallet = await findFirstWalletForUser({
        userId,
        chainType,
      });

      if (!wallet) {
        wallet = await createWalletForUser({
          chainType,
          userId,
          policyIds: parsed.data.policyId ? [parsed.data.policyId] : undefined,
        });
        walletCreated = true;
      } else if (parsed.data.policyId && !wallet.policy_ids?.includes(parsed.data.policyId)) {
        wallet = await updateWalletPolicy({
          walletId: wallet.id,
          policyIds: [parsed.data.policyId],
          userJwt: userJwt || undefined,
        });
      }
    }

    const session = userJwt ? await authenticateWalletSession(getPrivyClient(), userJwt) : null;

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
      tokenSource: identity.source,
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
            expiresAt: session.expiresAt,
            authorizationKey: session.authorizationKey,
            encryptedAuthorizationKey: session.encryptedAuthorizationKey,
          }
        : null,
      preferences,
      next: userJwt
        ? "Use returned userJwt + wallet.id with /api/agent/privy/agentic/send-transaction."
        : "OTP verified, but no verifiable access token was returned. Retry verify with a fresh OTP.",
    });
  } catch (error: any) {
    const privyStatus = error?.privyStatus;
    const privyPayload = error?.privyPayload;
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to verify email OTP.",
        ...(privyStatus ? { privyStatus } : {}),
        ...(privyPayload ? { privyDetail: privyPayload } : {}),
      },
      { status: privyStatus && privyStatus >= 400 ? privyStatus : 500 },
    );
  }
}
