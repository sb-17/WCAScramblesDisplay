import { NextResponse } from "next/server";
import { accessTo } from "@/db/competitions";
import { createDevice, listDevices } from "@/db/devices";
import { readSession } from "@/lib/session";

const MAX_SESSION_HOURS = 72;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  if (!(await accessTo(id, session.wcaUserId))) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  return NextResponse.json({ devices: await listDevices(id) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  const access = await accessTo(id, session.wcaUserId);
  if (!access) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!access.canPush) return NextResponse.json({ error: "view-only" }, { status: 403 });

  let body: { name?: string; sessionHours?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (name.length === 0 || name.length > 60) {
    return NextResponse.json({ error: "invalid-name" }, { status: 400 });
  }

  const hours = Number(body.sessionHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_SESSION_HOURS) {
    return NextResponse.json({ error: "invalid-hours" }, { status: 400 });
  }

  const device = await createDevice({
    competitionId: id,
    name,
    sessionHours: hours,
    createdBy: session.wcaUserId,
  });

  return NextResponse.json({ device });
}
