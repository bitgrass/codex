import { z } from "zod";
import {
  authenticateWalletSession,
  createWalletForUser,
  findFirstWalletForUser,
  getPrivyClient,
  getUserPrimaryEmail,
  type AgentAccessMode,
  updateWalletPolicy,
  upsertAgentPreferences,
  verifyPrivyUserJwt,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  userJwt: z.string().min(1),
  acceptTerms: z.boolean(),
  access: z.enum(["read_only", "read_write"]).optional(),
  keyName: z.string().min(1).max(64).optional(),
  enableLlm: z.boolean().optional(),
  chainType: z.enum(["ethereum", "solana"]).optional(),
  policyId: z.string().min(1).optional(),
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
            "Invalid body. Expected { userJwt, acceptTerms, access?, keyName?, enableLlm?, chainType?, policyId? }.",
        },
        { status: 400 },
      );
    }

    if (!parsed.data.acceptTerms) {
      return Response.json(
        {
          ok: false,
          error: "acceptTerms must be true to continue onboarding.",
        },
        { status: 400 },
      );
    }

    const access: AgentAccessMode = parsed.data.access ?? "read_only";
    const chainType = parsed.data.chainType ?? "ethereum";
    const userJwt = parsed.data.userJwt;

    const verified = await verifyPrivyUserJwt(userJwt);
    const userId = verified.user_id;
    const email = await getUserPrimaryEmail(userId);
    if (!email) {
      return Response.json(
        {
          ok: false,
          error: "Email OTP login is required. This user has no email account linked in Privy.",
        },
        { status: 403 },
      );
    }

    let wallet =
      (await findFirstWalletForUser({
        userId,
        chainType,
      })) || null;

    if (!wallet) {
      wallet = await createWalletForUser({
        chainType,
        userId,
        policyIds: parsed.data.policyId ? [parsed.data.policyId] : undefined,
      });
    } else if (parsed.data.policyId && !wallet.policy_ids?.includes(parsed.data.policyId)) {
      wallet = await updateWalletPolicy({
        walletId: wallet.id,
        policyIds: [parsed.data.policyId],
        userJwt,
      });
    }

    const session = await authenticateWalletSession(getPrivyClient(), userJwt);

    const preferences = await upsertAgentPreferences({
      userId,
      access,
      keyName: parsed.data.keyName,
      enableLlm: parsed.data.enableLlm,
      acceptTerms: parsed.data.acceptTerms,
    });

    return Response.json({
      ok: true,
      userId,
      email,
      chainType,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        chainType: wallet.chain_type,
        policyIds: wallet.policy_ids,
      },
      session: {
        expiresAt: session.expiresAt,
        authorizationKey: session.authorizationKey,
        encryptedAuthorizationKey: session.encryptedAuthorizationKey,
      },
      preferences,
      capabilities: {
        readOnly: access === "read_only",
        readWrite: access === "read_write",
        llmGatewayRequested: Boolean(parsed.data.enableLlm),
      },
    });
  } catch (error: any) {
    const privyStatus = error?.privyStatus;
    const privyPayload = error?.privyPayload;
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to complete Privy agentic setup.",
        ...(privyStatus ? { privyStatus } : {}),
        ...(privyPayload ? { privyDetail: privyPayload } : {}),
      },
      { status: privyStatus && privyStatus >= 400 ? privyStatus : 500 },
    );
  }
}
