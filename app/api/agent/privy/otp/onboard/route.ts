import { z } from "zod";
import {
  extractEmailFromPrivyUser,
  findFirstWalletForUser,
  getPrivyClient,
  getUserPrimaryEmail,
  sendPrivyEmailOtp,
  type AgentAccessMode,
  type PrivyPasswordlessAuthenticateResponse,
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
  const createWallet = params.createWallet ?? true;
  const access: AgentAccessMode = params.access ?? "read_only";
  const privy = getPrivyClient();

  const email = await getUserPrimaryEmail(userId);
  if (!email) {
    throw new Error("Email OTP login is required. This user has no email account linked in Privy.");
  }

  let wallet = null as Awaited<ReturnType<typeof findFirstWalletForUser>>;
  let walletCreated = false;

  if (createWallet) {
    wallet = await findFirstWalletForUser({
      userId,
      chainType,
    });

    if (!wallet) {
      wallet = await privy.wallets().create({
        chain_type: chainType,
        owner: { user_id: userId },
        policy_ids: params.policyId ? [params.policyId] : undefined,
      });
      walletCreated = true;
    } else if (params.policyId && !wallet.policy_ids?.includes(params.policyId)) {
      wallet = await privy.wallets().update(wallet.id, {
        policy_ids: [params.policyId],
        authorization_context: {
          user_jwts: [params.userJwt],
        },
      });
    }
  }

  const session = await privy.wallets().authenticateWithJwt({
    user_jwt: params.userJwt,
  });

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
      expiresAt: session.expires_at,
      authorizationKey:
        "authorization_key" in session ? session.authorization_key : undefined,
      encryptedAuthorizationKey:
        "encrypted_authorization_key" in session
          ? session.encrypted_authorization_key
          : undefined,
    },
    preferences,
  };
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
            "Invalid body. Expected { step: 'send' | 'verify' | 'setup', ... }.",
        },
        { status: 400 },
      );
    }

    if (parsed.data.step === "send") {
      const email = parsed.data.email.toLowerCase();
      await sendPrivyEmailOtp(email, parsed.data.captchaToken);
      return Response.json({
        ok: true,
        step: "send",
        email,
        nextStep: "verify",
      next: "Ask user for OTP, then call this endpoint with { step: 'verify', email, code, ... }.",
      });
    }

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

    const email = parsed.data.email.toLowerCase();
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

    if (!userJwt || !userId) {
      return Response.json(
        {
          ok: false,
          error: "OTP verified but could not resolve userJwt/userId.",
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
        next:
          "Call this endpoint with { step: 'setup', userJwt, acceptTerms, ... }. Persist session.authorizationKey after setup for future transactions.",
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

    const setup = await runSetup({
      userJwt,
      createWallet: parsed.data.createWallet,
      chainType: parsed.data.chainType,
      policyId: parsed.data.policyId,
      acceptTerms: true,
      access: parsed.data.access,
      keyName: parsed.data.keyName,
      enableLlm: parsed.data.enableLlm,
    });

    return Response.json({
      ok: true,
      step: "verify",
      isNewUser: Boolean(auth.is_new_user),
      userJwt,
      refreshToken: auth.refresh_token ?? null,
      identityToken: auth.identity_token ?? null,
      ...setup,
      nextStep: "ready",
      next:
        "Persist session.authorizationKey and use authorizationKey + wallet.id with /api/agent/privy/agentic/send-transaction.",
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
