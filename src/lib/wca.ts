const WCA = "https://www.worldcubeassociation.org";

/** Short-lived CSRF cookie holding the OAuth `state` across the redirect. */
export const STATE_COOKIE = "wcasd_oauth_state";

/** Only the fields we actually rely on; /api/v0/me returns a great deal more. */
export interface WcaUser {
  id: number;
  name: string;
  wca_id: string | null;
  /**
   * Live values are senior_delegate | delegate | junior_delegate | trainee_delegate,
   * and null for everyone else. See isDelegate() for why we do not match on them.
   */
  delegate_status: string | null;
}

/**
 * Deliberately a null check rather than an allowlist of the four known ranks.
 * The WCA has renamed ranks before -- candidate_delegate became junior_delegate --
 * and an allowlist would silently lock out real Delegates on a competition morning.
 * Failing open toward "is a Delegate" is the correct direction for this app.
 */
export function isDelegate(user: WcaUser): boolean {
  return user.delegate_status !== null && user.delegate_status !== "";
}

/**
 * The redirect URI must match what is registered on the WCA exactly, and is derived
 * from the incoming request so localhost and the deployed origin both work without
 * extra configuration. Vercel terminates TLS upstream, so the forwarded headers are
 * the authoritative source of the external origin.
 */
export function callbackUrl(request: Request): string {
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;
  return `${origin}/api/auth/callback`;
}

export interface WcaCompetition {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  delegates: { id: number; name: string; wca_id: string | null }[];
}

/** The competition's own Delegate list is the authority on who may set it up. */
export function delegatesInclude(competition: WcaCompetition, wcaUserId: number): boolean {
  return competition.delegates.some((delegate) => delegate.id === wcaUserId);
}

export async function searchCompetitions(query: string): Promise<WcaCompetition[]> {
  const params = new URLSearchParams({ q: query, per_page: "25" });
  const response = await fetch(`${WCA}/api/v0/competitions?${params}`);
  if (!response.ok) throw new Error(`WCA competition search failed (${response.status})`);
  return (await response.json()) as WcaCompetition[];
}

export async function fetchCompetition(id: string): Promise<WcaCompetition | null> {
  const response = await fetch(`${WCA}/api/v0/competitions/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`WCA competition fetch failed (${response.status})`);
  return (await response.json()) as WcaCompetition;
}

function clientId(): string {
  const id = process.env.WCA_CLIENT_ID;
  if (!id) throw new Error("WCA_CLIENT_ID is not set");
  return id;
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "public",
    state,
  });
  return `${WCA}/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const secret = process.env.WCA_CLIENT_SECRET;
  if (!secret) throw new Error("WCA_CLIENT_SECRET is not set");

  const response = await fetch(`${WCA}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`WCA token exchange failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("WCA token response contained no access_token");
  return body.access_token;
}

export async function fetchMe(accessToken: string): Promise<WcaUser> {
  const response = await fetch(`${WCA}/api/v0/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`WCA /me failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as { me?: WcaUser };
  if (!body.me) throw new Error("WCA /me response contained no user");
  return body.me;
}
