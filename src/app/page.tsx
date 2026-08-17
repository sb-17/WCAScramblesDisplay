import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";

const ERRORS: Record<string, string> = {
  "not-delegate":
    "That WCA account is not registered as a Delegate, so it cannot use this app.",
  denied: "Sign-in was cancelled.",
  state: "Sign-in could not be verified. Please try again.",
  wca: "Could not reach the WCA. Please try again in a moment.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await readSession()) redirect("/dashboard");

  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.wca) : null;

  return (
    <main className="page stack" style={{ gap: "2rem" }}>
      <div className="stack" style={{ gap: "0.5rem" }}>
        <h1>WCA Scrambles Display</h1>
        <p className="muted">
          Push scramble sets to the scrambling-area display, without typing a passcode.
        </p>
      </div>

      {message ? (
        <div className="notice">
          <p>{message}</p>
        </div>
      ) : null}

      <a className="button button--primary" href="/api/auth/login">
        Sign in with WCA
      </a>

      <p className="muted" style={{ fontSize: "0.875rem" }}>
        Delegates only. Scrambles are encrypted in your browser before upload.
      </p>
    </main>
  );
}
