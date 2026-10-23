import { gateway, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import llmConfig from "@/data/llm.json";
import { LANE_IDS, type AskStreamEvent } from "@/lib/atlas-types";
import { createCitationFilter, SYSTEM_PROMPT, validateAction } from "@/lib/ask-grounding";

export const maxDuration = 30;

const MAX_QUESTION_CHARACTERS = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_TURN_CHARACTERS = 1200;

// Best-effort limit per server instance, like /api/speech-token: it slows down someone
// draining the model budget; it is not a substitute for a shared store.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS_PER_WINDOW = 12;
const RATE_LIMIT_MAX_TRACKED_CLIENTS = 5_000;
const requestTimestampsByClient = new Map<string, number[]>();

const NO_STORE = { "Cache-Control": "no-store" } as const;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARACTERS),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(MAX_HISTORY_TURN_CHARACTERS),
      }),
    )
    .max(MAX_HISTORY_TURNS)
    .default([]),
});

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

// No `execute`: the model's tool calls are forwarded to the browser, which runs them as UI actions.
const interfaceTools = {
  select_event: tool({
    description:
      "Select an event: highlight it in the timeline, move the year cursor and fly the globe to its place.",
    inputSchema: z.object({ id: z.string().describe("Event id from the knowledge base") }),
  }),
  play_event: tool({
    description: "Select an event and play its narration.",
    inputSchema: z.object({ id: z.string().describe("Event id from the knowledge base") }),
  }),
  set_year: tool({
    description: "Move the year cursor so only events up to that year are shown.",
    inputSchema: z.object({ year: z.number().int() }),
  }),
  set_lanes: tool({
    description: "Show only these lanes.",
    inputSchema: z.object({ lanes: z.array(z.enum(LANE_IDS as [string, ...string[]])) }),
  }),
  start_history: tool({
    description: "Start voice history mode: narrate this event, then continue chronologically.",
    inputSchema: z.object({ fromId: z.string().describe("Event id to start from") }),
  }),
};

// Gateway failures carry a status code and a short public message (for example a billing
// block); neither contains a credential, so they are safe and useful to log.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const statusCode = (error as { statusCode?: number }).statusCode;
  return `${error.name} ${statusCode ?? ""} ${error.message.slice(0, 200)}`.trim();
}

function errorResponse(error: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

export async function POST(request: Request) {
  if (isOverRateLimit(clientAddress(request), Date.now())) {
    return errorResponse("rate_limited", 429, { "Retry-After": "60" });
  }

  let parsedBody;
  try {
    parsedBody = requestSchema.safeParse(await request.json());
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (!parsedBody.success) return errorResponse("invalid_request", 400);
  const { question, history } = parsedBody.data;

  const result = streamText({
    model: gateway(llmConfig.model),
    system: SYSTEM_PROMPT,
    messages: [...history, { role: "user" as const, content: question }],
    tools: interfaceTools,
    stopWhen: stepCountIs(1),
    maxOutputTokens: 400,
    // Cache the large, unchanging knowledge base prompt, and skip reasoning so the first
    // spoken word arrives quickly.
    providerOptions: {
      gateway: { caching: "auto" },
      anthropic: { thinking: { type: "disabled" } },
    },
    abortSignal: request.signal,
  });

  const encoder = new TextEncoder();
  const citationFilter = createCitationFilter();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser hung up (Stop was pressed); the abort signal already ended the model call.
        }
      };
      try {
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            const safeText = citationFilter.push(part.text);
            if (safeText) send({ type: "text", delta: safeText });
          } else if (part.type === "tool-call") {
            const action = validateAction(part.toolName, part.input);
            if (action) send({ type: "action", action });
          } else if (part.type === "error") {
            console.error(`ask stream error: ${describeError(part.error)}`);
            send({ type: "error", message: "The atlas could not answer right now." });
          }
        }
        send({ type: "done", cited: citationFilter.finish() });
      } catch (error) {
        console.error(`ask route failed: ${describeError(error)}`);
        send({ type: "error", message: "The atlas could not answer right now." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the cancelled client.
        }
      }
    },
  });

  return new Response(body, {
    headers: { ...NO_STORE, "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
