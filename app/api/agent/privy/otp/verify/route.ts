import { z } from "zod";
import {
  authenticateWalletSession,
  createWalletForUser,
  extractEmailFromPrivyUser,
  findFirstWalletForUser,
  getPrivyClient,
  getUserPrimaryEmail,
  sendPrivyEmailOtp,
  type AgentAccessMode,
  type PrivyPasswordlessAuthenticateResponse,
  type WalletSessionResult,
  updateWalletPolicy,
  upsertAgentPreferences,
  verifyPrivyEmailOtp,
  verifyPrivyUserJwt,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SendStepSchema = z.object({
  step: z.literal("send"),
  email: z.string().email(),
  captchaToken: z.string().min(1).optional(),
});

const VerifyStepSchema = z.object({
  step: z.literal("verify"),
  email: z.string().email(),
  code: z.string().min(4).max(10),
  mode: z.enum(["no-signup", "login-or-sign-up"]).optional(),
  autoSetup: z.boolean().optional(),
  createWallet: z.boolean().optional(),
  chainType: z.enum(["ethereum", "solana"]).optional(),
  policyId: z.string().min(1).optional(),
  acceptTerms: z.boolean().optional(),
  access: z.enum(["read_only", "read_write"]).optional(),
  keyName: z.string().min(1).max(64).optional(),
  enableLlm: z.boolean().optional(),
});

const SetupStepSchema = z.object({
  step: z.literal("setup"),
  userJwt: z.string().min(1),
  createWallet: z.boolean().optional(),
  chainType: z.enum(["ethereum", "solana"]).optional(),
  policyId: z.string().min(1).optional(),
  acceptTerms: z.boolean(),
  access: z.enum(["read_only", "read_write"]).optional(),
  keyName: z.string().min(1).max(64).optional(),
  enableLlm: z.boolean().optional(),
});

const RequestSchema = z.union([SendStepSchema, VerifyStepSchema, SetupStepSchema]);

function pickUserJwt(payload: PrivyPasswordlessAuthenticateResponse) {
  if (payload.privy_access_token && payload.privy_access_token.length > 0) {
    return payload.privy_access_token;
  }
  if (payload.token && payload.token.length > 0) {
    return payload.token;
  }
  return null;
}

async function runSetup(params: {
  userJwt: string;
  createWallet?: boolean;
  chainType?: "ethereum" | "solana";
  policyId?: string;
  acceptTerms: boolean;
  access?: AgentAccessMode;
  keyName?: string;
  enableLlm?: boolean;
}) {
  if (!params.acceptTerms) {
    throw new Error("acceptTerms must be true to complete setup.");
  }

  const verified = await verifyPrivyUserJwt(params.userJwt);
  const userId = verified.user_id;
  const chainType = params.chainType ?? "ethereum";
  const shouldCreateWallet = params.createWallet ?? true;
  const access: AgentAccessMode = params.access ?? "read_only";
  const privy = getPrivyClient();

  const email = await getUserPrimaryEmail(userId);
  if (!email) {
    throw new Error("Email OTP login is required. This user has no email account linked in Privy.");
  }

  let wallet = null as Awaited<ReturnType<typeof findFirstWalletForUser>>;
  let walletCreated = false;

  if (shouldCreateWallet) {
    wallet = await findFirstWalletForUser({ userId, chainType });

    if (!wallet) {
      wallet = await createWalletForUser({
        chainType,
        userId,
        policyIds: params.policyId ? [params.policyId] : undefined,
      });
      walletCreated = true;
    } else if (params.policyId && !wallet.policy_ids?.includes(params.policyId)) {
      wallet = await updateWalletPolicy({
        walletId: wallet.id,
        policyIds: [params.policyId],
        userJwt: params.userJwt,
      });
    }
  }

  // Use the SDK-agnostic wallet session helper
  const session: WalletSessionResult = await authenticateWalletSession(privy, params.userJwt);

  const preferences = await upsertAgentPreferences({
    userId,
    access,
    keyName: params.keyName,
    enableLlm: params.enableLlm,
    acceptTerms: true,
  });

  return {
    userId,
    email,
    wallet: wallet
      ? {
          id: wallet.id,
          address: wallet.address,
          chainType: wallet.chain_type,
          policyIds: wallet.policy_ids,
          created: walletCreated,
        }
      : null,
    session: {
      expiresAt: session.expiresAt,
      authorizationKey: session.authorizationKey,
      encryptedAuthorizationKey: session.encryptedAuthorizationKey,
    },
    preferences,
  };
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
            "Invalid body. Expected { step: 'send' | 'verify' | 'setup', ... }.",
        },
        { status: 400 },
      );
    }

    // ─── STEP: SEND ──────────────────────────────────────────────────────
    if (parsed.data.step === "send") {
      const email = parsed.data.email.toLowerCase();
      const initResult = await sendPrivyEmailOtp(email, parsed.data.captchaToken);

      return Response.json({
        ok: true,
        step: "send",
        email,
        ...(initResult.session_token ? { sessionToken: initResult.session_token } : {}),
        ...(initResult.challenge_id ? { challengeId: initResult.challenge_id } : {}),
        nextStep: "verify",
        next: "Ask user for OTP, then call this endpoint with { step: 'verify', email, code, ... }.",
      });
    }

    // ─── STEP: SETUP ─────────────────────────────────────────────────────
    if (parsed.data.step === "setup") {
      const setup = await runSetup({
        userJwt: parsed.data.userJwt,
        createWallet: parsed.data.createWallet,
        chainType: parsed.data.chainType,
        policyId: parsed.data.policyId,
        acceptTerms: parsed.data.acceptTerms,
        access: parsed.data.access,
        keyName: parsed.data.keyName,
        enableLlm: parsed.data.enableLlm,
      });

      return Response.json({
        ok: true,
        step: "setup",
        ...setup,
      });
    }

    // ─── STEP: VERIFY ────────────────────────────────────────────────────
    const email = parsed.data.email.toLowerCase();

    let auth: PrivyPasswordlessAuthenticateResponse;
    try {
      auth = await verifyPrivyEmailOtp({
        email,
        code: parsed.data.code,
        mode: parsed.data.mode,
      });
    } catch (verifyError: any) {
      const privyStatus = verifyError?.privyStatus;
      const privyPayload = verifyError?.privyPayload;

      console.error("[onboard/verify] Privy authenticate failed:", {
        email,
        privyStatus,
        message: verifyError?.message,
      });

      return Response.json(
        {
          ok: false,
          step: "verify",
          error: verifyError?.message || "OTP verification failed.",
          ...(privyStatus ? { privyStatus } : {}),
          ...(privyPayload ? { privyDetail: privyPayload } : {}),
          hint:
            privyStatus === 401 || privyStatus === 403
              ? "OTP expired or incorrect. The user must request a new OTP (step: send) — do NOT reuse the old code."
              : privyStatus === 429
                ? "Rate limited by Privy. Wait 60 seconds before sending a new OTP."
                : "Check server logs for [privy-auth] error details.",
          recovery: {
            action: "resend",
            next: "Call this endpoint with { step: 'send', email } to get a fresh OTP.",
          },
        },
        { status: privyStatus && privyStatus >= 400 ? privyStatus : 500 },
      );
    }

    const userJwt = pickUserJwt(auth);
    let userId = auth.user?.id ? String(auth.user.id) : null;
    if (!userId && userJwt) {
      const verified = await verifyPrivyUserJwt(userJwt).catch(() => null);
      userId = verified?.user_id ? String(verified.user_id) : null;
    }

    if (!userJwt || !userId) {
      return Response.json(
        {
          ok: false,
          error: "OTP verified but could not resolve userJwt/userId.",
          hint: "This usually means the Privy app is misconfigured. Check PRIVY_APP_ID and PRIVY_APP_SECRET.",
        },
        { status: 500 },
      );
    }

    const autoSetup = parsed.data.autoSetup ?? true;
    const linkedEmail =
      extractEmailFromPrivyUser(auth.user) || (await getUserPrimaryEmail(userId)) || email;

    if (!autoSetup) {
      return Response.json({
        ok: true,
        step: "verify",
        isNewUser: Boolean(auth.is_new_user),
        email: linkedEmail,
        userId,
        userJwt,
        refreshToken: auth.refresh_token ?? null,
        identityToken: auth.identity_token ?? null,
        nextStep: "setup",
        next: "Call this endpoint with { step: 'setup', userJwt, acceptTerms, ... }.",
      });
    }

    if (parsed.data.acceptTerms !== true) {
      return Response.json(
        {
          ok: false,
          step: "verify",
          error: "acceptTerms must be true when autoSetup=true.",
          needs: {
            acceptTerms: true,
            suggestedStep: "setup",
          },
          userId,
          userJwt,
        },
        { status: 400 },
      );
    }

    let setup;
    try {
      setup = await runSetup({
        userJwt,
        createWallet: parsed.data.createWallet,
        chainType: parsed.data.chainType,
        policyId: parsed.data.policyId,
        acceptTerms: true,
        access: parsed.data.access,
        keyName: parsed.data.keyName,
        enableLlm: parsed.data.enableLlm,
      });
    } catch (setupError: any) {
      console.error("[onboard/verify] runSetup failed after OTP success:", setupError?.message);

      return Response.json(
        {
          ok: false,
          step: "verify",
          error: `OTP verified but setup failed: ${setupError?.message || "Unknown error."}`,
          userId,
          userJwt,
          refreshToken: auth.refresh_token ?? null,
          recovery: {
            action: "retry-setup",
            next: "Call this endpoint with { step: 'setup', userJwt, acceptTerms: true, ... }.",
          },
        },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      step: "verify",
      isNewUser: Boolean(auth.is_new_user),
      userJwt,
      refreshToken: auth.refresh_token ?? null,
      identityToken: auth.identity_token ?? null,
      ...setup,
      nextStep: "ready",
      next: "Use userJwt + wallet.id with /api/agent/privy/agentic/send-transaction.",
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to process OTP onboarding.",
      },
      { status: 500 },
    );
  }
}