import { PrivyClient, verifyAccessToken } from "@privy-io/node";

export type AgentAccessMode = "read_only" | "read_write";

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
  const authorizationPrivateKey = process.env.PRIVY_APP_AUTHORIZATION_PRIVATE_KEY;

  if (!appId || !appSecret) {
    throw new Error("Missing Privy env vars. Required: PRIVY_APP_ID, PRIVY_APP_SECRET.");
  }

  return { appId, appSecret, authorizationPrivateKey };
}

export function getPrivyAuthConfig() {
  const appId = process.env.PRIVY_APP_ID;
  if (!appId) {
    throw new Error("Missing PRIVY_APP_ID.");
  }

  const authBaseUrl = process.env.PRIVY_AUTH_BASE_URL || "https://auth.privy.io";
  const clientHeader = process.env.PRIVY_CLIENT_HEADER || undefined;
  const appOrigin = normalizeUrlOrigin(
    process.env.PRIVY_AUTH_ORIGIN || process.env.NEXT_PUBLIC_URL || undefined,
  );

  return { appId, clientHeader, authBaseUrl, appOrigin };
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

// ─── Enhanced auth route with full response logging ───────────────────────────
async function postPrivyAuthRoute<TResponse>(path: string, body: Record<string, unknown>) {
  const { appId, clientHeader, authBaseUrl, appOrigin } = getPrivyAuthConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "privy-app-id": appId,
  };

  if (clientHeader) {
    headers["privy-client"] = clientHeader;
  }
  if (appOrigin) {
    headers.Origin = appOrigin;
    headers.Referer = `${appOrigin}/`;
  }

  const url = `${authBaseUrl.replace(/\/+$/, "")}${path}`;

  console.log(`[privy-auth] POST ${path}`, {
    url,
    bodyKeys: Object.keys(body),
    hasOrigin: Boolean(appOrigin),
    hasClientHeader: Boolean(clientHeader),
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`[privy-auth] ${path} FAILED:`, {
      status: response.status,
      statusText: response.statusText,
      payload: JSON.stringify(payload),
      responseHeaders: {
        "x-request-id": response.headers.get("x-request-id"),
        "cf-ray": response.headers.get("cf-ray"),
        "retry-after": response.headers.get("retry-after"),
      },
    });

    const message =
      (payload && typeof payload.error === "string" && payload.error) ||
      (payload && typeof payload.message === "string" && payload.message) ||
      `Privy auth request failed (${response.status}).`;

    const err = new Error(message) as Error & {
      privyStatus?: number;
      privyPayload?: unknown;
    };
    err.privyStatus = response.status;
    err.privyPayload = payload;
    throw err;
  }

  console.log(`[privy-auth] ${path} OK:`, {
    responseKeys: Object.keys(payload),
  });

  return payload as TResponse;
}

