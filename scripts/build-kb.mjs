// Builds the knowledge base the voice agent answers questions from.
//
// For every node in data/nodes.json: download its page (raw HTML cached under
// data/snapshots/), extract the main article text, and write the first 2,500 characters to
// data/sources/<id>.txt. Then write data/kb.json: one entry per node (metadata plus a
// 1,200-character excerpt), then the entries of data/critic.json (RSP policy nodes and critic
// nodes, with the verbatim quote as excerpt), then the entries of data/beliefs.json (belief, verdict and the
// corrected statement, copied verbatim), then the entries of data/places.json when it exists.
//
// Usage: node scripts/build-kb.mjs [--refresh]
//   --refresh  download every page again instead of reusing data/snapshots/
//
// Node standard library only. Re-running without --refresh is offline and fast, so it is the
// loop to use while tuning the extraction or after data/places.json changes.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nodesPath = `${projectRoot}data/nodes.json`;
const placesPath = `${projectRoot}data/places.json`;
const beliefsPath = `${projectRoot}data/beliefs.json`;
const criticPath = `${projectRoot}data/critic.json`;
const snapshotsDirectory = `${projectRoot}data/snapshots`;
const sourcesDirectory = `${projectRoot}data/sources`;
const knowledgeBasePath = `${projectRoot}data/kb.json`;

const SOURCE_TEXT_CHARACTERS = 2500;
const EXCERPT_CHARACTERS = 1200;
// Below this the extraction caught a page shell or error page, not an article.
const MIN_USABLE_TEXT_CHARACTERS = 200;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const shouldRefresh = process.argv.includes("--refresh");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fileNameForNode = (nodeId) => nodeId.replaceAll("/", "__");

// A reader of these files must never see a half-written one.
async function writeFileAtomically(path, content) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, path);
}

async function readFileIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------------------------

async function downloadHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": BROWSER_USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        // Also bounds reading the body, not just the connection.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status}`);
      // A 404 or 403 will not change on retry; rate limiting and server errors might.
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * attempt);
  }
  throw lastError;
}

async function loadHtml(node) {
  const snapshotPath = `${snapshotsDirectory}/${fileNameForNode(node.id)}.html`;
  if (!shouldRefresh) {
    const cachedHtml = await readFileIfExists(snapshotPath);
    if (cachedHtml) return { html: cachedHtml, origin: "cache" };
  }
  const html = await downloadHtml(node.url);
  await writeFileAtomically(snapshotPath, html);
  return { html, origin: "network" };
}

// ---------------------------------------------------------------------------------------------
// HTML -> text. A small tree builder rather than regexes: the containers we care about
// (<article>, <header>, <aside>) nest, and a non-greedy regex closes them at the wrong tag.
// ---------------------------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
  "source", "track", "wbr",
]);

// Their content is code or CSS, so a "<" inside is not markup and must not be parsed as such.
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

// Subtrees that are never article prose.
const DROPPED_ELEMENTS = new Set([
  "nav", "header", "footer", "aside", "script", "style", "noscript", "template", "svg",
  "form", "button", "iframe",
]);

