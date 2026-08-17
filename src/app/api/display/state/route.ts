import { NextResponse } from "next/server";
import { acknowledgeState, authenticateDevice, readDeviceState } from "@/db/devices";

/**
 * Polled by the display every few seconds. Short polling rather than a held connection:
 * without LISTEN/NOTIFY a long poll would have to query the database on a timer anyway,
 * which is more traffic than simply asking, for the same latency.
 */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const state = await readDeviceState(device.deviceId);
  if (!state) return NextResponse.json({ error: "not-found" }, { status: 404 });

  return NextResponse.json({
    deviceName: device.deviceName,
    setId: state.setId,
    label: state.label,
    pushedAt: state.pushedAt,
    wrappedSetKey: state.wrappedSetKey ? Buffer.from(state.wrappedSetKey).toString("base64") : null,
  });
}

/** The device reporting what it is actually showing, which is what the phone displays. */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { setId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  await acknowledgeState(device.deviceId, body.setId ?? null);
  return NextResponse.json({ ok: true });
}
