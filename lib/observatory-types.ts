export type AnthropicItem = {
  id: string;
  source: "anthropic";
  title: string;
  date: string | null;
  url: string;
  retrieved_at: string;
  status: "verified-mechanically" | "to-confirm";
  // Present only on "to-confirm" items: the exact check that failed.
  reason?: string;
};

export type GovernanceItem = {
  id: string;
  source: "governance";
  org: string;
  title: string;
  url: string;
  changed_detected_at: string;
};

export type ObservatoryItem = AnthropicItem | GovernanceItem;

export type ObservatoryRun = {
  started_at: string;
  finished_at: string;
  page_fetches: number;
  anthropic_pending_after_run: number;
  added_verified: number;
  added_to_confirm: number;
  governance_changes: number;
  watchlist_status: { org: string; url: string; http_status: number | null }[];
};

export type ObservatoryState = {
  items: ObservatoryItem[];
  // Content fingerprint of each watched governance page, to detect "this page changed".
  pages: Record<string, { hash: string; checked_at: string }>;
  last_run: ObservatoryRun | null;
};

export const EMPTY_STATE: ObservatoryState = { items: [], pages: {}, last_run: null };

// The hour in the cron expression of vercel.json; the page derives "next run" from it.
export const CRON_HOUR_UTC = 6;

export const itemTimestamp = (item: ObservatoryItem) =>
  item.source === "governance" ? item.changed_detected_at : item.retrieved_at;
