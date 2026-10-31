import type { Metadata } from "next";
import ObservatoryFeed from "./ObservatoryFeed";

export const metadata: Metadata = {
  title: "Observatory | Claude Atlas",
  description:
    "Automatic daily watch of Anthropic publications and governance pages. Every item links to its source.",
};

// The feed is read client-side from /api/observatory, which is cached for five minutes.
export default function ObservatoryPage() {
  return <ObservatoryFeed />;
}
