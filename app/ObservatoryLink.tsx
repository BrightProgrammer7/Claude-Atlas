"use client";

import Link from "next/link";
import { useMemo } from "react";
import { itemTimestamp, type ObservatoryItem } from "@/lib/observatory-types";
import { LAST_VISIT_STORAGE_KEY } from "@/lib/observatory-visit";

function readLastVisit(): string | null {
  try {
    return localStorage.getItem(LAST_VISIT_STORAGE_KEY);
  } catch {
    return null;
  }
}

// The first visit only sets the baseline, so a new reader is not greeted by the whole backlog.
function newItemsSinceLastVisit(items: ObservatoryItem[]): number {
  const lastVisit = readLastVisit();
  if (!lastVisit) {
    try {
      localStorage.setItem(LAST_VISIT_STORAGE_KEY, new Date().toISOString());
    } catch {
      // Storage refused: the badge simply stays at zero.
    }
    return 0;
  }
  return items.filter((item) => itemTimestamp(item) > lastVisit).length;
}

export default function ObservatoryLink({ items }: { items: ObservatoryItem[] }) {
  const newCount = useMemo(() => newItemsSinceLastVisit(items), [items]);
  return (
    <Link
      href="/observatory"
      className="flex items-center gap-2 rounded-md border border-hair px-2.5 py-1 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
    >
      <span>Observatory</span>
      {newCount > 0 && (
        <span
          aria-label={`${newCount} new since your last visit`}
          className="rounded-full bg-accent px-1.5 font-mono text-[11px] leading-5 text-[#141413]"
        >
          {newCount}
        </span>
      )}
    </Link>
  );
}
