import { PrivyClient, verifyAccessToken } from "@privy-io/node";

export type AgentAccessMode = "read_only" | "read_write";

const otpSendState = new Map<string, number>();

export class PrivyRouteError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "PrivyRouteError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

function normalizeUrlOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function getPrivyServerConfig() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const verificationKey = process.env.PRIVY_VERIFICATION_KEY;
  const authorizationPrivateKey = process.env.PRIVY_APP_AUTHORIZATION_PRIVATE_KEY;

  if (!appId || !appSecret || !verificationKey) {
    throw new Error(
      "Missing Privy env vars. Required: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_VERIFICATION_KEY.",
    );
  }

  return { appId, appSecret, verificationKey, authorizationPrivateKey };
}

export function getPrivyAuthConfig() {
  const appId = process.env.PRIVY_APP_ID;
  if (!appId) {
    throw new Error("Missing PRIVY_APP_ID.");
  }

  const authBaseUrl = process.env.PRIVY_AUTH_BASE_URL || "https://auth.privy.io";
  const appClientId = process.env.PRIVY_APP_CLIENT_ID || undefined;
  const appOrigin = normalizeUrlOrigin(
    process.env.PRIVY_AUTH_ORIGIN || process.env.NEXT_PUBLIC_URL || undefined,
  );

  return { appId, appClientId, authBaseUrl, appOrigin };
}

export function getPrivyClient() {
  const { appId, appSecret, authorizationPrivateKey } = getPrivyServerConfig();
  void authorizationPrivateKey;
  return new PrivyClient({
    appId,
    appSecret,
  });
}

type PasswordlessMode = "no-signup" | "login-or-sign-up";

async function postPrivyAuthRoute<TResponse>(path: string, body: Record<string, unknown>) {
  const { appId, appClientId, authBaseUrl, appOrigin } = getPrivyAuthConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "privy-app-id": appId,
    "privy-client": "bitgrass-agent-api/1.0",
  };

  if (appClientId) {
    headers["privy-client-id"] = appClientId;
  }
  if (appOrigin) {
    headers.Origin = appOrigin;
    headers.Referer = `${appOrigin}/`;
  }

  const response = await fetch(`${authBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds =
      retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
    const code =
      (payload && typeof payload.code === "string" && payload.code) ||
      (payload && typeof payload.error_code === "string" && payload.error_code) ||
      undefined;
    const message =
      (payload && typeof payload.error === "string" && payload.error) ||
      (payload && typeof payload.message === "string" && payload.message) ||
      `Privy auth request failed (${response.status}).`;
    throw new PrivyRouteError({
      message,
      status: response.status,
      code,
      details: payload,
      retryAfterSeconds,
    });
  }

  return payload as TResponse;
}

export async function sendPrivyEmailOtp(email: string, token?: string) {
  await postPrivyAuthRoute("/api/v1/passwordless/init", {
    email: email.toLowerCase(),
    token,
  });
}

export type PrivyPasswordlessAuthenticateResponse = {
  token?: string | null;
  privy_access_token?: string | null;
  refresh_token?: string | null;
  identity_token?: string;
  is_new_user?: boolean;
  user?: any;
};

export async function verifyPrivyEmailOtp(params: {
  email: string;
  code: string;
  mode?: PasswordlessMode;
}) {
  return postPrivyAuthRoute<PrivyPasswordlessAuthenticateResponse>(
    "/api/v1/passwordless/authenticate",
    {
      email: params.email.toLowerCase(),
      code: params.code.trim(),
      mode: params.mode ?? "login-or-sign-up",
    },
  );
}

export async function verifyPrivyUserJwt(userJwt: string) {
  const { appId, verificationKey } = getPrivyServerConfig();
  const verified = await verifyAccessToken({
    access_token: userJwt,
    app_id: appId,
    verification_key: verificationKey,
  });
  return verified;
}

export function getOtpCooldownSeconds() {
  const raw = process.env.PRIVY_OTP_COOLDOWN_SECONDS;
  if (!raw) return 60;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 60;
  }

  return Math.floor(parsed);
}

export function getOtpRetryAfter(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const lastSentAt = otpSendState.get(normalizedEmail);
  if (!lastSentAt) return 0;

  const cooldownMs = getOtpCooldownSeconds() * 1000;
  const retryAfterMs = lastSentAt + cooldownMs - Date.now();
  if (retryAfterMs <= 0) {
    otpSendState.delete(normalizedEmail);
    return 0;
  }

  return Math.ceil(retryAfterMs / 1000);
}

export function markOtpSent(email: string) {
  otpSendState.set(email.trim().toLowerCase(), Date.now());
}

export function buildApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof PrivyRouteError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: error.message,
        code: error.code ?? null,
        retryAfterSeconds: error.retryAfterSeconds ?? null,
        details: error.details ?? null,
      },
    };
  }

  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? ((error as { status: number }).status ?? 500)
      : 500;

  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
      ? ((error as { message: string }).message ?? fallbackMessage)
      : fallbackMessage;

  return {
    status,
    body: {
      ok: false,
      error: message,
    },
  };
}

export function extractEmailFromPrivyUser(user: any) {
  const linkedAccounts = Array.isArray(user?.linked_accounts) ? (user.linked_accounts as any[]) : [];
  const email = linkedAccounts.find(
    (account) => account?.type === "email" && typeof account?.address === "string",
  );
  return email?.address ? String(email.address).toLowerCase() : null;
}

export async function findFirstWalletForUser(params: {
  userId: string;
  chainType: "ethereum" | "solana";
}) {
  const privy = getPrivyClient();
  for await (const wallet of privy.wallets().list({
    user_id: params.userId,
    chain_type: params.chainType,
  })) {
    return wallet;
  }
  return null;
}

export async function upsertAgentPreferences(params: {
  userId: string;
  access: AgentAccessMode;
  keyName?: string;
  enableLlm?: boolean;
  acceptTerms: boolean;
}) {
  const privy = getPrivyClient();
  const user = await privy.users()._get(params.userId);
  const existingCustom =
    user && typeof (user as any).custom_metadata === "object" && (user as any).custom_metadata
      ? ((user as any).custom_metadata as Record<string, any>)
      : {};

  const updated = {
    ...existingCustom,
    bitgrass_agent: {
      ...(existingCustom.bitgrass_agent || {}),
      access: params.access,
      keyName: params.keyName || existingCustom.bitgrass_agent?.keyName || null,
      enableLlm: Boolean(params.enableLlm),
      acceptTerms: Boolean(params.acceptTerms),
      updatedAt: new Date().toISOString(),
    },
  };

  await privy.users().setCustomMetadata(params.userId, {
    custom_metadata: updated,
  });

  return updated.bitgrass_agent;
}

export async function getUserPrimaryEmail(userId: string) {
  const privy = getPrivyClient();
  const user = await privy.users()._get(userId);
  const linkedAccounts = Array.isArray((user as any)?.linked_accounts)
    ? ((user as any).linked_accounts as any[])
    : [];

  const emailAccount = linkedAccounts.find(
    (account) => account?.type === "email" && typeof account?.address === "string",
  );

  return emailAccount?.address ? String(emailAccount.address).toLowerCase() : null;
}
