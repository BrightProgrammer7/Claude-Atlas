"use client";

import type { AtlasNode, Era } from "@/lib/atlas-types";

type EraTourProps = {
  eras: Era[];
  nodesById: Map<string, AtlasNode>;
  isPickerOpen: boolean;
  activeEraId: string | null;
  isWalking: boolean;
  stopPosition: number;
  stopTotal: number;
  onPickEra: (eraId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onStop: () => void;
  onClose: () => void;
  onChipClick: (node: AtlasNode) => void;
};

const buttonClassName =
  "inline-flex min-h-9 items-center rounded-md border border-hair px-3 text-sm text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

const yearRange = (era: Era) => {
  const startYear = era.start.slice(0, 4);
  const endYear = era.end.slice(0, 4);
  return startYear === endYear ? startYear : `${startYear} to ${endYear}`;
};

export default function EraTour({
  eras,
  nodesById,
  isPickerOpen,
  activeEraId,
  isWalking,
  stopPosition,
  stopTotal,
  onPickEra,
  onPrevious,
  onNext,
  onStop,
  onClose,
  onChipClick,
}: EraTourProps) {
  const activeEra = eras.find((era) => era.id === activeEraId) ?? null;
  if (!isPickerOpen && !activeEra) return null;

  if (activeEra) {
    const currentStopId = isWalking ? activeEra.stops[stopPosition - 1] : null;
    const controls = (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onPrevious} disabled={!isWalking || stopPosition <= 1} className={buttonClassName}>
          Previous
        </button>
        <button type="button" onClick={onNext} disabled={!isWalking} className={buttonClassName}>
          {isWalking && stopPosition >= stopTotal ? "Finish" : "Next"}
        </button>
        {isWalking ? (
          <button type="button" onClick={onStop} className={buttonClassName}>
            Stop
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onPickEra(activeEra.id)} className={buttonClassName}>
              Replay era
            </button>
            <button type="button" onClick={onClose} className={buttonClassName}>
              Choose another era
            </button>
          </>
        )}
      </div>
    );
    return (
      <section
        aria-label="Guided tour"
        className="max-h-[42dvh] overflow-y-auto border-b border-hair bg-canvas px-3 pb-3 sm:px-4"
      >
        <div className="sticky top-0 z-10 -mx-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-canvas px-3 py-2 sm:-mx-4 sm:px-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-accent">
            Guided tour {isWalking ? `· stop ${stopPosition} of ${stopTotal}` : "· finished"}
          </p>
          {controls}
        </div>
        <h2 className="text-base font-semibold leading-snug">{activeEra.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink/90">{activeEra.big_idea}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources for this era">
          {activeEra.cites.flatMap((id) => {
            const node = nodesById.get(id);
            if (!node) return [];
            return [
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onChipClick(node)}
                  title={node.title}
                  className={`max-w-[15rem] truncate rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-accent hover:text-accent ${
                    id === currentStopId ? "border-accent text-accent" : "border-hair text-ink"
                  }`}
                >
                  {node.title}
                </button>
              </li>,
            ];
          })}
        </ul>
      </section>
    );
  }

  return (
    <section aria-label="Choose an era" className="border-b border-hair bg-ink/[0.03] px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-widest text-accent">Pick an era</p>
        <button type="button" onClick={onClose} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          Close
        </button>
      </div>
      <ol className="mt-2 grid gap-2 sm:grid-cols-2">
        {eras.map((era) => (
          <li key={era.id}>
            <button
              type="button"
              onClick={() => onPickEra(era.id)}
              className="block h-full w-full rounded-md border border-hair px-3 py-2 text-left transition-colors hover:border-accent"
            >
              <span className="block font-mono text-[11px] text-muted">
                {yearRange(era)} · {era.stops.length} stops
              </span>
              <span className="mt-0.5 block text-sm leading-snug">{era.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
