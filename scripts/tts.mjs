// Generates one narration MP3 per node: public/audio/<safe-id>.mp3.
//
// Run locally with `npm run tts`. The MP3s ship as static files, so no TTS key is
// ever deployed. Provider: ElevenLabs if an ElevenLabs key is set in the local
// environment, otherwise Fish Audio. Only environment variable NAMES are ever
// printed, never values.
//
// Flags: --force (regenerate existing files), --dry-run (print spoken text only),
//        --provider=elevenlabs|fish (override the automatic choice).
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { safeAudioId } from "../lib/node-audio.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nodesPath = `${projectRoot}data/nodes.json`;
const audioDirectory = `${projectRoot}public/audio`;

const ELEVENLABS_KEY_NAMES = [
  "ELEVENLABS_API_KEY",
  "ELEVEN_LABS_API_KEY",
  "ELEVENLABS_KEY",
  "ELEVEN_API_KEY",
  "XI_API_KEY",
];
const FISH_KEY_NAMES = ["FISH_AUDIO_API_KEY", "FISH_API_KEY", "FISH_AUDIO_KEY"];

// "George" is a premade ElevenLabs voice, so it needs no Voice Library access.
const DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 60_000;

const flags = new Set(process.argv.slice(2));
const providerOverride = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--provider="))
  ?.split("=")[1];

function findConfiguredKey(candidateNames) {
  for (const name of candidateNames) {
    const value = process.env[name];
    if (value) return { name, value };
  }
  return null;
}

function chooseProvider() {
  const elevenLabsKey = findConfiguredKey(ELEVENLABS_KEY_NAMES);
  const fishKey = findConfiguredKey(FISH_KEY_NAMES);

  if (providerOverride === "elevenlabs" && !elevenLabsKey) {
    throw new Error(`--provider=elevenlabs but none of ${ELEVENLABS_KEY_NAMES.join(", ")} is set`);
  }
  if (providerOverride === "fish" && !fishKey) {
    throw new Error(`--provider=fish but none of ${FISH_KEY_NAMES.join(", ")} is set`);
  }

  if (providerOverride ? providerOverride === "elevenlabs" : elevenLabsKey) {
    return { name: "elevenlabs", key: elevenLabsKey };
  }
  if (fishKey) return { name: "fish", key: fishKey };

  throw new Error(
    `No TTS key found. Set one of ${[...ELEVENLABS_KEY_NAMES, ...FISH_KEY_NAMES].join(", ")} in your local environment.`,
  );
}

// "<Month D, YYYY>. <title>." The " | Anthropic" site suffix is dropped from the
// speech only; the on-screen title stays verbatim.
function spokenTextFor(node) {
  const [year, month, day] = node.date.split("-").map(Number);
  const spokenTitle = node.title.replace(/\s*\|\s*Anthropic\s*$/, "");
  const endsWithPunctuation = /[.!?]$/.test(spokenTitle);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}. ${spokenTitle}${endsWithPunctuation ? "" : "."}`;
}

class SynthesisError extends Error {
  constructor(message, { retryable }) {
    super(message);
    this.retryable = retryable;
  }
}

async function requestAudio(provider, spokenText) {
  const request =
    provider.name === "elevenlabs"
      ? {
          url: `https://api.elevenlabs.io/v1/text-to-speech/${
            process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID
          }?output_format=mp3_44100_128`,
          headers: { "xi-api-key": provider.key.value, Accept: "audio/mpeg" },
          body: {
            text: spokenText,
            model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL_ID,
          },
        }
      : {
          url: "https://api.fish.audio/v1/tts",
          headers: { Authorization: `Bearer ${provider.key.value}`, model: "s2-pro" },
          body: {
            text: spokenText,
            format: "mp3",
            mp3_bitrate: 128,
            latency: "normal",
            // Without a reference voice Fish Audio uses its default voice.
            ...(process.env.FISH_AUDIO_REFERENCE_ID
              ? { reference_id: process.env.FISH_AUDIO_REFERENCE_ID }
              : {}),
          },
        };

  let response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SynthesisError(`network error: ${error.name}`, { retryable: true });
  }

  if (!response.ok) {
    const errorBody = (await response.text()).replaceAll(provider.key.value, "[redacted]");
    const retryable = response.status === 429 || response.status >= 500;
    throw new SynthesisError(`HTTP ${response.status} ${errorBody.slice(0, 300)}`, { retryable });
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1000) {
    throw new SynthesisError(`suspiciously small audio (${audio.length} bytes)`, { retryable: false });
  }
  return audio;
}

async function requestAudioWithRetries(provider, spokenText) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestAudio(provider, spokenText);
    } catch (error) {
      if (!(error instanceof SynthesisError) || !error.retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      const backoffMs = 1500 * 2 ** (attempt - 1);
      console.warn(`  attempt ${attempt} failed (${error.message}); retrying in ${backoffMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

async function fileExistsNonEmpty(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function main() {
  const nodes = JSON.parse(await readFile(nodesPath, "utf8"));

  const nodeIdBySafeId = new Map();
  for (const node of nodes) {
    const safeId = safeAudioId(node.id);
    if (nodeIdBySafeId.has(safeId)) {
      throw new Error(`Audio file name collision: "${node.id}" and "${nodeIdBySafeId.get(safeId)}"`);
    }
    nodeIdBySafeId.set(safeId, node.id);
  }

  if (flags.has("--dry-run")) {
    for (const node of nodes) console.log(`${safeAudioId(node.id)}: ${spokenTextFor(node)}`);
    return;
  }

  const provider = chooseProvider();
  console.log(`TTS provider: ${provider.name} (key from ${provider.key.name})`);
  await mkdir(audioDirectory, { recursive: true });

  let generated = 0;
  let skipped = 0;
  for (const [index, node] of nodes.entries()) {
    const safeId = safeAudioId(node.id);
    const outputPath = `${audioDirectory}/${safeId}.mp3`;
    const position = `[${index + 1}/${nodes.length}]`;

    if (!flags.has("--force") && (await fileExistsNonEmpty(outputPath))) {
      skipped += 1;
      console.log(`${position} ${safeId}.mp3 exists, skipped`);
      continue;
    }

    const audio = await requestAudioWithRetries(provider, spokenTextFor(node));
    await writeFile(outputPath, audio);
    generated += 1;
    console.log(`${position} ${safeId}.mp3 ${(audio.length / 1024).toFixed(1)} KB`);
  }

  console.log(`Done: ${generated} generated, ${skipped} skipped, ${nodes.length} nodes.`);
}

main().catch((error) => {
  console.error(`tts failed: ${error.message}`);
  process.exitCode = 1;
});
