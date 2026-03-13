import { z } from "zod";
import { sendPrivyEmailOtp } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  email: z.string().email(),
  captchaToken: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { email, captchaToken? }." },
        { status: 400 },
      );
    }

    const email = parsed.data.email.toLowerCase();

    // ▶ FIX: Capture the full init response instead of discarding it.
    //   If Privy returns a session_token or challenge_id, surface it.
    const initResult = await sendPrivyEmailOtp(email, parsed.data.captchaToken);

    return Response.json({
      ok: true,
      email,
      // Forward any session/challenge token Privy may have returned
      ...(initResult.session_token ? { sessionToken: initResult.session_token } : {}),
      ...(initResult.challenge_id ? { challengeId: initResult.challenge_id } : {}),
      next: "Ask user for OTP code from email, then call /api/agent/privy/otp/verify.",
    });
  } catch (error: any) {
    // ▶ FIX: Surface Privy-specific error details for agent debugging
    const privyStatus = error?.privyStatus;
    const privyPayload = error?.privyPayload;

    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to send email OTP.",
        ...(privyStatus ? { privyStatus } : {}),
        ...(privyPayload ? { privyDetail: privyPayload } : {}),
      },
      { status: privyStatus && privyStatus >= 400 ? privyStatus : 500 },
    );
  }
}