import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";

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
      <div className="stack" style={{ gap: "0.5rem" }}>
        <h1>{session.name}</h1>
        <div>
          <span className="tag">{readableRank(session.delegateStatus)}</span>{" "}
          {session.wcaId ? <span className="tag mono">{session.wcaId}</span> : null}
        </div>
      </div>

      <div className="card stack">
        <h2>Competitions</h2>
        <p className="muted">
          Nothing here yet. Uploading an archive and pairing display devices come next.
        </p>
      </div>

      <form action="/api/auth/logout" method="post">
        <button className="button" type="submit">
          Sign out
        </button>
      </form>
    </main>
  );
}
