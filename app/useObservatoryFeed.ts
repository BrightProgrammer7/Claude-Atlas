"use client";

import { useEffect, useState } from "react";
import type { AtlasNode } from "@/lib/atlas-types";
import type { ObservatoryItem, ObservatoryRun } from "@/lib/observatory-types";

export type ObservatoryFeed = { items: ObservatoryItem[]; lastRun: ObservatoryRun | null; isLoaded: boolean };

// Fetched at runtime so the cron never has to edit data/nodes.json.
export function useObservatoryFeed(): ObservatoryFeed {
  const [feed, setFeed] = useState<ObservatoryFeed>({ items: [], lastRun: null, isLoaded: false });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/observatory", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { items?: ObservatoryItem[]; last_run?: ObservatoryRun | null } | null) => {
        setFeed({ items: body?.items ?? [], lastRun: body?.last_run ?? null, isLoaded: true });
      })
      .catch(() => {
        // The atlas works without the observatory; a failed read just shows no auto-added nodes.
      });
    return () => controller.abort();
  }, []);

  return feed;
}

// Only mechanically verified Anthropic items join the timeline. The lane is chosen from the
// URL section alone (/research or /news), which is why the row carries the "auto-added" badge.
export function autoAddedNodes(items: ObservatoryItem[]): AtlasNode[] {
  return items.flatMap((item) => {
    if (item.source !== "anthropic" || item.status !== "verified-mechanically" || !item.date) return [];
    return [
      {
        id: `auto-${item.id}`,
        lane: new URL(item.url).pathname.startsWith("/research/") ? "research" : "capability",
        title: item.title,
        date: item.date,
        url: item.url,
        retrieved_at: item.retrieved_at,
        auto_added: true,
      } satisfies AtlasNode,
    ];
  });
}
