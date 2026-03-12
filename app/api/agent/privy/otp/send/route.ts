import { z } from "zod";
import {
  buildApiError,
  getOtpRetryAfter,
  markOtpSent,
  sendPrivyEmailOtp,
} from "../../_lib";

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
    const retryAfterSeconds = getOtpRetryAfter(email);
    if (retryAfterSeconds > 0) {
      return Response.json(
        {
          ok: false,
          error: "OTP was requested too recently. Wait before requesting another code.",
          retryAfterSeconds,
        },
        { status: 429 },
      );
    }

    const init = await sendPrivyEmailOtp(email, parsed.data.captchaToken);
    markOtpSent(email);
    const otpToken =
      typeof init?.token === "string" && init.token.length > 0 ? init.token : null;

    return Response.json({
      ok: true,
      email,
      otpToken,
      next:
        "Ask user for OTP code from email, then call /api/agent/privy/otp/verify with { email, code, token: otpToken }.",
      notes:
        otpToken === null
          ? "Privy did not return an OTP token for this init call. Verify may still succeed without token."
          : "Include otpToken in verify call for best compatibility.",
    });
  } catch (error: any) {
    const formatted = buildApiError(error, "Failed to send email OTP.");
    return Response.json(formatted.body, { status: formatted.status });
  }
}
