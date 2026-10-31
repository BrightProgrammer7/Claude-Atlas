import { timingSafeEqual } from "node:crypto";
import { isObservatoryStorageConfigured, readObservatoryState, writeObservatoryState } from "@/lib/observatory-store";
import { runWatcher } from "@/lib/observatory-watch";

export const maxDuration = 120;

function isAuthorized(request: Request): boolean {
  const expectedToken = process.env.CRON_SECRET;
  if (!expectedToken) return false;
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  if (!isObservatoryStorageConfigured()) {
    return Response.json({ error: "storage_unavailable" }, { status: 503 });
  }
  try {
    const next = await runWatcher(await readObservatoryState());
    await writeObservatoryState(next);
    return Response.json({ ok: true, run: next.last_run });
  } catch (error) {
    console.error(`watch failed: ${error instanceof Error ? error.name : "unknown"}`);
    return Response.json({ error: "watch_failed" }, { status: 500 });
  }
}