// Words on either side of these must not be glued together once the tags are gone.
const BLOCK_ELEMENTS = new Set([
  "address", "article", "blockquote", "br", "dd", "details", "div", "dl", "dt", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "main", "ol", "p", "pre",
  "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

// Sticky patterns match only at the index we set, so each "<" is classified in place.
const START_TAG_PATTERN = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
const END_TAG_PATTERN = /<\/([a-zA-Z][^\s>]*)[^>]*>/y;

function parseHtml(html) {
  const documentRoot = { tag: "#document", attributes: "", children: [], parent: null };
  let openElement = documentRoot;
  let position = 0;

  while (position < html.length) {
    const tagStart = html.indexOf("<", position);
    if (tagStart === -1) {
      openElement.children.push(html.slice(position));
      break;
    }
    if (tagStart > position) openElement.children.push(html.slice(position, tagStart));

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      position = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }
    const nextCharacter = html[tagStart + 1];
    if (nextCharacter === "!" || nextCharacter === "?") {
      // Doctype, CDATA or processing instruction: nothing readable inside.
      const declarationEnd = html.indexOf(">", tagStart);
      position = declarationEnd === -1 ? html.length : declarationEnd + 1;
      continue;
    }

    END_TAG_PATTERN.lastIndex = tagStart;
    const endTag = END_TAG_PATTERN.exec(html);
    if (endTag) {
      const closedTag = endTag[1].toLowerCase();
      for (let candidate = openElement; candidate.parent; candidate = candidate.parent) {
        if (candidate.tag === closedTag) {
          openElement = candidate.parent;
          break;
        }
      }
      // An end tag matching nothing that is open is stray markup and is ignored.
      position = tagStart + endTag[0].length;
      continue;
    }

    START_TAG_PATTERN.lastIndex = tagStart;
    const startTag = START_TAG_PATTERN.exec(html);
    if (!startTag) {
      // A literal "<" in running text, such as "a < b".
      openElement.children.push("<");
      position = tagStart + 1;
      continue;
    }

    const tag = startTag[1].toLowerCase();
    const attributes = startTag[2];
    const element = { tag, attributes, children: [], parent: openElement };
    openElement.children.push(element);
    position = tagStart + startTag[0].length;

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      const closingTagPattern = new RegExp(`</${tag}\\s*>`, "gi");
      closingTagPattern.lastIndex = position;
      const closingTag = closingTagPattern.exec(html);
      position = closingTag ? closingTag.index + closingTag[0].length : html.length;
    } else if (!VOID_ELEMENTS.has(tag) && !attributes.trimEnd().endsWith("/")) {
      openElement = element;
    }
  }
  return documentRoot;
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  shy: "", zwj: "", zwnj: "",
  ndash: "–", mdash: "—", minus: "−",
  lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", hellip: "…", bull: "•", middot: "·",
  copy: "©", reg: "®", trade: "™", deg: "°", plusmn: "±",
  times: "×", divide: "÷", sect: "§", para: "¶",
  euro: "€", pound: "£", yen: "¥", cent: "¢",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓",
};

const ENTITY_PATTERN = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));/gi;

// One pass over the text, so "&amp;lt;" correctly becomes "&lt;" and not "<". Names are
// case-sensitive in HTML and looked up as own properties only, so "&constructor;" stays
// as typed. Names missing from the table are left untouched, which keeps them visible.
function decodeHtmlEntities(text) {
  return text.replace(ENTITY_PATTERN, (entity, hexadecimal, decimal, name) => {
    if (name !== undefined) {
      return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : entity;
    }
    const codePoint = hexadecimal !== undefined ? parseInt(hexadecimal, 16) : parseInt(decimal, 10);
    const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    return codePoint > 0 && codePoint <= 0x10ffff && !isSurrogate
      ? String.fromCodePoint(codePoint)
      : "�";
  });
}

function collectText(element, fragments) {
  for (const child of element.children) {
    if (typeof child === "string") {
      fragments.push(decodeHtmlEntities(child));
      continue;
    }
    if (DROPPED_ELEMENTS.has(child.tag)) continue;
    const isBlock = BLOCK_ELEMENTS.has(child.tag);
    if (isBlock) fragments.push(" ");
    collectText(child, fragments);
    if (isBlock) fragments.push(" ");
  }
}

function readableText(element) {
  const fragments = [];
  collectText(element, fragments);
  return fragments.join("").replace(/\s+/g, " ").trim();
}

function findElements(root, tag, found = []) {
  for (const child of root.children) {
    if (typeof child === "string") continue;
    if (child.tag === tag) found.push(child);
    findElements(child, tag, found);
  }
  return found;
}

// <article> first, then <main>, then the whole body. A page can hold several <article>
// elements (cards for related posts), so within a tag the one with the most text wins.
function extractArticleText(html) {
  const documentRoot = parseHtml(html);
  for (const tag of ["article", "main", "body"]) {
    const longestText = findElements(documentRoot, tag)
      .map(readableText)
      .reduce((longest, text) => (text.length > longest.length ? text : longest), "");
    if (longestText.length >= MIN_USABLE_TEXT_CHARACTERS) return longestText;
  }
  return readableText(documentRoot);
}

function truncateText(text, characterLimit) {
  if (text.length <= characterLimit) return text;
  let end = characterLimit;
  // Cutting between the two halves of a surrogate pair would leave an invalid lone half.
  const lastKeptCode = text.charCodeAt(end - 1);
  if (lastKeptCode >= 0xd800 && lastKeptCode <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

// ---------------------------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------------------------

async function loadPlaceEntries() {
  const rawPlaces = await readFileIfExists(placesPath);
  if (rawPlaces === null) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawPlaces);
  } catch (error) {
    throw new Error(`${placesPath} is not valid JSON: ${error.message}`);
  }
  const places = Array.isArray(parsed) ? parsed : parsed?.places;
  if (!Array.isArray(places)) {
    throw new Error(`${placesPath} must be a JSON array of places (or an object with a "places" array)`);
  }
  return places.map((place) => ({
    id: place.id ?? null,
    kind: place.kind ?? null,
    name: place.name ?? null,
    city: place.city ?? null,
    country: place.country ?? null,
    site: place.site ?? null,
    source_url: place.source_url ?? null,
  }));
}

