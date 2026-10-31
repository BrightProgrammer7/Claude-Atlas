import { createHash } from "node:crypto";
import rawNodes from "@/data/nodes.json";
import rawCritic from "@/data/critic.json";
import rawWatchlist from "@/data/watchlist.json";
import type {
  AnthropicItem,
  GovernanceItem,
  ObservatoryRun,
  ObservatoryState,
} from "@/lib/observatory-types";

const SITEMAP_URL = "https://www.anthropic.com/sitemap.xml";
const MAX_PAGE_FETCHES_PER_RUN = 40;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_CHARS = 3_000_000;
const CONCURRENCY = 6;
const USER_AGENT = "ClaudeAtlasObservatory/1.0 (+https://claudeatlas.vercel.app/observatory)";

type WatchlistEntry = { org: string; title: string; url: string };
const WATCHLIST = rawWatchlist as WatchlistEntry[];

const canonicalUrl = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
};

async function fetchText(url: string): Promise<{ status: number | null; text: string }> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    const text = (await response.text()).slice(0, MAX_BODY_CHARS);
    return { status: response.status, text };
  } catch {
    return { status: null, text: "" };
  }
}

const decodeEntities = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const visibleText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

function metaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (key !== property) continue;
    const content = tag.match(/content=(?:"([^"]*)"|'([^']*)')/i);
    const value = content?.[1] ?? content?.[2];
    if (value) return decodeEntities(value).trim();
  }
  return null;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const PRINTED_DATE = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`);

const isoDay = (value: string | null | undefined) => value?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

function publishedDate(html: string, text: string): string | null {
  const fromMeta = isoDay(metaContent(html, "article:published_time"));
  if (fromMeta) return fromMeta;
  const fromJsonLd = isoDay(html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]);
  if (fromJsonLd) return fromJsonLd;
  const printed = text.match(PRINTED_DATE);
  if (!printed) return null;
  const parsed = new Date(`${printed[1]} ${printed[2]}, ${printed[3]} 00:00:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function assessAnthropicPage(url: string, html: string, retrievedAt: string): AnthropicItem {
  const id = new URL(url).pathname.replace(/^\/+/, "").replace(/\//g, "-");
  const base = { id, source: "anthropic" as const, url, retrieved_at: retrievedAt };
  const title = metaContent(html, "og:title");
  if (!title) {
    return { ...base, title: id, date: null, status: "to-confirm", reason: "No og:title on the page." };
  }
  const text = visibleText(html);
  const date = publishedDate(html, text);
  if (!text.includes(title)) {
    return { ...base, title, date, status: "to-confirm", reason: "The og:title text does not appear in the page body." };
  }
  if (!date) {
    return { ...base, title, date: null, status: "to-confirm", reason: "Title verified, but no published date found on the page." };
  }
  return { ...base, title, date, status: "verified-mechanically" };
}

async function inBatches<T, R>(inputs: T[], work: (input: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < inputs.length; start += CONCURRENCY) {
    results.push(...(await Promise.all(inputs.slice(start, start + CONCURRENCY).map(work))));
  }
  return results;
}

export async function runWatcher(previous: ObservatoryState): Promise<ObservatoryState> {
  const startedAt = new Date().toISOString();
  let pageFetches = 0;
  const items = [...previous.items];
  const pages = { ...previous.pages };

  // Governance pages: claim only "this page changed on <date>". The first sighting is a baseline.
  const watchlistStatus: ObservatoryRun["watchlist_status"] = [];
  let governanceChanges = 0;
  await inBatches(WATCHLIST, async (entry) => {
    pageFetches += 1;
    const { status, text } = await fetchText(entry.url);
    watchlistStatus.push({ org: entry.org, url: entry.url, http_status: status });
    if (status !== 200) return;
    const hash = createHash("sha256").update(visibleText(text)).digest("hex");
    const knownPage = pages[entry.url];
    const now = new Date().toISOString();
    if (knownPage && knownPage.hash !== hash) {
      const item: GovernanceItem = {
        id: `${entry.org.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${hash.slice(0, 8)}`,
        source: "governance",
        org: entry.org,
        title: entry.title,
        url: entry.url,
        changed_detected_at: now,
      };
      if (!items.some((existing) => existing.id === item.id)) {
        items.push(item);
        governanceChanges += 1;
      }
    }
    pages[entry.url] = { hash, checked_at: now };
  });

  // Anthropic: every /news or /research URL not already in the atlas data or in the store.
  const knownUrls = new Set<string>(
    [...(rawNodes as { url: string }[]), ...(rawCritic as { url: string }[])].map((node) => canonicalUrl(node.url)),
  );
  for (const item of items) if (item.source === "anthropic") knownUrls.add(canonicalUrl(item.url));

  pageFetches += 1;
  const sitemap = await fetchText(SITEMAP_URL);
  const candidates = [...sitemap.text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
    .map((match) => ({ url: canonicalUrl(match[1]), lastmod: match[2] ?? "" }))
    .filter((entry) => /^https:\/\/www\.anthropic\.com\/(news|research)\/[^/]+$/.test(entry.url))
    .filter((entry) => !knownUrls.has(entry.url))
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod));

  let addedVerified = 0;
  let addedToConfirm = 0;
  const budget = Math.max(0, MAX_PAGE_FETCHES_PER_RUN - pageFetches);
  const batch = candidates.slice(0, budget);
  const fetched = await inBatches(batch, async (entry) => ({ entry, page: await fetchText(entry.url) }));
  pageFetches += batch.length;
  for (const { entry, page } of fetched) {
    // A failed fetch stores nothing, so the URL is retried on the next run.
    if (page.status !== 200) continue;
    const item = assessAnthropicPage(entry.url, page.text, new Date().toISOString());
    items.push(item);
    if (item.status === "verified-mechanically") addedVerified += 1;
    else addedToConfirm += 1;
  }

  return {
    items,
    pages,
    last_run: {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      page_fetches: pageFetches,
      anthropic_pending_after_run: candidates.length - batch.length,
      added_verified: addedVerified,
      added_to_confirm: addedToConfirm,
      governance_changes: governanceChanges,
      watchlist_status: watchlistStatus,
    },
  };
}
