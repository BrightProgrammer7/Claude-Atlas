import { BlobError, get, list, put } from "@vercel/blob";
import { z } from "zod";
import { clientAddress, createRateLimiter } from "@/lib/rate-limit";
import {
  CLIENT_ID_PATTERN,
  EVENT_CODE_PATTERN,
  QUESTION_COUNT,
  summarizeRecords,
  type QuizMode,
  type QuizRecord,
  type QuizSummary,
} from "@/lib/quiz-shared";

export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 1024;
const MAX_RECORDS_READ_PER_EVENT = 3_000;
const BLOB_READ_CONCURRENCY = 16;
const SUMMARY_CACHE_MS = 10_000;

const isOverWriteLimit = createRateLimiter(60_000, 10);
const isOverReadLimit = createRateLimiter(60_000, 60);

const recordSchema = z.object({
  event: z.string().regex(EVENT_CODE_PATTERN),
  mode: z.enum(["before", "after"]),
  score: z.number().int().min(0).max(QUESTION_COUNT),
  clientId: z.string().regex(CLIENT_ID_PATTERN),
});

const summaryCacheByEvent = new Map<string, { expiresAt: number; summary: QuizSummary }>();

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

// Without a connected Blob store the route cannot persist anything; the page then keeps the
// result on the device and says so.
const isStorageConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const recordPathname = (event: string, mode: QuizMode, clientId: string) =>
  `quiz/${event}/${mode}-${clientId}.json`;

export async function POST(request: Request) {
  if (isOverWriteLimit(clientAddress(request), Date.now())) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }
  if (!isStorageConfigured()) return json({ error: "storage_unavailable" }, 503);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "invalid_request" }, 413);

  let parsed;
  try {
    parsed = recordSchema.safeParse(JSON.parse((await request.text()).slice(0, MAX_BODY_BYTES)));
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  const record: QuizRecord = parsed.data;

  try {
    // First write wins: without overwrite, a second submission for the same participant and
    // test is refused, so a refresh or a replay cannot move the averages. The server never
    // stores the client's address.
    await put(
      recordPathname(record.event, record.mode, record.clientId),
      JSON.stringify({ ...record, submittedAt: new Date().toISOString() }),
      { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false },
    );
  } catch (error) {
    if (error instanceof BlobError && /already exists/i.test(error.message)) {
      return json({ stored: false, reason: "already_submitted" }, 409);
    }
    console.error(`quiz write failed: ${error instanceof Error ? error.name : "unknown"}`);
    return json({ error: "storage_unavailable" }, 503);
  }

  summaryCacheByEvent.delete(record.event);
  return json({ stored: true }, 201);
}

async function readAllRecords(event: string): Promise<QuizRecord[]> {
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `quiz/${event}/`, cursor, limit: 1000 });
    pathnames.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && pathnames.length < MAX_RECORDS_READ_PER_EVENT);

  const records: QuizRecord[] = [];
  for (let start = 0; start < pathnames.length; start += BLOB_READ_CONCURRENCY) {
    const batch = pathnames.slice(start, start + BLOB_READ_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (pathname) => {
        const file = await get(pathname, { access: "private" });
        if (!file) return null;
        const parsed = recordSchema.safeParse(JSON.parse(await new Response(file.stream).text()));
        return parsed.success && parsed.data.event === event ? parsed.data : null;
      }),
    );
    for (const record of results) if (record) records.push(record);
  }
  return records;
}

export async function GET(request: Request) {
  if (isOverReadLimit(clientAddress(request), Date.now())) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }
  const event = new URL(request.url).searchParams.get("event") ?? "";
  if (!EVENT_CODE_PATTERN.test(event)) return json({ error: "invalid_request" }, 400);
  if (!isStorageConfigured()) return json({ error: "storage_unavailable" }, 503);

  const cached = summaryCacheByEvent.get(event);
  if (cached && cached.expiresAt > Date.now()) return json(cached.summary);

  try {
    const summary = summarizeRecords(event, await readAllRecords(event));
    summaryCacheByEvent.set(event, { expiresAt: Date.now() + SUMMARY_CACHE_MS, summary });
    return json(summary);
  } catch (error) {
    console.error(`quiz read failed: ${error instanceof Error ? error.name : "unknown"}`);
    return json({ error: "storage_unavailable" }, 503);
  }
}
