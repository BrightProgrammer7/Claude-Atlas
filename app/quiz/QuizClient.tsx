"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { QuizQuestion } from "@/lib/atlas-types";
import {
  DEFAULT_EVENT_CODE,
  EVENT_CODE_PATTERN,
  type QuizMode,
  type QuizSummary,
} from "@/lib/quiz-shared";

const CLIENT_ID_STORAGE_KEY = "atlas-quiz-client-id";
const EVENT_STORAGE_KEY = "atlas-quiz-event";
const localScoresKey = (event: string) => `atlas-quiz-scores:${event}`;

type LocalScores = { before?: number; after?: number };
type StorageOutcome = "shared" | "already_submitted" | "device_only";
type Phase = "intro" | "question" | "result";

function readLocalScores(event: string): LocalScores {
  try {
    return JSON.parse(localStorage.getItem(localScoresKey(event)) ?? "{}") as LocalScores;
  } catch {
    return {};
  }
}

// A random id made up in the browser, only so a Before and an After from the same person can
// be paired. It identifies a browser profile, not a person.
function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

const formatMean = (value: number | null) => (value === null ? "n/a" : value.toFixed(2));
const formatGain = (value: number | null) =>
  value === null ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

const primaryButton =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-5 text-base font-medium text-[#141413] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-hair px-5 text-base text-ink transition-colors hover:border-accent hover:text-accent";

type QuizClientProps = { questions: QuizQuestion[]; qrCode: ReactNode };

export default function QuizClient({ questions, qrCode }: QuizClientProps) {
  const [eventCode, setEventCode] = useState(DEFAULT_EVENT_CODE);
  const [mode, setMode] = useState<QuizMode>("before");
  const [phase, setPhase] = useState<Phase>("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [isRevealed, setIsRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [outcome, setOutcome] = useState<StorageOutcome | null>(null);
  const [summary, setSummary] = useState<QuizSummary | null>(null);
  const [localScores, setLocalScores] = useState<LocalScores>({});

  // The event code can come from the link (?event=...) or from the last visit.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("event")?.toLowerCase();
    const fromStorage = (() => {
      try {
        return localStorage.getItem(EVENT_STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    const initial = [fromLink, fromStorage].find((code) => code && EVENT_CODE_PATTERN.test(code));
    // Reading browser-only sources after hydration: the server render cannot know them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial) setEventCode(initial);
  }, []);

  const isEventCodeValid = EVENT_CODE_PATTERN.test(eventCode);
  const question = questions[questionIndex];
  const isAfter = mode === "after";

  const start = (chosenMode: QuizMode) => {
    if (!isEventCodeValid) return;
    try {
      localStorage.setItem(EVENT_STORAGE_KEY, eventCode);
    } catch {
      // Private browsing can refuse storage; the quiz still works for this visit.
    }
    setMode(chosenMode);
    setQuestionIndex(0);
    setSelectedIndex(null);
    setAnswers([]);
    setIsRevealed(false);
    setOutcome(null);
    setSummary(null);
    setLocalScores(readLocalScores(eventCode));
    setPhase("question");
  };

  const finish = useCallback(
    async (finalAnswers: number[]) => {
      const finalScore = finalAnswers.reduce(
        (total, answer, index) => total + (answer === questions[index].answer_index ? 1 : 0),
        0,
      );
      setScore(finalScore);
      setPhase("result");

      const scores = { ...readLocalScores(eventCode), [mode]: finalScore };
      try {
        localStorage.setItem(localScoresKey(eventCode), JSON.stringify(scores));
      } catch {
        // Private browsing: the on-screen result still works.
      }
      setLocalScores(scores);

      let storageOutcome: StorageOutcome = "device_only";
      try {
        const response = await fetch("/api/quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: eventCode,
            mode,
            score: finalScore,
            clientId: getOrCreateClientId(),
          }),
        });
        if (response.status === 201) storageOutcome = "shared";
        else if (response.status === 409) storageOutcome = "already_submitted";
      } catch {
        // Offline or the route is down: the result stays on this device.
      }
      setOutcome(storageOutcome);

      if (storageOutcome !== "device_only") {
        try {
          const response = await fetch(`/api/quiz?event=${encodeURIComponent(eventCode)}`);
          if (response.ok) setSummary((await response.json()) as QuizSummary);
        } catch {
          // The summary is a bonus; the participant's own score is already on screen.
        }
      }
    },
    [eventCode, mode, questions],
  );

  const handleSelect = (optionIndex: number) => {
    if (isRevealed) return;
    setSelectedIndex(optionIndex);
    // After mode shows the explanation the moment an answer is chosen; Before mode never does.
    if (isAfter) setIsRevealed(true);
  };

  const handleNext = () => {
    if (selectedIndex === null) return;
    const nextAnswers = [...answers.slice(0, questionIndex), selectedIndex];
    setAnswers(nextAnswers);
    if (questionIndex + 1 >= questions.length) {
      void finish(nextAnswers);
      return;
    }
    setQuestionIndex(questionIndex + 1);
    setSelectedIndex(null);
    setIsRevealed(false);
  };

  const shell = (children: ReactNode) => (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-5 sm:py-10">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link href="/" className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
          Claude Atlas
        </Link>
        {phase !== "intro" && (
          <span className="font-mono text-xs uppercase tracking-widest text-muted">
            {mode} · {eventCode}
          </span>
        )}
      </header>
      {children}
    </main>
  );

  if (phase === "intro") {
    return shell(
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Claude Atlas quiz</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {questions.length} questions, one at a time. Take it Before the session and again After. Your
          gain is your After score minus your Before score. Scores are anonymous: an event code, a score
          and a random id made in this browser.
        </p>

        <label htmlFor="event-code" className="mt-6 block font-mono text-[11px] uppercase tracking-widest text-muted">
          Event code
        </label>
        <input
          id="event-code"
          value={eventCode}
          onChange={(event) => setEventCode(event.target.value.trim().toLowerCase())}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          aria-invalid={!isEventCodeValid}
          aria-describedby="event-code-help"
          className="mt-1.5 min-h-12 w-full rounded-lg border border-hair bg-transparent px-3 font-mono text-base text-ink"
        />
        <p id="event-code-help" className={`mt-1.5 text-xs ${isEventCodeValid ? "text-muted" : "text-[var(--critic)]"}`}>
          {isEventCodeValid
            ? "Use the code your host gave you."
            : "3 to 40 characters: lowercase letters, digits and hyphens."}
        </p>

        <div className="mt-6 grid gap-3">
          <button type="button" className={primaryButton} disabled={!isEventCodeValid} onClick={() => start("before")}>
            Start Before
          </button>
          <button type="button" className={secondaryButton} disabled={!isEventCodeValid} onClick={() => start("after")}>
            Start After
          </button>
        </div>

        <div className="mt-8 flex items-center gap-4 border-t border-hair pt-6">
          {qrCode}
          <p className="text-xs leading-relaxed text-muted">
            Scan to open this quiz on a phone. The QR code is drawn at build time, with no outside
            service.
          </p>
        </div>
      </>,
    );
  }

  if (phase === "question") {
    const progress = ((questionIndex + (isRevealed ? 1 : 0)) / questions.length) * 100;
    const isLastQuestion = questionIndex + 1 >= questions.length;
    const evidenceUrls = Array.from(new Set(question.evidence.map((item) => item.url)));
    return shell(
      <>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={questionIndex + 1}
          aria-label="Quiz progress"
          className="h-1 w-full overflow-hidden rounded-full bg-hair"
        >
          <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 font-mono text-xs text-muted">
          Question {questionIndex + 1} of {questions.length}
        </p>
        <h1 className="mt-2 text-xl font-semibold leading-snug">{question.q}</h1>

        <ul className="mt-5 grid gap-3" aria-label="Answers">
          {question.options.map((option, optionIndex) => {
            const isSelected = selectedIndex === optionIndex;
            const isCorrect = optionIndex === question.answer_index;
            let tone = "border-hair hover:border-accent";
            if (isSelected && !isRevealed) tone = "border-accent bg-accent/15";
            if (isRevealed && isCorrect) tone = "border-[var(--verdict-true)] bg-[var(--verdict-true)]/15";
            if (isRevealed && isSelected && !isCorrect) {
              tone = "border-[var(--verdict-false)] bg-[var(--verdict-false)]/15";
            }
            return (
              <li key={option}>
                <button
                  type="button"
                  onClick={() => handleSelect(optionIndex)}
                  aria-pressed={isSelected}
                  disabled={isRevealed}
                  className={`flex min-h-14 w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-[15px] leading-snug transition-colors disabled:cursor-default ${tone}`}
                >
                  <span className="mt-0.5 font-mono text-xs text-muted">{String.fromCharCode(65 + optionIndex)}</span>
                  <span>{option}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {isAfter && isRevealed && (
          <section aria-live="polite" className="mt-5 rounded-lg border border-hair p-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
              {selectedIndex === question.answer_index ? "Correct" : "Not quite"}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed">{question.explain}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {evidenceUrls.map((url, urlIndex) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {evidenceUrls.length > 1 ? `Source ${urlIndex + 1}` : "Source"}
                </a>
              ))}
            </p>
          </section>
        )}

        <div className="mt-auto pt-6">
          <button type="button" className={primaryButton} disabled={selectedIndex === null} onClick={handleNext}>
            {isLastQuestion ? "Finish" : "Next"}
          </button>
        </div>
      </>,
    );
  }

  const beforeScore = localScores.before;
  const gain = isAfter && beforeScore !== undefined ? score - beforeScore : null;
  const outcomeMessage: Record<StorageOutcome, string> = {
    shared: "Your score was added to the group results.",
    already_submitted:
      "A score for this test was already recorded from this browser, so this one was not added to the group results.",
    device_only:
      "Shared storage is not reachable, so this result is saved on this device only and is not in the group results.",
  };

  return shell(
    <>
      <p className="font-mono text-xs uppercase tracking-widest text-muted">{mode} result</p>
      <h1 className="mt-2 text-5xl font-semibold tabular-nums">
        {score}
        <span className="text-2xl text-muted"> / {questions.length}</span>
      </h1>
      {isAfter && (
        <p className="mt-3 text-lg">
          {gain === null
            ? "No Before score from this device for this event, so there is no gain to show."
            : `Gain: ${gain > 0 ? "+" : ""}${gain} (${score} after minus ${beforeScore} before)`}
        </p>
      )}
      {!isAfter && <p className="mt-3 text-sm text-muted">Come back for the After test to see your gain.</p>}
      {outcome && <p className="mt-3 text-xs leading-relaxed text-muted">{outcomeMessage[outcome]}</p>}

      {summary && (
        <section aria-label={`Results for ${summary.event}`} className="mt-6 rounded-lg border border-hair p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted">
            Group results · {summary.event}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Before</dt>
              <dd className="tabular-nums">
                {formatMean(summary.mean_before)} <span className="text-muted">(n = {summary.n_before})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">After</dt>
              <dd className="tabular-nums">
                {formatMean(summary.mean_after)} <span className="text-muted">(n = {summary.n_after})</span>
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Mean gain</dt>
              <dd className="tabular-nums">
                {formatGain(summary.mean_gain)}{" "}
                <span className="text-muted">
                  {summary.gain_basis === "paired"
                    ? `(paired, ${summary.n_paired} people with both tests)`
                    : summary.gain_basis === "unpaired"
                      ? "(unpaired: nobody has both tests yet)"
                      : ""}
                </span>
              </dd>
            </div>
          </dl>
        </section>
      )}

      <div className="mt-auto grid gap-3 pt-8">
        {!isAfter && (
          <button type="button" className={primaryButton} onClick={() => start("after")}>
            Take the After test
          </button>
        )}
        <button type="button" className={secondaryButton} onClick={() => setPhase("intro")}>
          Back to start
        </button>
        <Link href="/" className={secondaryButton}>
          Open the atlas
        </Link>
      </div>
    </>,
  );
}
