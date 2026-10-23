import type { AtlasNode } from "./atlas-types";

export type VoiceCommand = "next" | "previous" | "tour" | "stop";

export type VoiceIntent =
  | { kind: "command"; command: VoiceCommand }
  | { kind: "match"; node: AtlasNode }
  | { kind: "none" };

export const VOICE_COMMAND_WORDS = ["next", "previous", "tour", "stop"] as const;

const COMMAND_BY_WORD: Record<string, VoiceCommand> = {
  next: "next",
  skip: "next",
  previous: "previous",
  back: "previous",
  tour: "tour",
  stop: "stop",
  pause: "stop",
};

// When several commands are spoken at once ("stop the tour"), the safer one wins.
const COMMAND_PRIORITY: VoiceCommand[] = ["stop", "tour", "previous", "next"];

// Words that may surround a command without changing it ("go back", "start the tour").
const COMMAND_FILLER_WORDS = new Set([
  "the", "a", "an", "please", "go", "start", "begin", "play", "voice", "this", "it", "one", "now", "to",
]);

// Words that carry no signal when matching a title. Single letters stay out of this list
// because "Series H" needs its "h".
const TITLE_STOP_WORDS = new Set([
  "the", "an", "of", "to", "in", "on", "for", "and", "or", "at", "is", "was", "me", "my", "show",
  "play", "tell", "about", "go", "open", "take", "find", "what", "please", "node", "item", "can",
  "you", "i", "want", "see", "hear", "listen", "news", "with", "from", "by", "as",
]);

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20",
};

const MINIMUM_QUERY_COVERAGE = 0.4;
const FUZZY_MINIMUM_LENGTH = 6;
const FUZZY_MINIMUM_SIMILARITY = 0.75;
const FUZZY_CREDIT = 0.7;

const asDigits = (word: string) => NUMBER_WORDS[word] ?? word;

// Speech recognisers write "Claude 3.5" as digits but a spoken "three point five" may
// arrive as words, so both are folded into the same token.
function tokenize(text: string): string[] {
  const rawWords = text.toLowerCase().replace(/[’']/g, "").match(/\d+(?:\.\d+)?|[a-z]+/g) ?? [];
  const tokens: string[] = [];
  for (let index = 0; index < rawWords.length; index += 1) {
    const token = asDigits(rawWords[index]).replace(/^(\d+)\.0+$/, "$1");
    const previousToken = tokens[tokens.length - 1];
    const nextToken = rawWords[index + 1] === undefined ? undefined : asDigits(rawWords[index + 1]);
    if (token === "point" && previousToken && /^\d+$/.test(previousToken) && nextToken && /^\d+$/.test(nextToken)) {
      tokens[tokens.length - 1] = `${previousToken}.${nextToken}`;
      index += 1;
      continue;
    }
    tokens.push(token);
  }
  return tokens;
}

function significantTokens(text: string): string[] {
  const tokens = tokenize(text);
  return tokens.filter((token, index) => {
    if (TITLE_STOP_WORDS.has(token)) return false;
    // "a" is an article except in "Series A".
    if (token === "a") return tokens[index - 1] === "series";
    return true;
  });
}

function detectCommand(transcript: string): VoiceCommand | null {
  const words = tokenize(transcript).filter((word) => !COMMAND_FILLER_WORDS.has(word));
  if (words.length === 0 || !words.every((word) => word in COMMAND_BY_WORD)) return null;
  const spoken = new Set(words.map((word) => COMMAND_BY_WORD[word]));
  return COMMAND_PRIORITY.find((command) => spoken.has(command)) ?? null;
}

function editDistance(a: string, b: string): number {
  let previousRow = Array.from({ length: b.length + 1 }, (_, column) => column);
  for (let row = 1; row <= a.length; row += 1) {
    const currentRow = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      currentRow[column] = Math.min(
        previousRow[column] + 1,
        currentRow[column - 1] + 1,
        previousRow[column - 1] + substitutionCost,
      );
    }
    previousRow = currentRow;
  }
  return previousRow[b.length];
}

// 1 for an exact hit, a reduced credit for a near miss on a longer word ("bangalore" for
// "bengaluru"), 0 otherwise.
function tokenMatchCredit(queryToken: string, titleTokens: Set<string>): number {
  if (titleTokens.has(queryToken)) return 1;
  if (queryToken.length < FUZZY_MINIMUM_LENGTH) return 0;
  let bestSimilarity = 0;
  for (const titleToken of titleTokens) {
    if (titleToken.length < FUZZY_MINIMUM_LENGTH) continue;
    const longest = Math.max(queryToken.length, titleToken.length);
    bestSimilarity = Math.max(bestSimilarity, 1 - editDistance(queryToken, titleToken) / longest);
  }
  return bestSimilarity >= FUZZY_MINIMUM_SIMILARITY ? bestSimilarity * FUZZY_CREDIT : 0;
}

// Recognisers often split a compound ("glass wing" for "Glasswing"); rejoin a pair of
// words only when the joined form is a word that really occurs in a title.
function rejoinSplitWords(tokens: string[], titleVocabulary: Set<string>): string[] {
  const rejoined: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const joined = `${tokens[index]}${tokens[index + 1] ?? ""}`;
    if (index + 1 < tokens.length && /^[a-z]+$/.test(joined) && titleVocabulary.has(joined)) {
      rejoined.push(joined);
      index += 1;
    } else {
      rejoined.push(tokens[index]);
    }
  }
  return rejoined;
}

