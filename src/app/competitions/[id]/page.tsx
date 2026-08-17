import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import DisplayModeBanner from "../../display-mode-banner";
import CompetitionClient from "./competition-client";

export default async function CompetitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await readSession();
  if (!session) redirect("/");

  const { id } = await params;

  return (
    <main className="page stack" style={{ gap: "1.5rem" }}>
      <DisplayModeBanner />
      <CompetitionClient competitionId={id} wcaUserId={session.wcaUserId} />
    </main>
  );
}
