import quizQuestions from "@/data/quiz.json";

export const QUESTION_COUNT = quizQuestions.length;
export const DEFAULT_EVENT_CODE = "casablanca-build-day";

export type QuizMode = "before" | "after";

// Lowercase letters, digits and hyphens: safe to put in a blob pathname and a URL.
export const EVENT_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
export const CLIENT_ID_PATTERN = /^[a-zA-Z0-9-]{16,64}$/;

// A record holds no personal data: an event code, which test, a score and a random id the
// browser made up.
export type QuizRecord = {
  event: string;
  mode: QuizMode;
  score: number;
  clientId: string;
};

export type QuizSummary = {
  event: string;
  n_before: number;
  n_after: number;
  mean_before: number | null;
  mean_after: number | null;
  // Participants who submitted both a Before and an After.
  n_paired: number;
  mean_gain: number | null;
  // "paired" when gain is the mean of per-participant (after minus before); "unpaired" when
  // nobody has both yet and it falls back to mean after minus mean before.
  gain_basis: "paired" | "unpaired" | null;
};

const mean = (values: number[]) =>
  values.length === 0
    ? null
    : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;

export function summarizeRecords(event: string, records: QuizRecord[]): QuizSummary {
  const beforeByClient = new Map<string, number>();
  const afterByClient = new Map<string, number>();
  for (const record of records) {
    (record.mode === "before" ? beforeByClient : afterByClient).set(record.clientId, record.score);
  }

  const pairedGains: number[] = [];
  for (const [clientId, afterScore] of afterByClient) {
    const beforeScore = beforeByClient.get(clientId);
    if (beforeScore !== undefined) pairedGains.push(afterScore - beforeScore);
  }

  const meanBefore = mean([...beforeByClient.values()]);
  const meanAfter = mean([...afterByClient.values()]);
  let meanGain: number | null = null;
  let gainBasis: QuizSummary["gain_basis"] = null;
  if (pairedGains.length > 0) {
    meanGain = mean(pairedGains);
    gainBasis = "paired";
  } else if (meanBefore !== null && meanAfter !== null) {
    meanGain = Math.round((meanAfter - meanBefore) * 100) / 100;
    gainBasis = "unpaired";
  }

  return {
    event,
    n_before: beforeByClient.size,
    n_after: afterByClient.size,
    mean_before: meanBefore,
    mean_after: meanAfter,
    n_paired: pairedGains.length,
    mean_gain: meanGain,
    gain_basis: gainBasis,
  };
}
