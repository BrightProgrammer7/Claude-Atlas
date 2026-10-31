"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ThemeToggle from "../ThemeToggle";
import { useTheme } from "@/lib/theme";
import { useObservatoryFeed } from "../useObservatoryFeed";
import { LAST_VISIT_STORAGE_KEY } from "@/lib/observatory-visit";
import { CRON_HOUR_UTC, itemTimestamp, type ObservatoryItem } from "@/lib/observatory-types";

const ALL_SOURCES = "all";

const sourceLabel = (item: ObservatoryItem) => (item.source === "anthropic" ? "Anthropic" : item.org);

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";

function nextRunAfter(now: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_HOUR_UTC));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

const linkClassName = "text-accent underline-offset-2 hover:underline";

function ItemRow({ item }: { item: ObservatoryItem }) {
  const isGovernance = item.source === "governance";
  const isToConfirm = item.source === "anthropic" && item.status === "to-confirm";
  return (
    <li className="border-b border-hair px-4 py-3 last:border-b-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
        <span className="rounded-full border border-hair px-2 py-0.5 text-[11px] text-ink">{sourceLabel(item)}</span>
        {isGovernance && <span>page change</span>}
        {item.source === "anthropic" && item.status === "verified-mechanically" && (
          <span className="rounded-full border border-[var(--verdict-true)] px-2 py-0.5 text-[11px] text-[var(--verdict-true)]">
            verified mechanically
          </span>
        )}
        {isToConfirm && (
          <span className="rounded-full border border-[var(--verdict-distorted)] px-2 py-0.5 text-[11px] text-[var(--verdict-distorted)]">
            to confirm
          </span>
        )}
      </p>
      <p className="mt-1.5 text-[15px] leading-snug">{item.title}</p>
      {isGovernance && (
        <p className="mt-1 text-sm text-muted">This page changed on {item.changed_detected_at.slice(0, 10)}.</p>
      )}
      {item.source === "anthropic" && item.reason && (
        <p className="mt-1 text-sm text-muted">Why it waits: {item.reason}</p>
      )}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          source
        </a>
        {item.source === "anthropic" && item.date && <span>published {item.date}</span>}
        <span>
          {isGovernance ? "detected" : "retrieved"} {formatDateTime(itemTimestamp(item))}
        </span>
      </p>
    </li>
  );
}

export default function ObservatoryFeed() {
  const { items, lastRun, isLoaded } = useObservatoryFeed();
  const [theme, toggleTheme] = useTheme();
  const [sourceFilter, setSourceFilter] = useState(ALL_SOURCES);
  // Computed after mount: the server-rendered page is cached for minutes, so "now" would differ.
  const [nextRun, setNextRun] = useState<string | null>(null);

  // Visiting the observatory resets the "new since last visit" count on the main atlas.
  useEffect(() => {
    setNextRun(nextRunAfter(new Date()).toISOString());
    try {
      localStorage.setItem(LAST_VISIT_STORAGE_KEY, new Date().toISOString());
    } catch {
      // Storage refused: the count on the atlas then keeps its previous baseline.
    }
  }, []);

  const sources = useMemo(() => [...new Set(items.map(sourceLabel))].sort(), [items]);
  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => sourceFilter === ALL_SOURCES || sourceLabel(item) === sourceFilter)
        .sort((a, b) => itemTimestamp(b).localeCompare(itemTimestamp(a))),
    [items, sourceFilter],
  );

  const chipClassName = (isActive: boolean) =>
    `rounded-full border px-3 py-1 text-sm transition-colors ${
      isActive ? "border-accent text-accent" : "border-hair text-muted hover:border-accent hover:text-ink"
    }`;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-hair px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Observatory</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-md border border-hair px-2.5 py-1 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Atlas
          </Link>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <main className="flex-1">
        <section className="border-b border-hair px-4 py-4 sm:px-6">
          <p className="text-sm leading-relaxed">
            Items added automatically only when the title is verified on the source page; everything else waits in
            &lsquo;to confirm&rsquo;.
          </p>
          <p className="mt-2 font-mono text-xs text-muted">
            last run {lastRun ? formatDateTime(lastRun.finished_at) : "not yet"}
            <span aria-hidden> · </span>
            next run {nextRun ? formatDateTime(nextRun) : "daily at 06:00 UTC"}
            <span aria-hidden> · </span>
            {items.length} items
          </p>
        </section>

        <nav aria-label="Source filter" className="flex flex-wrap gap-2 border-b border-hair px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setSourceFilter(ALL_SOURCES)}
            aria-pressed={sourceFilter === ALL_SOURCES}
            className={chipClassName(sourceFilter === ALL_SOURCES)}
          >
            All
          </button>
          {sources.map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => setSourceFilter(source)}
              aria-pressed={sourceFilter === source}
              className={chipClassName(sourceFilter === source)}
            >
              {source}
            </button>
          ))}
        </nav>

        {!isLoaded ? (
          <p className="px-4 py-8 text-sm text-muted sm:px-6">Loading feed</p>
        ) : visibleItems.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted sm:px-6">
            Nothing here yet. The watcher runs once a day; items appear after its first run.
          </p>
        ) : (
          <ul>
            {visibleItems.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
