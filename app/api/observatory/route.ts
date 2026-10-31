import { clientAddress, createRateLimiter } from "@/lib/rate-limit";
import { readObservatoryState } from "@/lib/observatory-store";

const isOverReadLimit = createRateLimiter(60_000, 60);
const CACHE_5_MINUTES = "public, s-maxage=300, stale-while-revalidate=60";

export async function GET(request: Request) {
  if (isOverReadLimit(clientAddress(request), Date.now())) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  try {
    const { items, last_run } = await readObservatoryState();
    return Response.json({ items, last_run }, { headers: { "Cache-Control": CACHE_5_MINUTES } });
  } catch (error) {
    console.error(`observatory read failed: ${error instanceof Error ? error.name : "unknown"}`);
    return Response.json({ error: "storage_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
