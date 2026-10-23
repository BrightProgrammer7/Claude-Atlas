"use client";

import { useMemo, useState } from "react";
import { computeKpis } from "@/lib/kpi";
import type { AtlasNode } from "@/lib/atlas-types";

type KpiReadoutProps = {
  year: number;
  nodesUpToYear: AtlasNode[];
  onFocusNode: (node: AtlasNode) => void;
};

// A readout of the figures at the year cursor. Each figure opens the list of nodes it was
// counted from, and each of those jumps to its node, so no number is a claim without a source.
export default function KpiReadout({ year, nodesUpToYear, onFocusNode }: KpiReadoutProps) {
  const kpis = useMemo(() => computeKpis(nodesUpToYear), [nodesUpToYear]);
  const [openKpiId, setOpenKpiId] = useState<string | null>(null);
  const openKpi = kpis.find((kpi) => kpi.id === openKpiId) ?? null;

  return (
    <section aria-label={`Figures up to ${year}`} className="mx-auto mb-3 max-w-3xl">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hair bg-hair sm:grid-cols-4">
        {kpis.map((kpi) => {
          const isOpen = kpi.id === openKpiId;
          return (
            <div key={kpi.id} className="bg-canvas">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls="kpi-sources"
                onClick={() => setOpenKpiId(isOpen ? null : kpi.id)}
                className={`block w-full px-3 py-2 text-left transition-colors hover:bg-ink/5 ${
                  isOpen ? "bg-ink/5" : ""
                }`}
              >
                <dt className="font-mono text-[10px] uppercase tracking-widest text-muted">{kpi.label}</dt>
                <dd className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-lg font-semibold tabular-nums leading-none">{kpi.value}</span>
                  <span className="font-mono text-[10px] text-muted">
                    {kpi.sources.length} {kpi.sources.length === 1 ? "source" : "sources"}
                  </span>
                </dd>
              </button>
            </div>
          );
        })}
      </dl>
      <div id="kpi-sources" hidden={!openKpi}>
        {openKpi && (
          <div className="mt-2 max-h-28 overflow-y-auto rounded-md border border-hair p-2">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted">
              {openKpi.label}: computed from
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {openKpi.sources.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => onFocusNode(node)}
                    title={node.title}
                    className="max-w-[16rem] truncate rounded-full border border-hair px-2.5 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    <span className="font-mono text-muted">{node.date.slice(0, 4)}</span> {node.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