// ─── OTP init: capture + return the full response ─────────────────────────────
export async function sendPrivyEmailOtp(email: string, token?: string) {
  await postPrivyAuthRoute("/api/v1/passwordless/init", {
    email: email.toLowerCase(),
    ...(token ? { token } : {}),
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
  const { appId } = getPrivyServerConfig();
  const verificationKey = process.env.PRIVY_VERIFICATION_KEY;
  if (!verificationKey) {
    throw new Error("Missing Privy env vars. Required: PRIVY_VERIFICATION_KEY.");
  }
  const verified = await verifyAccessToken({
    access_token: userJwt,
    app_id: appId,
    verification_key: verificationKey,
  });
  return verified;
}

// ─── Wallet session auth: works with both old and new @privy-io/node ──────────
//
// New SDK v0.10+ (@privy-io/node):
//   privy.walletsApi.generateUserSigner({ userJwt })
//   → returns { authorizationKey }
//   then privy.updateAuthorizationKey(authorizationKey)
//
// Old SDK (@privy-io/server-auth style / older @privy-io/node):
//   privy.wallets().authenticateWithJwt({ user_jwt })
//   → returns { authorization_key, encrypted_authorization_key, expires_at }
//
// Fallback: direct REST call to POST /v1/wallets/authenticate
// ──────────────────────────────────────────────────────────────────────────────

export type WalletSessionResult = {
  authorizationKey?: string;
  encryptedAuthorizationKey?: any;
  expiresAt?: number;
};

export async function authenticateWalletSession(
  privy: PrivyClient,
  userJwt: string,
): Promise<WalletSessionResult> {
  const p = privy as any;

  // ── New SDK: privy.walletsApi.generateUserSigner ──
  if (typeof p.walletsApi?.generateUserSigner === "function") {
    console.log("[wallet-session] Using new SDK: walletsApi.generateUserSigner");
    const result = await p.walletsApi.generateUserSigner({ userJwt });
    const authorizationKey =
      typeof result === "string"
        ? result
        : result?.authorizationKey ?? result?.authorization_key ?? undefined;

    if (authorizationKey && typeof p.updateAuthorizationKey === "function") {
      await p.updateAuthorizationKey(authorizationKey);
    }

    return {
      authorizationKey,
      expiresAt: result?.expires_at ?? result?.expiresAt ?? undefined,
    };
  }

  // ── Old SDK: privy.wallets().authenticateWithJwt ──
  if (typeof p.wallets === "function") {
    const walletsService = p.wallets();
    if (typeof walletsService?.authenticateWithJwt === "function") {
      console.log("[wallet-session] Using old SDK: wallets().authenticateWithJwt");
      const session = await walletsService.authenticateWithJwt({ user_jwt: userJwt });
      return {
        authorizationKey:
          "authorization_key" in session ? session.authorization_key : undefined,
        encryptedAuthorizationKey:
          "encrypted_authorization_key" in session
            ? session.encrypted_authorization_key
            : undefined,
        expiresAt: session.expires_at,
      };
    }
  }

  // ── Fallback: direct REST call ──
  console.log("[wallet-session] SDK method not found, calling REST API directly");
  const { appId, appSecret } = getPrivyServerConfig();
  const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString("base64");

  const response = await fetch("https://api.privy.io/v1/wallets/authenticate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`,
      "privy-app-id": appId,
    },
    body: JSON.stringify({ user_jwt: userJwt }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[wallet-session] REST fallback failed:", { status: response.status, payload });
    throw new Error(
      payload?.error || payload?.message || `Wallet session auth failed (${response.status})`,
    );
  }

  return {
    authorizationKey: payload.authorization_key,
    encryptedAuthorizationKey: payload.encrypted_authorization_key,
    expiresAt: payload.expires_at,
  };
}

// ─── Wallet CRUD helpers: work with both old and new SDK ──────────────────────

export async function findFirstWalletForUser(params: {
  userId: string;
  chainType: "ethereum" | "solana";
}) {
  const privy = getPrivyClient();
  const p = privy as any;

  // New SDK: privy.wallets.list(...) — wallets is an object, not a function
  if (p.wallets && typeof p.wallets === "object" && typeof p.wallets.list === "function") {
    for await (const wallet of p.wallets.list({
      user_id: params.userId,
      chain_type: params.chainType,
    })) {
      return wallet;
    }
    return null;
  }

  // Old SDK: privy.wallets().list(...)
  if (typeof p.wallets === "function") {
    for await (const wallet of p.wallets().list({
      user_id: params.userId,
      chain_type: params.chainType,
    })) {
      return wallet;
    }
    return null;
  }

  throw new Error("Cannot find wallets.list method on Privy client. Check @privy-io/node version.");
}

export async function createWalletForUser(params: {
  chainType: "ethereum" | "solana";
  userId: string;
  policyIds?: string[];
}) {
  const privy = getPrivyClient();
  const p = privy as any;
  const body = {
    chain_type: params.chainType,
    owner: { user_id: params.userId },
    policy_ids: params.policyIds,
  };

  if (p.wallets && typeof p.wallets === "object" && typeof p.wallets.create === "function") {
    return p.wallets.create(body);
  }
  if (typeof p.wallets === "function") {
    return p.wallets().create(body);
  }
  throw new Error("Cannot find wallets.create method on Privy client.");
}

export async function updateWalletPolicy(params: {
  walletId: string;
  policyIds: string[];
  userJwt?: string;
}) {
  const privy = getPrivyClient();
  const p = privy as any;
  const body = {
    policy_ids: params.policyIds,
    ...(params.userJwt ? { authorization_context: { user_jwts: [params.userJwt] } } : {}),
  };

  if (p.wallets && typeof p.wallets === "object" && typeof p.wallets.update === "function") {
    return p.wallets.update(params.walletId, body);
  }
  if (typeof p.wallets === "function") {
    return p.wallets().update(params.walletId, body);
  }
  throw new Error("Cannot find wallets.update method on Privy client.");
}

export function extractEmailFromPrivyUser(user: any) {
  const linkedAccounts = Array.isArray(user?.linked_accounts) ? (user.linked_accounts as any[]) : [];
  const email = linkedAccounts.find(
    (account) => account?.type === "email" && typeof account?.address === "string",
  );
  return email?.address ? String(email.address).toLowerCase() : null;
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

export function buildApiError(error: any, fallbackMessage: string) {
  const status =
    typeof error?.privyStatus === "number" && error.privyStatus >= 400
      ? error.privyStatus
      : 500;

  return {
    status,
    body: {
      ok: false,
      error: error?.message || fallbackMessage,
      ...(error?.privyStatus ? { privyStatus: error.privyStatus } : {}),
      ...(error?.privyPayload ? { privyDetail: error.privyPayload } : {}),
    },
  };
}
