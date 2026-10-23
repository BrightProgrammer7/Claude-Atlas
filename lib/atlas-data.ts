import rawNodes from "@/data/nodes.json";
import rawCritic from "@/data/critic.json";
import rawEras from "@/data/eras.json";
import type { AtlasNode, Era } from "@/lib/atlas-types";

// data/critic.json holds both RSP policy nodes and critic nodes; both join the timeline next
// to the nodes of data/nodes.json. An id in both files would silently shadow one of them.
function mergeNodes(): AtlasNode[] {
  const primary = rawNodes as AtlasNode[];
  const critic = rawCritic as AtlasNode[];
  const seen = new Set(primary.map((node) => node.id));
  for (const node of critic) {
    if (seen.has(node.id)) throw new Error(`Duplicate node id across data files: ${node.id}`);
    seen.add(node.id);
  }
  return [...primary, ...critic];
}

export const ATLAS_NODES: AtlasNode[] = mergeNodes();
export const ATLAS_ERAS = rawEras as Era[];
