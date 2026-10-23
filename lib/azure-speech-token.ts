// One short-lived Azure Speech token, fetched from /api/speech-token and shared by speech
// recognition and speech synthesis, so the subscription key never reaches the browser.

export type AzureCredentials = { token: string; region: string; fetchedAt: number };

// Azure tokens last 10 minutes; reuse one for 9 so nothing starts on an expired token.
const TOKEN_REUSE_MS = 9 * 60_000;

// After a failed token request, go straight to the browser engines for a while instead of
// asking the server again on every tap: long when Azure is simply not configured, short
// when the failure may be a passing one.
const NOT_CONFIGURED_RETRY_MS = 10 * 60_000;
const TRANSIENT_FAILURE_RETRY_MS = 60_000;

let cachedCredentials: AzureCredentials | null = null;
let azureRetryNotBefore = 0;

export async function fetchAzureCredentials(): Promise<AzureCredentials | null> {
  if (cachedCredentials && Date.now() - cachedCredentials.fetchedAt < TOKEN_REUSE_MS) {
    return cachedCredentials;
  }
  if (Date.now() < azureRetryNotBefore) return null;

  try {
    const response = await fetch("/api/speech-token", { method: "POST", cache: "no-store" });
    if (!response.ok) {
      azureRetryNotBefore =
        Date.now() + (response.status === 503 ? NOT_CONFIGURED_RETRY_MS : TRANSIENT_FAILURE_RETRY_MS);
      return null;
    }
    const body = (await response.json()) as { token?: string; region?: string };
    if (!body.token || !body.region) return null;
    cachedCredentials = { token: body.token, region: body.region, fetchedAt: Date.now() };
    return cachedCredentials;
  } catch {
    azureRetryNotBefore = Date.now() + TRANSIENT_FAILURE_RETRY_MS;
    return null;
  }
}

export function discardAzureCredentials() {
  cachedCredentials = null;
}
