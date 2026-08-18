import { NextResponse } from "next/server";
import { authenticateDevice, recordCachedSets } from "@/db/devices";

/**
 * A display reporting which sets it holds. Sent after every caching pass, so the Delegate's
 * phone knows what this screen can actually open and will not offer the rest.
 */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { setIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  if (!Array.isArray(body.setIds) || body.setIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "invalid-set-ids" }, { status: 400 });
  }

  await recordCachedSets(device.deviceId, body.setIds as string[]);
  return NextResponse.json({ ok: true });
}
