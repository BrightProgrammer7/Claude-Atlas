// Hands the browser a short-lived Azure Speech token so the subscription key itself never
// leaves the server. The token is valid for 10 minutes.
const REGION_PATTERN = /^[a-z0-9]{3,30}$/;
const UPSTREAM_TIMEOUT_MS = 5_000;

// Best-effort limit per server instance. It slows down someone draining the free-tier
// quota; it is not a substitute for a shared store.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS_PER_WINDOW = 10;
const RATE_LIMIT_MAX_TRACKED_CLIENTS = 5_000;
const requestTimestampsByClient = new Map<string, number[]>();

const NO_STORE = { "Cache-Control": "no-store" } as const;

function clientAddress(request: Request): string {
  // Vercel overwrites these headers, so the first entry is the real client address.
  const forwardedFor =
    request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function isOverRateLimit(client: string, now: number): boolean {
  const recent = (requestTimestampsByClient.get(client) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS_PER_WINDOW) {
    requestTimestampsByClient.set(client, recent);
    return true;
  }

  recent.push(now);
  requestTimestampsByClient.set(client, recent);

  if (requestTimestampsByClient.size > RATE_LIMIT_MAX_TRACKED_CLIENTS) {
    for (const [trackedClient, timestamps] of requestTimestampsByClient) {
      if (timestamps.every((timestamp) => now - timestamp >= RATE_LIMIT_WINDOW_MS)) {
        requestTimestampsByClient.delete(trackedClient);
      }
    }
  }
  return false;
}

export async function POST(request: Request) {
  if (isOverRateLimit(clientAddress(request), Date.now())) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }

  const speechKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!speechKey || !region || !REGION_PATTERN.test(region)) {
    return Response.json({ error: "speech_not_configured" }, { status: 503, headers: NO_STORE });
  }

  try {
    const upstream = await fetch(
      `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": speechKey },
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );

    if (!upstream.ok) {
      console.error(`Azure issueToken responded with status ${upstream.status}`);
      return Response.json({ error: "speech_token_unavailable" }, { status: 502, headers: NO_STORE });
    }

    return Response.json({ token: await upstream.text(), region }, { headers: NO_STORE });
  } catch (error) {
    console.error(`Azure issueToken request failed: ${error instanceof Error ? error.name : "unknown"}`);
    return Response.json({ error: "speech_token_unavailable" }, { status: 502, headers: NO_STORE });
  }
}
