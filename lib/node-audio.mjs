// One definition of "node id -> audio file", shared by scripts/tts.mjs (writes the
// files) and the UI (builds the URLs), so the two can never drift apart.

/**
 * @param {string} nodeId
 * @returns {string}
 */
export function safeAudioId(nodeId) {
  return nodeId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} nodeId
 * @returns {string}
 */
export function audioUrlForNode(nodeId) {
  return `/audio/${safeAudioId(nodeId)}.mp3`;
}
