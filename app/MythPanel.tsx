"use client";

import { useEffect, useRef } from "react";
import type { Belief, BeliefVerdict } from "@/lib/atlas-types";

type MythPanelProps = {
  beliefs: Belief[];
  highlightedBeliefId: string | null;
};

const VERDICT_CLASS: Record<BeliefVerdict, string> = {
  False: "verdict-false",
  Distorted: "verdict-distorted",
  True: "verdict-true",
};

function readableUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname === "/" ? "" : pathname;
    return `${hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

export default function MythPanel({ beliefs, highlightedBeliefId }: MythPanelProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!highlightedBeliefId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-belief-id="${CSS.escape(highlightedBeliefId)}"]`)
      ?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
  }, [highlightedBeliefId]);

  return (
    <div>
      <p className="border-b border-hair px-4 py-3 text-xs leading-relaxed text-muted">
        Common beliefs checked against primary sources. Each verdict was reproduced independently, and
        every source is linked.
      </p>
      <ol ref={listRef}>
        {beliefs.map((belief) => (
          <li
            key={belief.id}
            data-belief-id={belief.id}
            data-highlighted={belief.id === highlightedBeliefId || undefined}
            className="border-b border-hair px-4 py-4 last:border-b-0 data-[highlighted]:bg-ink/5 data-[highlighted]:shadow-[inset_2px_0_0_0_var(--accent)]"
          >
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Belief</p>
            <p className="mt-1 text-[15px] leading-snug">{belief.belief}</p>
            <p
              className={`mt-3 inline-block rounded-full border px-2.5 py-0.5 font-mono text-xs ${VERDICT_CLASS[belief.verdict]}`}
            >
              {belief.verdict}
            </p>
            <p className="mt-3 text-sm leading-relaxed">{belief.corrected_statement}</p>
            <ul className="mt-3 flex flex-col gap-2 text-xs">
              {belief.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-accent underline-offset-2 hover:underline"
                  >
                    {readableUrl(source.url)}
                  </a>
                  <span className="ml-2 font-mono text-muted">{source.tier}</span>
                  <blockquote className="mt-1 border-l-2 border-hair pl-3 leading-relaxed text-muted">
                    {source.quote}
                  </blockquote>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
