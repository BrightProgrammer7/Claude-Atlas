"use client";

import type { Theme } from "@/lib/atlas-types";

type ThemeToggleProps = { theme: Theme; onToggle: () => void };

const SunIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </svg>
);

const MoonIcon = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="currentColor">
    <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a.5.5 0 0 0-.7-.56A6.3 6.3 0 1 0 14.06 10.3a.5.5 0 0 0-.56-.7Z" />
  </svg>
);

export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      className="inline-flex size-9 items-center justify-center rounded-md border border-hair text-ink transition-colors hover:border-accent hover:text-accent"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
