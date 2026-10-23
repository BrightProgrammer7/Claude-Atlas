import Atlas from "./Atlas";
import QuizLink from "./QuizLink";
import rawPlaces from "@/data/places.json";
import rawBeliefs from "@/data/beliefs.json";
import { ATLAS_ERAS, ATLAS_NODES } from "@/lib/atlas-data";
import type { AtlasPlace, Belief } from "@/lib/atlas-types";

export default function Home() {
  return (
    <Atlas
      nodes={ATLAS_NODES}
      places={rawPlaces as AtlasPlace[]}
      beliefs={rawBeliefs as Belief[]}
      eras={ATLAS_ERAS}
      quizLink={<QuizLink />}
    />
  );
}
