import knowledgeBase from "@/data/kb.json";
import nodes from "@/data/nodes.json";
import { LANE_IDS, type AtlasAction, type Lane } from "@/lib/atlas-types";

type KnowledgeBaseEntry = {
  id: string;
  lane?: string;
  title?: string;
  name?: string;
  date?: string | null;
  place?: { name: string } | null;
  excerpt?: string;
  kind?: string | null;
  city?: string | null;
  country?: string | null;
  site?: string | null;
};

const entries = knowledgeBase as unknown as KnowledgeBaseEntry[];

export const KNOWN_CITATION_IDS: ReadonlySet<string> = new Set(entries.map((entry) => entry.id));

// Only map events can be selected, played or used as a history starting point.
const EVENT_IDS: ReadonlySet<string> = new Set(nodes.map((node) => node.id));

const years = nodes.map((node) => Number(node.date.slice(0, 4)));
const FIRST_YEAR = Math.min(...years);
const LAST_YEAR = Math.max(...years);

function describeEntry(entry: KnowledgeBaseEntry): string {
  if (entry.date !== undefined || entry.lane) {
    const place = entry.place?.name ?? "no place named";
    return `[${entry.id}] ${entry.date ?? "undated"} | ${entry.lane} | ${entry.title} | ${place} | ${entry.excerpt ?? ""}`;
  }
  const location = [entry.city, entry.country].filter(Boolean).join(", ");
  return `[${entry.id}] place | ${entry.kind ?? "place"} | ${entry.name} | ${location} | ${entry.site ?? ""}`;
}

export const KNOWLEDGE_BASE_TEXT = entries.map(describeEntry).join("\n");

export const SYSTEM_PROMPT = `You are the voice of Claude Atlas, an independent atlas of sourced facts about Anthropic and Claude. Answer ONLY from the knowledge base below. Never use outside knowledge, and never guess.

Rules:
- Reply in 1 to 4 short sentences suited to being spoken aloud. No lists, no markdown, no headings.
- Cite every factual sentence with the id of the knowledge base item it comes from, in square brackets right before the sentence's final punctuation, for example: Claude 3 launched in March 2024 [claude-3-family]. Use only ids that appear in the knowledge base.
- If the knowledge base does not cover the question, say that the atlas has no sourced item on that yet, and name the closest items with their ids.
- If asked for a critic's view or criticism, use only items whose lane is critique. If there are none, say that no critic's view is sourced yet.
- Items in the myth-check lane hold a belief, a verdict (False, Distorted or True) and a corrected statement. Use them for questions that test a belief, for example whether something happened, and state the verdict first.
- Answer in the language of the question: English, French or Arabic. Keep ids and proper names unchanged. Translate the standard sentences above into that language.
- You can drive the interface with tools. Give your spoken answer first, then call a tool only when the user asks to see, open, play, jump to, filter or be walked through something. Use only ids from the knowledge base that are not myth-check items.

Knowledge base, one item per line as [id] date | lane | title | place | excerpt:
${KNOWLEDGE_BASE_TEXT}`;

// Streaming filter that keeps a bracketed citation only when every id in it is in the
// knowledge base; anything else is dropped before it reaches the client. A "[" is held back
// until its "]" arrives so a citation split across chunks is judged whole.
const MAX_CITATION_LENGTH = 160;

export function createCitationFilter() {
  let held = "";
  const cited: string[] = [];

  function judge(bracketed: string): string {
    const ids = bracketed
      .slice(1, -1)
      .split(/[\s,;]+/)
      .filter(Boolean);
    const known = ids.filter((id) => KNOWN_CITATION_IDS.has(id));
    if (known.length === 0 || known.length !== ids.length) return "";
    for (const id of known) if (!cited.includes(id)) cited.push(id);
    return known.map((id) => `[${id}]`).join("");
  }

  function push(chunk: string): string {
    let output = "";
    for (const character of chunk) {
      if (held) {
        held += character;
        if (character === "]") {
          output += judge(held);
          held = "";
        } else if (held.length > MAX_CITATION_LENGTH) {
          // Not a citation: release the text unchanged.
          output += held;
          held = "";
        }
      } else if (character === "[") {
        held = "[";
      } else {
        output += character;
      }
    }
    return output;
  }

  // An unterminated "[" at the end of the answer is dropped, not shown as half a citation.
  function finish(): string[] {
    held = "";
    return cited;
  }

  return { push, finish };
}

// Tool calls come from the model, so ids, years and lanes are checked before the client runs them.
export function validateAction(toolName: string, input: unknown): AtlasAction | null {
  const record = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "select_event":
    case "play_event":
      return typeof record.id === "string" && EVENT_IDS.has(record.id)
        ? { name: toolName, id: record.id }
        : null;
    case "start_history":
      return typeof record.fromId === "string" && EVENT_IDS.has(record.fromId)
        ? { name: "start_history", fromId: record.fromId }
        : null;
    case "set_year": {
      const year = Number(record.year);
      return Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR
        ? { name: "set_year", year }
        : null;
    }
    case "set_lanes": {
      const lanes = Array.isArray(record.lanes)
        ? record.lanes.filter((lane): lane is Lane => LANE_IDS.includes(lane as Lane))
        : [];
      return lanes.length > 0 ? { name: "set_lanes", lanes } : null;
    }
    default:
      return null;
  }
}
