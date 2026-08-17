import { NextResponse } from "next/server";
import { accessTo } from "@/db/competitions";
import { deleteDevice, extendSession } from "@/db/devices";
import { readSession } from "@/lib/session";

const MAX_SESSION_HOURS = 72;

async function authorise(competitionId: string) {
  const session = await readSession();
  if (!session) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };

  const access = await accessTo(competitionId, session.wcaUserId);
  if (!access) return { error: NextResponse.json({ error: "not-found" }, { status: 404 }) };
  if (!access.canPush) {
    return { error: NextResponse.json({ error: "view-only" }, { status: 403 }) };
  }
  return { error: null };
}

/** Revoking a device is deleting it: the session, its key and its code all go at once. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; deviceId: string }> },
) {
  const { id, deviceId } = await context.params;
  const { error } = await authorise(id);
  if (error) return error;

  const removed = await deleteDevice(id, deviceId);
  if (!removed) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Extends a session that is about to expire, so a round is never cut short. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; deviceId: string }> },
) {
  const { id, deviceId } = await context.params;
  const { error } = await authorise(id);
  if (error) return error;

  let body: { sessionHours?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const hours = Number(body.sessionHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_SESSION_HOURS) {
    return NextResponse.json({ error: "invalid-hours" }, { status: 400 });
  }

  const extended = await extendSession(id, deviceId, hours);
  if (!extended) return NextResponse.json({ error: "not-paired" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
