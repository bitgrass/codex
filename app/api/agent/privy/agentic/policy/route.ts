import { isAddress } from "ethers";
import { z } from "zod";
import { getPrivyClient, verifyPrivyUserJwt } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  userJwt: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  allowedContractAddresses: z.array(z.string().min(42).max(42)).min(1),
  maxValueWei: z.string().regex(/^\d+$/).optional(),
  chainId: z.number().int().positive().optional(),
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
            "Invalid body. Expected { userJwt, allowedContractAddresses[], name?, maxValueWei?, chainId? }.",
        },
        { status: 400 },
      );
    }

    const invalid = parsed.data.allowedContractAddresses.find(
      (address) => !isAddress(address),
    );
    if (invalid) {
      return Response.json(
        { ok: false, error: `Invalid address in allowlist: ${invalid}` },
        { status: 400 },
      );
    }

    const verified = await verifyPrivyUserJwt(parsed.data.userJwt);
    const userId = verified.user_id;
    const privy = getPrivyClient();

    const conditions: Array<{
      field: "to" | "value" | "chain_id";
      field_source: "ethereum_transaction";
      operator: "in" | "lte" | "eq";
      value: string | string[];
    }> = [
      {
        field: "to",
        field_source: "ethereum_transaction",
        operator: "in",
        value: parsed.data.allowedContractAddresses,
      },
    ];

    if (parsed.data.maxValueWei) {
      conditions.push({
        field: "value",
        field_source: "ethereum_transaction",
        operator: "lte",
        value: parsed.data.maxValueWei,
      });
    }

    if (parsed.data.chainId) {
      conditions.push({
        field: "chain_id",
        field_source: "ethereum_transaction",
        operator: "eq",
        value: String(parsed.data.chainId),
      });
    }

    const policy = await privy.policies().create({
      chain_type: "ethereum",
      name:
        parsed.data.name ||
        `bitgrass-agent-${new Date().toISOString().slice(0, 10)}`,
      version: "1.0",
      owner: { user_id: userId },
      rules: [
        {
          name: "allow-listed-transactions",
          action: "ALLOW",
          method: "eth_sendTransaction",
          conditions,
        },
      ],
    });

    return Response.json({
      ok: true,
      userId,
      policy: {
        id: policy.id,
        name: policy.name,
        chainType: policy.chain_type,
        version: policy.version,
        rules: policy.rules,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to create Privy policy.",
      },
      { status: 500 },
    );
  }
}

