export type Lane = "capability" | "funding" | "policy" | "research" | "people" | "community" | "critic";

export const LANE_IDS: Lane[] = [
  "capability",
  "funding",
  "policy",
  "research",
  "people",
  "community",
  "critic",
];

export type Place = { name: string; lat: number; lon: number };

export type AtlasNode = {
  id: string;
  lane: Lane;
  title: string;
  date: string;
  url: string;
  retrieved_at: string;
  place?: Place;
  // Only on nodes from data/critic.json. A policy node carries `quote` (and, for Anthropic's
  // reader response, `responds_to`); a critic node also carries who said it, the Anthropic
  // document it answers and the event it targets. `url` is always the source of that node itself.
  kind?: string;
  quote?: string;
  responds_to?: string;
  attributed_to?: string;
  target_id?: string;
  anthropic_url?: string;
};

// One era of data/eras.json: a guided-tour chapter with its verbatim-sourced stops.
export type Era = {
  id: string;
  title: string;
  start: string;
  end: string;
  big_idea: string;
  cites: string[];
  stops: string[];
};

export type QuizQuestion = {
  id: string;
  q: string;
  options: string[];
  answer_index: number;
  explain: string;
  evidence: { id: string; url: string; quote: string }[];
};

// An office or community location from data/places.json, drawn as its own map layer.
export type AtlasPlace = {
  id: string;
  kind: string;
  name: string;
  city?: string | null;
  country?: string | null;
  lat: number;
  lon: number;
  site?: string | null;
  source_url?: string | null;
};

export type BeliefVerdict = "False" | "Distorted" | "True";

export type Belief = {
  id: string;
  belief: string;
  verdict: BeliefVerdict;
  corrected_statement: string;
  sources: { url: string; quote: string; tier: string }[];
};

export const yearOf = (node: AtlasNode) => Number(node.date.slice(0, 4));

// Oldest first, matching the order a story is told in. Same-day nodes fall back to id so
// the order is stable between renders and between the tour and next/previous.
export const compareChronologically = (a: AtlasNode, b: AtlasNode) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

export type Theme = "light" | "dark";

// One shared description of what the voice agent can do to the UI, used by the API route
// (which validates it) and the client (which runs it).
export type AtlasAction =
  | { name: "select_event"; id: string }
  | { name: "play_event"; id: string }
  | { name: "set_year"; year: number }
  | { name: "set_lanes"; lanes: Lane[] }
  | { name: "start_history"; fromId: string };

// Lines of newline-delimited JSON streamed by POST /api/ask.
export type AskStreamEvent =
  | { type: "text"; delta: string }
  | { type: "action"; action: AtlasAction }
  | { type: "done"; cited: string[] }
  | { type: "error"; message: string };
