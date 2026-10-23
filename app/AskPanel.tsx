"use client";

import { useState, type FormEvent } from "react";
import type { AskState } from "./useAskAtlas";

type AskChip = { id: string; label: string };

type AskPanelProps = {
  state: AskState;
  displayedAnswer: string;
  chips: AskChip[];
  isSpeaking: boolean;
  isListening: boolean;
  onSubmit: (question: string) => void;
  onStop: () => void;
  onChipClick: (id: string) => void;
};

const MAX_QUESTION_CHARACTERS = 500;

export default function AskPanel({
  state,
  displayedAnswer,
  chips,
  isSpeaking,
  isListening,
  onSubmit,
  onStop,
  onChipClick,
}: AskPanelProps) {
  const [draft, setDraft] = useState("");
  const isBusy = state.status === "thinking" || state.status === "streaming";
  const canStop = isBusy || isSpeaking;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || isBusy) return;
    onSubmit(question);
    setDraft("");
  };

  return (
    <div className="border-b border-hair px-3 py-2 sm:px-4">
      <form onSubmit={submit} className="flex items-center gap-2">
        <label htmlFor="ask-atlas" className="sr-only">
          Ask the atlas
        </label>
        <input
          id="ask-atlas"
          type="text"
          value={draft}
          maxLength={MAX_QUESTION_CHARACTERS}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask the atlas, in English, French or Arabic"
          autoComplete="off"
          className="min-h-9 min-w-0 flex-1 rounded-md border border-hair bg-transparent px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || isBusy}
          className="min-h-9 rounded-md border border-hair px-3 text-sm text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Ask
        </button>
        {canStop && (
          <button
            type="button"
            onClick={onStop}
            className="min-h-9 rounded-md border border-accent bg-accent/15 px-3 text-sm text-accent"
          >
            Stop
          </button>
        )}
      </form>

      {(state.status !== "idle" || isListening) && (
        <div className="mt-2 max-h-44 overflow-y-auto" aria-live="polite">
          {state.question && (
            <p className="text-xs text-muted">
              <span className="font-mono uppercase tracking-widest">You</span> {state.question}
            </p>
          )}
          {state.status === "thinking" && <p className="mt-1 text-sm text-muted">Reading the sources</p>}
          {displayedAnswer && (
            <p dir="auto" className="mt-1 text-sm leading-relaxed">
              {displayedAnswer}
            </p>
          )}
          {state.status === "error" && state.errorMessage && (
            <p className="mt-1 text-sm text-accent">{state.errorMessage}</p>
          )}
          {chips.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources cited">
              {chips.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    onClick={() => onChipClick(chip.id)}
                    className="max-w-64 truncate rounded-full border border-hair px-2.5 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    {chip.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.firstWordMs !== null && (
            <p className="mt-2 font-mono text-[11px] text-muted">first word in {state.firstWordMs} ms</p>
          )}
        </div>
      )}
    </div>
  );
}