function findBestTitleMatch(transcript: string, nodes: AtlasNode[]): AtlasNode | null {
  const titleTokenSets = nodes.map((node) => new Set(significantTokens(node.title)));
  const titleVocabulary = new Set(titleTokenSets.flatMap((tokens) => [...tokens]));

  const queryTokens = [...new Set(rejoinSplitWords(significantTokens(transcript), titleVocabulary))];
  if (queryTokens.length === 0) return null;

  // Rare words (a product name) outweigh words that appear in most titles ("anthropic").
  const weightOf = (token: string) => {
    const titlesContaining = titleTokenSets.filter((tokens) => tokens.has(token)).length;
    return Math.log(1 + nodes.length / Math.max(1, titlesContaining));
  };

  const queryTotalWeight = queryTokens.reduce((sum, token) => sum + weightOf(token), 0);

  let best: { node: AtlasNode; queryCoverage: number; titleCoverage: number } | null = null;
  nodes.forEach((node, index) => {
    const titleTokens = titleTokenSets[index];
    const matchedWeight = queryTokens.reduce(
      (sum, token) => sum + weightOf(token) * tokenMatchCredit(token, titleTokens),
      0,
    );
    if (matchedWeight === 0) return;

    const titleTotalWeight = [...titleTokens].reduce((sum, token) => sum + weightOf(token), 0);
    const candidate = {
      node,
      queryCoverage: matchedWeight / queryTotalWeight,
      titleCoverage: matchedWeight / Math.max(titleTotalWeight, 1e-9),
    };

    const isBetter =
      !best ||
      candidate.queryCoverage > best.queryCoverage + 1e-9 ||
      (Math.abs(candidate.queryCoverage - best.queryCoverage) <= 1e-9 &&
        (candidate.titleCoverage > best.titleCoverage + 1e-9 ||
          (Math.abs(candidate.titleCoverage - best.titleCoverage) <= 1e-9 &&
            candidate.node.date > best.node.date)));
    if (isBetter) best = candidate;
  });

  const winner = best as { node: AtlasNode; queryCoverage: number } | null;
  return winner && winner.queryCoverage >= MINIMUM_QUERY_COVERAGE ? winner.node : null;
}

export function interpretUtterance(transcript: string, nodes: AtlasNode[]): VoiceIntent {
  const command = detectCommand(transcript);
  if (command) return { kind: "command", command };

  const node = findBestTitleMatch(transcript, nodes);
  return node ? { kind: "match", node } : { kind: "none" };
}

// Biases the recogniser toward the words this page actually contains. These are hints for
// listening only; nothing here is displayed.
export function speechVocabularyHints(nodes: AtlasNode[]): string[] {
  const placeNames = nodes.flatMap((node) => (node.place ? [node.place.name] : []));
  return [...new Set([...VOICE_COMMAND_WORDS, ...placeNames, ...nodes.map((node) => node.title)])];
}
