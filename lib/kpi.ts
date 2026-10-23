import type { AtlasNode } from "@/lib/atlas-types";

export type Kpi = {
  id: "milestones" | "models" | "funding" | "valuation";
  label: string;
  // The displayed figure; for a valuation it is the text copied out of a node title.
  value: string;
  // Every node the figure is computed from, so the UI can link to each one.
  sources: AtlasNode[];
};

// "Anthropic raises Series E at $61.5B valuation" -> "$61.5B". Only a dollar amount that the
// title itself ties to the word "valuation" counts; nothing is inferred when it is absent.
const VALUATION_IN_TITLE =
  /(\$\s?\d[\d.,]*\s?(?:trillion|billion|million|[TBM])\b)(?=\s+(?:post-money\s+)?valuation)/i;

export function valuationStatedInTitle(title: string): string | null {
  return title.match(VALUATION_IN_TITLE)?.[1] ?? null;
}

// Figures at the selected year, computed only from the nodes passed in (never typed in by hand).
// Critic nodes are commentary on Anthropic, not Anthropic milestones, so they are left out.
export function computeKpis(nodesUpToYear: AtlasNode[]): Kpi[] {
  const byDate = [...nodesUpToYear].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const milestones = byDate.filter((node) => node.lane !== "critic");
  const models = byDate.filter((node) => node.lane === "capability");
  const fundingRounds = byDate.filter((node) => node.lane === "funding");

  const latestValuationNode = [...fundingRounds].reverse().find((node) => valuationStatedInTitle(node.title));
  const kpis: Kpi[] = [
    { id: "milestones", label: "Milestones", value: String(milestones.length), sources: milestones },
    { id: "models", label: "Models released", value: String(models.length), sources: models },
    { id: "funding", label: "Funding rounds", value: String(fundingRounds.length), sources: fundingRounds },
  ];
  if (latestValuationNode) {
    kpis.push({
      id: "valuation",
      label: "Latest valuation stated",
      value: valuationStatedInTitle(latestValuationNode.title) ?? "",
      sources: [latestValuationNode],
    });
  }
  return kpis;
}
