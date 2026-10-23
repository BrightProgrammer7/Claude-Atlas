"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskStreamEvent, AtlasAction } from "@/lib/atlas-types";
import { createSentenceSplitter, createSpeechOutput, stripCitations, type SpeechOutput } from "@/lib/speech-output";

export type AskStatus = "idle" | "thinking" | "streaming" | "done" | "error";

export type AskState = {
  status: AskStatus;
  question: string;
  // The answer as streamed, citations included; the panel strips them for display.
  answer: string;
  cited: string[];
  // From end of speech or submit to the first streamed word.
  firstWordMs: number | null;
  errorMessage: string | null;
};

const IDLE_STATE: AskState = {
  status: "idle",
  question: "",
  answer: "",
  cited: [],
  firstWordMs: null,
  errorMessage: null,
};

const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_MESSAGE_CHARACTERS = 1200;

const CITATION_PATTERN = /\[([^\]]+)\]/g;

export function citedIdsIn(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(CITATION_PATTERN)) {
    for (const id of match[1].split(/[\s,;]+/).filter(Boolean)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

type UseAskAtlasOptions = {
  onAction: (action: AtlasAction) => void;
};

export function useAskAtlas({ onAction }: UseAskAtlasOptions) {
  const [state, setState] = useState<AskState>(IDLE_STATE);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const speechOutputRef = useRef<SpeechOutput | null>(null);
  // Bumped by every new question and every Stop, so a deferred action can tell it is stale.
  const generationRef = useRef(0);
  const onActionRef = useRef(onAction);
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  // Call from the tap or click that starts a question so later speech is allowed to play.
  const prepareSpeech = useCallback(() => {
    speechOutputRef.current ??= createSpeechOutput(setIsSpeaking);
    speechOutputRef.current.unlock();
    return speechOutputRef.current;
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    speechOutputRef.current?.stop();
    setIsSpeaking(false);
    setState((current) =>
      current.status === "thinking" || current.status === "streaming"
        ? { ...current, status: "done" }
        : current,
    );
  }, []);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      speechOutputRef.current?.stop();
    },
    [],
  );

  const ask = useCallback(
    async (rawQuestion: string, startedAt: number = performance.now()) => {
      const question = rawQuestion.trim().slice(0, 500);
      if (!question) return;

      abortControllerRef.current?.abort();
      const speech = prepareSpeech();
      speech.stop();
      generationRef.current += 1;
      const generation = generationRef.current;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setState({ ...IDLE_STATE, status: "thinking", question });

      let answer = "";
      let firstWordMs: number | null = null;
      const splitter = createSentenceSplitter((sentence) => speech.speak(sentence));

      const handleEvent = (event: AskStreamEvent) => {
        if (event.type === "text") {
          if (firstWordMs === null) firstWordMs = Math.round(performance.now() - startedAt);
          answer += event.delta;
          splitter.push(event.delta);
          const answerSoFar = answer;
          const firstWord = firstWordMs;
          setState((current) => ({
            ...current,
            status: "streaming",
            answer: answerSoFar,
            cited: citedIdsIn(answerSoFar),
            firstWordMs: firstWord,
          }));
        } else if (event.type === "action") {
          const { action } = event;
          if (action.name === "play_event" || action.name === "start_history") {
            // Narration would talk over the spoken answer, so it starts once the answer has been
            // spoken; the selection and camera move straight away.
            onActionRef.current({
              name: "select_event",
              id: action.name === "play_event" ? action.id : action.fromId,
            });
            void speech.whenIdle().then(() => {
              if (generationRef.current === generation) onActionRef.current(action);
            });
          } else {
            onActionRef.current(action);
          }
        } else if (event.type === "done") {
          splitter.flush();
          setState((current) => ({ ...current, status: "done", cited: event.cited }));
        } else if (event.type === "error") {
          splitter.flush();
          setState((current) => ({ ...current, status: "error", errorMessage: event.message }));
        }
      };

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history: historyRef.current }),
          signal: abortController.signal,
          cache: "no-store",
        });
        if (!response.ok || !response.body) {
          setState((current) => ({
            ...current,
            status: "error",
            errorMessage:
              response.status === 429
                ? "Too many questions in a short time. Wait a minute and try again."
                : "The atlas could not answer right now.",
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          let newlineIndex = buffered.indexOf("\n");
          while (newlineIndex !== -1) {
            const line = buffered.slice(0, newlineIndex).trim();
            buffered = buffered.slice(newlineIndex + 1);
            if (line) handleEvent(JSON.parse(line) as AskStreamEvent);
            newlineIndex = buffered.indexOf("\n");
          }
        }

        if (answer) {
          historyRef.current = [
            ...historyRef.current,
            { role: "user" as const, content: question },
            { role: "assistant" as const, content: answer.slice(0, MAX_HISTORY_MESSAGE_CHARACTERS) },
          ].slice(-MAX_HISTORY_MESSAGES);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((current) => ({
          ...current,
          status: "error",
          errorMessage: "The atlas could not answer right now.",
        }));
      } finally {
        if (abortControllerRef.current === abortController) abortControllerRef.current = null;
      }
    },
    [prepareSpeech],
  );

  const displayedAnswer = stripCitations(state.answer);

  return { state, displayedAnswer, isSpeaking, ask, stop, prepareSpeech };
}
