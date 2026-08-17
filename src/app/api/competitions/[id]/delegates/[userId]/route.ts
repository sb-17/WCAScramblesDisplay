import { NextResponse } from "next/server";
import { isOwnerOf, revokeAccess } from "@/db/access";
import { readSession } from "@/lib/session";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, userId } = await context.params;
  if (!(await isOwnerOf(id, session.wcaUserId))) {
    return NextResponse.json({ error: "not-owner" }, { status: 403 });
  }

  const removed = await revokeAccess(id, Number(userId));
  // Also covers trying to remove the creator, who cannot be removed from their own
  // competition without leaving it with no owner.
  if (!removed) return NextResponse.json({ error: "not-removable" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
