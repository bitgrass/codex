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
    await sendPrivyEmailOtp(email, parsed.data.captchaToken);

    return Response.json({
      ok: true,
      email,
      next: "Ask user for OTP code from email, then call /api/agent/privy/otp/verify.",
    });
  } catch (error: any) {
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
