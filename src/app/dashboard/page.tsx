import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import DashboardClient from "./dashboard-client";

function readableRank(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function Dashboard() {
  const session = await readSession();
  if (!session) redirect("/");

  return (
    <main className="page stack" style={{ gap: "2rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="stack" style={{ gap: "0.5rem" }}>
          <h1>{session.name}</h1>
          <div>
            <span className="tag">{readableRank(session.delegateStatus)}</span>{" "}
            {session.wcaId ? <span className="tag mono">{session.wcaId}</span> : null}
          </div>
        </div>
        <div className="row">
          {/* Signed in, "/" redirects here, so without this a logged-in tablet is stranded. */}
          <a className="tag" href="/display">
            Display
          </a>
          <a className="tag" href="/settings">
            Settings
          </a>
        </div>
      </div>

      <DashboardClient wcaUserId={session.wcaUserId} />
    </main>
  );
}