// Policy nodes (RSP versions, ASL activation) and critic nodes. Nothing is downloaded: the
// excerpt is the verbatim quote already stored in data/critic.json, plus who said it and which
// event it targets, so "what do critics say" is answered from the same text the timeline shows.
async function loadCriticEntries(nodeTitlesById) {
  const rawCritic = await readFileIfExists(criticPath);
  if (rawCritic === null) return [];
  const criticNodes = JSON.parse(rawCritic);
  // A critic can target an RSP node from this same file, so its title must be findable too.
  const titlesById = new Map([...nodeTitlesById, ...criticNodes.map((node) => [node.id, node.title])]);
  return criticNodes.map((node) => {
    const targetId = node.target_id ?? node.responds_to ?? null;
    const sentences = [];
    if (node.attributed_to) sentences.push(`Said by ${node.attributed_to}.`);
    if (targetId) {
      const verb = node.lane === "critic" ? "Targets" : "Replies to";
      sentences.push(`${verb} [${targetId}] ${titlesById.get(targetId) ?? ""}.`.replace(" .", "."));
    }
    sentences.push(`Quote: "${node.quote}"`);
    if (node.anthropic_url) sentences.push(`Anthropic document: ${node.anthropic_url}`);
    return {
      id: node.id,
      lane: node.lane,
      title: node.title,
      date: node.date,
      url: node.url,
      place: null,
      excerpt: sentences.join(" "),
    };
  });
}

async function loadBeliefEntries() {
  const rawBeliefs = await readFileIfExists(beliefsPath);
  if (rawBeliefs === null) return [];
  const beliefs = JSON.parse(rawBeliefs);
  return beliefs.map((belief) => ({
    id: belief.id,
    lane: "myth-check",
    title: belief.belief,
    date: null,
    url: belief.sources[0]?.url ?? null,
    place: null,
    excerpt: `Verdict: ${belief.verdict}. ${belief.corrected_statement}`,
  }));
}

async function buildSourceText(node) {
  try {
    const { html, origin } = await loadHtml(node);
    const sourceText = truncateText(extractArticleText(html), SOURCE_TEXT_CHARACTERS);
    if (sourceText.length < MIN_USABLE_TEXT_CHARACTERS) {
      console.error(`NO TEXT  ${node.id}: only ${sourceText.length} characters extracted (${origin})`);
      return "";
    }
    await writeFileAtomically(`${sourcesDirectory}/${fileNameForNode(node.id)}.txt`, sourceText);
    console.log(`ok       ${node.id}: ${sourceText.length} characters (${origin})`);
    return sourceText;
  } catch (error) {
    console.error(`FAILED   ${node.id}: ${error.message}`);
    return "";
  }
}

async function main() {
  const nodes = JSON.parse(await readFile(nodesPath, "utf8"));
  await mkdir(snapshotsDirectory, { recursive: true });
  await mkdir(sourcesDirectory, { recursive: true });

  const nodeEntries = [];
  const idsWithoutUsableText = [];
  for (const node of nodes) {
    const sourceText = await buildSourceText(node);
    if (sourceText === "") idsWithoutUsableText.push(node.id);
    nodeEntries.push({
      id: node.id,
      lane: node.lane,
      title: node.title,
      date: node.date,
      url: node.url,
      place: node.place ?? null,
      excerpt: truncateText(sourceText, EXCERPT_CHARACTERS),
    });
  }

  // Read last, so a places.json written while the pages were downloading is still picked up.
  const placeEntries = await loadPlaceEntries();
  const beliefEntries = await loadBeliefEntries();
  const criticEntries = await loadCriticEntries(new Map(nodes.map((node) => [node.id, node.title])));
  const knowledgeBase = [...nodeEntries, ...criticEntries, ...beliefEntries, ...placeEntries];
  await writeFileAtomically(knowledgeBasePath, `${JSON.stringify(knowledgeBase, null, 2)}\n`);

  console.log(
    `\nWrote ${knowledgeBase.length} entries to data/kb.json ` +
      `(${nodeEntries.length} nodes, ${criticEntries.length} policy and critic nodes, ` +
      `${beliefEntries.length} beliefs, ${placeEntries.length} places).`,
  );
  if (idsWithoutUsableText.length > 0) {
    console.log(`No usable text for ${idsWithoutUsableText.length}: ${idsWithoutUsableText.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
