// Merges independently verified staging data into the shipped data files.
//
//   data/staging/clauders.json + clauders.verdicts.json -> appends pass=true items to data/nodes.json
//   data/staging/places.json   + places.verdicts.json   -> writes pass=true items to data/places.json
//
// A staging file without its verdicts file is ignored: nothing unverified ships. Items already
// in nodes.json (same id) are never duplicated. Run `npm run tts` and `node scripts/build-kb.mjs`
// afterwards to narrate and index any new nodes.
//
// Usage: node scripts/merge-staging.mjs
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const stagingDirectory = `${projectRoot}data/staging`;
const nodesPath = `${projectRoot}data/nodes.json`;
const placesPath = `${projectRoot}data/places.json`;

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${path}: ${error.message}`);
  }
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

// Staging files are either a bare array or an object wrapping one.
function itemsOf(parsed, wrapperKeys) {
  if (Array.isArray(parsed)) return parsed;
  for (const key of wrapperKeys) if (Array.isArray(parsed?.[key])) return parsed[key];
  throw new Error(`expected an array or an object with one of: ${wrapperKeys.join(", ")}`);
}

// Verdicts are an array of { id, pass } or a map of id -> boolean / { pass }.
function passingIds(verdictsFile) {
  const passing = new Set();
  if (Array.isArray(verdictsFile?.verdicts ?? verdictsFile)) {
    for (const verdict of verdictsFile.verdicts ?? verdictsFile) if (verdict.pass === true) passing.add(verdict.id);
    return passing;
  }
  for (const [id, verdict] of Object.entries(verdictsFile ?? {})) {
    if (verdict === true || verdict?.pass === true) passing.add(id);
  }
  return passing;
}

async function mergeClauders() {
  const items = await readJsonIfExists(`${stagingDirectory}/clauders.json`);
  const verdicts = await readJsonIfExists(`${stagingDirectory}/clauders.verdicts.json`);
  if (!items || !verdicts) {
    console.log("clauders: staging file or verdicts file missing, nothing merged.");
    return 0;
  }
  const passing = passingIds(verdicts);
  const nodes = JSON.parse(await readFile(nodesPath, "utf8"));
  const knownIds = new Set(nodes.map((node) => node.id));
  const additions = itemsOf(items, ["items", "nodes"]).filter(
    (item) => passing.has(item.id) && !knownIds.has(item.id),
  );
  if (additions.length === 0) {
    console.log("clauders: no new pass=true items.");
    return 0;
  }
  await writeJsonAtomically(nodesPath, [...nodes, ...additions]);
  console.log(`clauders: appended ${additions.length} nodes: ${additions.map((item) => item.id).join(", ")}`);
  return additions.length;
}

async function mergePlaces() {
  const items = await readJsonIfExists(`${stagingDirectory}/places.json`);
  const verdicts = await readJsonIfExists(`${stagingDirectory}/places.verdicts.json`);
  if (!items || !verdicts) {
    console.log("places: staging file or verdicts file missing, nothing merged.");
    return 0;
  }
  const passing = passingIds(verdicts);
  const places = itemsOf(items, ["items", "places"]).filter((item) => passing.has(item.id));
  await writeJsonAtomically(placesPath, places);
  console.log(`places: wrote ${places.length} places to data/places.json`);
  return places.length;
}

async function main() {
  const newNodeCount = await mergeClauders();
  await mergePlaces();
  if (newNodeCount > 0) console.log("Next: npm run tts, then node scripts/build-kb.mjs");
}

main().catch((error) => {
  console.error(`merge-staging failed: ${error.message}`);
  process.exitCode = 1;
});
