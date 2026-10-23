import Atlas from "./Atlas";
import rawNodes from "@/data/nodes.json";
import rawPlaces from "@/data/places.json";
import rawBeliefs from "@/data/beliefs.json";
import type { AtlasNode, AtlasPlace, Belief } from "@/lib/atlas-types";

export default function Home() {
  return (
    <Atlas
      nodes={rawNodes as AtlasNode[]}
      places={rawPlaces as AtlasPlace[]}
      beliefs={rawBeliefs as Belief[]}
    />
  );
}
