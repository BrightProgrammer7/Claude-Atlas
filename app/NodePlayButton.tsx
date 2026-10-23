"use client";

import type { PlaybackStatus } from "./useNarration";

type NodePlayButtonProps = {
  nodeTitle: string;
  status: PlaybackStatus;
  onClick: () => void;
};

const PlayIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 fill-current">
    <path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" />
  </svg>
);

const PauseIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 fill-current">
    <rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8" />
    <rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8" />
  </svg>
);

export default function NodePlayButton({ nodeTitle, status, onClick }: NodePlayButtonProps) {
  const isPlaying = status === "playing" || status === "loading";
  const verb = isPlaying ? "Pause" : status === "paused" ? "Resume" : "Play";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${verb} narration: ${nodeTitle}`}
      aria-busy={status === "loading"}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
        isPlaying || status === "paused"
          ? "border-accent bg-accent/15 text-accent"
          : "border-hair text-ink hover:border-accent hover:text-accent"
      }`}
    >
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
      {verb}
    </button>
  );
}
