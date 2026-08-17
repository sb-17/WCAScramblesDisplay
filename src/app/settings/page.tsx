import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import SettingsClient from "./settings-client";

export default async function Settings() {
  const session = await readSession();
  if (!session) redirect("/");

  return (
    <main className="page stack" style={{ gap: "1.5rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Settings</h1>
        <a className="tag" href="/dashboard">
          Back
        </a>
      </div>

      <SettingsClient wcaUserId={session.wcaUserId} />

      <form action="/api/auth/logout" method="post">
        <button className="button button--danger" type="submit">
          Sign out
        </button>
      </form>
    </main>
  );
}
