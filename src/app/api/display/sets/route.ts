import { NextResponse } from "next/server";
import { authenticateDevice } from "@/db/devices";
import { listScrambleSets } from "@/db/scramble-sets";

/**
 * The catalogue a device caches ahead of time. Deliberately no keys here -- the device
 * downloads every set as ciphertext so a bad venue network cannot stop a scramble
 * appearing, but it can only open the one it is later sent a key for.
 */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const sets = await listScrambleSets(device.competitionId);
  return NextResponse.json({
    sets: sets.map((set) => ({
      id: set.id,
      label: set.label,
      eventName: set.eventName,
      roundNumber: set.roundNumber,
      setLetter: set.setLetter,
      bytes: set.bytes,
    })),
  });
}
