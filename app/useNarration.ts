"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { audioUrlForNode } from "@/lib/node-audio.mjs";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused";

type Playback = { nodeId: string | null; status: PlaybackStatus };

export type TourState = { isActive: boolean; position: number; total: number };

const INACTIVE_TOUR: TourState = { isActive: false, position: 0, total: 0 };

// A breath between tour items so the camera has started moving before the next voice.
const GAP_BETWEEN_TOUR_ITEMS_MS = 700;

// Playing this once inside a tap unlocks the shared audio element on iOS Safari, which
// otherwise refuses audio started later from a speech result instead of a tap.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

type UseNarrationOptions = {
  // Called whenever the tour moves to a node so the page can select it and fly the camera.
  onTourStep: (nodeId: string) => void;
};

// One shared audio element so that only a single narration ever plays at a time.
export function useNarration({ onTourStep }: UseNarrationOptions) {
  const [playback, setPlayback] = useState<Playback>({ nodeId: null, status: "idle" });
  const [tour, setTour] = useState<TourState>(INACTIVE_TOUR);
  const [audioProblem, setAudioProblem] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedNodeIdRef = useRef<string | null>(null);
  const tourQueueRef = useRef<string[]>([]);
  const tourIndexRef = useRef(0);
  const isTourActiveRef = useRef(false);
  const nextTourStepTimerRef = useRef<number | null>(null);
  const onTourStepRef = useLatest(onTourStep);

  const clearNextTourStepTimer = useCallback(() => {
    if (nextTourStepTimerRef.current !== null) {
      window.clearTimeout(nextTourStepTimerRef.current);
      nextTourStepTimerRef.current = null;
    }
  }, []);

  const loadAndPlay = useCallback(
    (nodeId: string) => {
      const audio = audioRef.current;
      if (!audio) return;

      clearNextTourStepTimer();
      loadedNodeIdRef.current = nodeId;
      setPlayback({ nodeId, status: "loading" });
      setAudioProblem(null);

      audio.muted = false;
      audio.src = audioUrlForNode(nodeId);
      audio.play().catch((error: unknown) => {
        const wasSupersededByNewerLoad = loadedNodeIdRef.current !== nodeId;
        if (wasSupersededByNewerLoad || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setPlayback({ nodeId, status: "paused" });
        setAudioProblem(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Press play to start the narration."
            : "This narration could not be played.",
        );
      });
    },
    [clearNextTourStepTimer],
  );

  const finishTour = useCallback(() => {
    clearNextTourStepTimer();
    isTourActiveRef.current = false;
    setTour(INACTIVE_TOUR);
  }, [clearNextTourStepTimer]);

  const beginTourStep = useCallback(
    (index: number) => {
      tourIndexRef.current = index;
      setTour({ isActive: true, position: index + 1, total: tourQueueRef.current.length });
      const nodeId = tourQueueRef.current[index];
      onTourStepRef.current(nodeId);
      loadAndPlay(nodeId);
    },
    [loadAndPlay, onTourStepRef],
  );

  const moveTourBy = useCallback(
    (step: 1 | -1) => {
      if (!isTourActiveRef.current) return;
      const target = tourIndexRef.current + step;
      if (target >= tourQueueRef.current.length) {
        finishTour();
        audioRef.current?.pause();
        loadedNodeIdRef.current = null;
        setPlayback({ nodeId: null, status: "idle" });
        return;
      }
      beginTourStep(Math.max(0, target));
    },
    [beginTourStep, finishTour],
  );

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const advanceAfterCurrentItem = () => {
      if (!isTourActiveRef.current) {
        setPlayback((current) => ({ ...current, status: "idle" }));
        return;
      }
      setPlayback((current) => ({ ...current, status: "loading" }));
      clearNextTourStepTimer();
      nextTourStepTimerRef.current = window.setTimeout(
        () => moveTourBy(1),
        GAP_BETWEEN_TOUR_ITEMS_MS,
      );
    };

    const handlePlaying = () => {
      if (loadedNodeIdRef.current) setPlayback((current) => ({ ...current, status: "playing" }));
    };
    const handlePause = () => {
      // A clip that finishes fires pause and then ended; ended owns that transition.
      if (loadedNodeIdRef.current && !audio.ended) {
        setPlayback((current) => ({ ...current, status: "paused" }));
      }
    };
    const handleEnded = () => {
      if (loadedNodeIdRef.current) advanceAfterCurrentItem();
    };
    const handleError = () => {
      if (!loadedNodeIdRef.current) return;
      setAudioProblem("Narration audio is unavailable for this item.");
      advanceAfterCurrentItem();
    };

    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      loadedNodeIdRef.current = null;
      clearNextTourStepTimer();
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.pause();
      audio.removeAttribute("src");
      audioRef.current = null;
    };
  }, [clearNextTourStepTimer, moveTourBy]);

  const playNode = useCallback(
    (nodeId: string) => {
      finishTour();
      loadAndPlay(nodeId);
    },
    [finishTour, loadAndPlay],
  );

  const togglePlayNode = useCallback(
    (nodeId: string) => {
      const audio = audioRef.current;
      if (!audio || loadedNodeIdRef.current !== nodeId || audio.ended) {
        playNode(nodeId);
        return;
      }
      if (audio.paused) {
        void audio.play().catch(() => setAudioProblem("This narration could not be played."));
      } else {
        audio.pause();
      }
    },
    [playNode],
  );

  const togglePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !loadedNodeIdRef.current) return;
    if (audio.paused) {
      void audio.play().catch(() => setAudioProblem("This narration could not be played."));
    } else {
      audio.pause();
    }
  }, []);

  const pauseNarration = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    finishTour();
    loadedNodeIdRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    setPlayback({ nodeId: null, status: "idle" });
  }, [finishTour]);

  const startTour = useCallback(
    (orderedNodeIds: string[]) => {
      if (orderedNodeIds.length === 0) return;
      tourQueueRef.current = orderedNodeIds;
      isTourActiveRef.current = true;
      beginTourStep(0);
    },
    [beginTourStep],
  );

  // Call from a tap or click handler so audio started later is allowed on iOS.
  const unlockAudioForLaterPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || loadedNodeIdRef.current || audio.currentSrc) return;
    audio.muted = true;
    audio.src = SILENT_WAV;
    void audio
      .play()
      .then(() => audio.pause())
      .catch(() => undefined)
      .finally(() => {
        audio.muted = false;
        audio.removeAttribute("src");
      });
  }, []);

  return {
    playback,
    tour,
    audioProblem,
    playNode,
    togglePlayNode,
    togglePause,
    pauseNarration,
    stop,
    startTour,
    skipForward: () => moveTourBy(1),
    skipBack: () => moveTourBy(-1),
    endTour: finishTour,
    unlockAudioForLaterPlayback,
  };
}
