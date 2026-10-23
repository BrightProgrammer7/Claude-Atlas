"use client";

import type { AtlasNode } from "@/lib/atlas-types";

type NodeEvidenceProps = {
  node: AtlasNode;
  isSelected: boolean;
  // The event this node answers: the target of a critic, or what an Anthropic response replies to.
  targetNode: AtlasNode | undefined;
  // Critic nodes that target this node, shown only while this node is selected.
  criticsOfThisNode: AtlasNode[];
  onFocusNode: (node: AtlasNode) => void;
};

const linkClassName = "text-accent underline-offset-2 hover:underline";

function CriticCard({ critic, onFocusNode }: { critic: AtlasNode; onFocusNode: (node: AtlasNode) => void }) {
  return (
    <li className="border-l-2 border-dashed border-[var(--critic)] pl-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--critic)]">
        {critic.attributed_to}
      </p>
      {critic.quote && (
        <blockquote className="mt-1 text-[13px] italic leading-snug text-ink">
          &ldquo;{critic.quote}&rdquo;
        </blockquote>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <a href={critic.url} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          critic source
        </a>
        <button type="button" onClick={() => onFocusNode(critic)} className={linkClassName}>
          open in timeline
        </button>
      </p>
    </li>
  );
}

// Everything under a timeline row's title that comes from data/critic.json: the verbatim quote,
// who said it, where it points, and (on a selected event) what critics say about it.
export default function NodeEvidence({
  node,
  isSelected,
  targetNode,
  criticsOfThisNode,
  onFocusNode,
}: NodeEvidenceProps) {
  const isCritic = node.lane === "critic";
  const showCriticsSay = isSelected && criticsOfThisNode.length > 0;
  if (!node.quote && !targetNode && !showCriticsSay) return null;

  return (
    <div
      className={`mx-4 mb-1 mt-1 text-xs ${
        isCritic ? "border-l-2 border-dashed border-[var(--critic)] pl-3" : ""
      }`}
    >
      {isCritic && node.attributed_to && (
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--critic)]">
          Said by {node.attributed_to}
        </p>
      )}
      {node.quote && (
        <blockquote className="mt-1 text-[13px] italic leading-snug text-muted">
          &ldquo;{node.quote}&rdquo;
        </blockquote>
      )}
      {targetNode && (
        <p className="mt-1.5">
          <span className="text-muted">{isCritic ? "Responds to " : "Replies to "}</span>
          <button
            type="button"
            onClick={() => onFocusNode(targetNode)}
            className={`${linkClassName} text-left`}
          >
            {targetNode.title}
          </button>
        </p>
      )}
      {showCriticsSay && (
        <section aria-label="Critics say" className="mt-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-[var(--critic)]">
            Critics say
          </h3>
          <ul className="mt-1.5 space-y-2.5">
            {criticsOfThisNode.map((critic) => (
              <CriticCard key={critic.id} critic={critic} onFocusNode={onFocusNode} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
