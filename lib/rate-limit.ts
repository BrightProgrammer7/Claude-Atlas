// Best-effort sliding-window limit per server instance, keyed by client address. It slows down
// someone flooding a route; it is not a substitute for a shared store.
const MAX_TRACKED_CLIENTS = 5_000;

export function createRateLimiter(windowMs: number, maxRequestsPerWindow: number) {
  const timestampsByClient = new Map<string, number[]>();

  return function isOverLimit(client: string, now: number): boolean {
    const recent = (timestampsByClient.get(client) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maxRequestsPerWindow) {
      timestampsByClient.set(client, recent);
      return true;
    }
    recent.push(now);
    timestampsByClient.set(client, recent);

    if (timestampsByClient.size > MAX_TRACKED_CLIENTS) {
      for (const [trackedClient, timestamps] of timestampsByClient) {
        if (timestamps.every((timestamp) => now - timestamp >= windowMs)) {
          timestampsByClient.delete(trackedClient);
        }
      }
    }
    return false;
  };
}

export function clientAddress(request: Request): string {
  // Vercel overwrites these headers, so the first entry is the real client address.
  const forwardedFor =
    request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
