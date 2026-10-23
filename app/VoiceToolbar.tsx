"use client";

import type { ReactNode } from "react";

type VoiceToolbarProps = {
  canStartTour: boolean;
  isTourActive: boolean;
  tourPosition: number;
  tourTotal: number;
  isNarrationPaused: boolean;
  isListening: boolean;
  statusMessage: string;
  onStartTour: () => void;
  onOpenEraTour: () => void;
  isEraTourOpen: boolean;
  onTogglePause: () => void;
  onSkip: () => void;
  onStopTour: () => void;
  onToggleListening: () => void;
};

const iconClassName = "size-3.5 fill-current";

const PlayIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className={iconClassName}>
    <path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" />
  </svg>
);

const PauseIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className={iconClassName}>
    <rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8" />
    <rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8" />
  </svg>
);

const SkipIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className={iconClassName}>
    <path d="M3 2.7v10.6a.5.5 0 0 0 .78.42l7-5.3a.5.5 0 0 0 0-.84l-7-5.3A.5.5 0 0 0 3 2.7Z" />
    <rect x="11.5" y="2.5" width="2.2" height="11" rx="0.8" />
  </svg>
);

const StopIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className={iconClassName}>
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
  </svg>
);

const MicIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className={iconClassName}>
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
    <path d="M3 7.5a.75.75 0 0 1 1.5 0 3.5 3.5 0 0 0 7 0 .75.75 0 0 1 1.5 0 5 5 0 0 1-4.25 4.94v1.31h1.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5h1.5v-1.31A5 5 0 0 1 3 7.5Z" />
  </svg>
);

type ToolbarButtonProps = {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  isHighlighted?: boolean;
  pressed?: boolean;
  label?: string;
};

function ToolbarButton({ onClick, children, disabled, isHighlighted, pressed, label }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isHighlighted
          ? "border-accent bg-accent/15 text-accent"
          : "border-hair text-ink hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

export default function VoiceToolbar({
  canStartTour,
  isTourActive,
  tourPosition,
  tourTotal,
  isNarrationPaused,
  isListening,
  statusMessage,
  onStartTour,
  onOpenEraTour,
  isEraTourOpen,
  onTogglePause,
  onSkip,
  onStopTour,
  onToggleListening,
}: VoiceToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hair px-3 py-2 sm:px-4">
      {isTourActive ? (
        <>
          <ToolbarButton onClick={onTogglePause} isHighlighted>
            {isNarrationPaused ? <PlayIcon /> : <PauseIcon />}
            {isNarrationPaused ? "Resume" : "Pause"}
          </ToolbarButton>
          <ToolbarButton onClick={onSkip}>
            <SkipIcon />
            Skip
          </ToolbarButton>
          <ToolbarButton onClick={onStopTour}>
            <StopIcon />
            Stop
          </ToolbarButton>
          <span className="font-mono text-xs text-muted">
            {tourPosition} / {tourTotal}
          </span>
        </>
      ) : (
        <>
          <ToolbarButton onClick={onStartTour} disabled={!canStartTour}>
            <PlayIcon />
            Voice history
          </ToolbarButton>
          <ToolbarButton onClick={onOpenEraTour} isHighlighted={isEraTourOpen} pressed={isEraTourOpen}>
            <PlayIcon />
            Tour
          </ToolbarButton>
        </>
      )}

      <ToolbarButton
        onClick={onToggleListening}
        isHighlighted={isListening}
        pressed={isListening}
        label={
          isListening
            ? "Stop listening"
            : "Ask by voice, or say next, previous, tour, stop"
        }
      >
        <MicIcon />
        {isListening ? "Listening" : "Speak"}
      </ToolbarButton>

      <p
        role="status"
        aria-live="polite"
        className="min-w-0 basis-full text-xs leading-snug text-muted sm:flex-1 sm:basis-0"
      >
        {statusMessage}
      </p>
    </div>
  );
}
