import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/node";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReplaceRequest = {
  walletId: string;
  userJwt: string;
  caip2: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    nonce: string;
  };
};

function getPrivyClient() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const authorizationPrivateKey = process.env.PRIVY_APP_AUTHORIZATION_PRIVATE_KEY;

  if (!appId || !appSecret || !authorizationPrivateKey) {
    throw new Error("Privy server auth environment variables are missing.");
  }

  return new PrivyClient({
    appId,
    appSecret,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReplaceRequest;
    if (!body?.walletId || !body?.userJwt || !body?.caip2 || !body?.transaction) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const privy = getPrivyClient();

    const { hash } = await privy
      .wallets()
      .ethereum()
      .sendTransaction(body.walletId, {
        caip2: body.caip2,
        params: {
          transaction: {
            to: body.transaction.to,
            data: body.transaction.data,
            value: body.transaction.value,
            nonce: body.transaction.nonce,
          },
        },
        authorization_context: {
          user_jwts: [body.userJwt],
        },
      });

    return NextResponse.json({ ok: true, hash });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to replace pending transaction.",
        name: error?.name,
        code: error?.code,
      },
      { status: 500 },
    );
  }
}
