/**
 * Identifies the running build. A commit is more useful here than a version number nobody
 * maintains: it says exactly which code a screen is running, which is the question that
 * matters when a tablet behaves differently from the one next to it.
 *
 * Vercel sets this at build time. Running locally there is no commit to report.
 */
export function appVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : "dev";
}
