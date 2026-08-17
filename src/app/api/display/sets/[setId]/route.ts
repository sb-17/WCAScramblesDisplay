import { NextResponse } from "next/server";
import { authenticateDevice } from "@/db/devices";
import { getCiphertext } from "@/db/scramble-sets";
import { toBase64 } from "@/lib/bytes";

export async function GET(request: Request, context: { params: Promise<{ setId: string }> }) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { setId } = await context.params;
  const ciphertext = await getCiphertext(device.competitionId, setId);
  if (!ciphertext) return NextResponse.json({ error: "not-found" }, { status: 404 });

  return NextResponse.json({ ciphertext: toBase64(ciphertext) });
}
