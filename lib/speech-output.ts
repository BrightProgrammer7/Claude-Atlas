// Speaks an answer sentence by sentence while it is still streaming in. Azure neural
// text-to-speech is preferred (same short-lived token as speech recognition); when Azure is
// not available the browser's own speech synthesis takes over.
import { discardAzureCredentials, fetchAzureCredentials } from "./azure-speech-token";
import type { SpokenLanguage } from "./speech-recognition";

const VOICE_BY_LANGUAGE: Record<SpokenLanguage, { name: string; locale: string }> = {
  en: { name: "en-US-JennyNeural", locale: "en-US" },
  fr: { name: "fr-FR-DeniseNeural", locale: "fr-FR" },
  ar: { name: "ar-MA-MounaNeural", locale: "ar-MA" },
};

const ARABIC_LETTER = /[؀-ۿ]/;
const FRENCH_MARKERS =
  /\b(le|la|les|des|du|est|une|un|et|que|qui|dans|pour|sur|avec|pas|au|aux|sont|il|elle|nous|vous|ce|cette|ses|son|par|plus|ont|été)\b|[àâçéèêëîïôùûœ]/gi;
const ENGLISH_MARKERS = /\b(the|is|and|of|to|in|that|for|with|was|has|are|it|this|on|as|by|its|at|an)\b/gi;

// The answer follows the question's language, so the voice follows the answer's text.
export function detectLanguage(text: string): SpokenLanguage {
  if (ARABIC_LETTER.test(text)) return "ar";
  const frenchHits = text.match(FRENCH_MARKERS)?.length ?? 0;
  const englishHits = text.match(ENGLISH_MARKERS)?.length ?? 0;
  return frenchHits > englishHits ? "fr" : "en";
}

// Citations like [claude-3-family] are for the eye; they are never read aloud.
export const stripCitations = (text: string) =>
  text.replace(/\s*\[[^\]]*\]/g, "").replace(/\s+([.,;:!?؟])/g, "$1").trim();

const escapeXml = (text: string) =>
  text.replace(/[<>&'"]/g, (character) => `&#${character.charCodeAt(0)};`);

// SpeechSynthesisResult.reason value for a finished synthesis (ResultReason.SynthesizingAudioCompleted).
const SYNTHESIS_COMPLETED = 8;

// Playing this once inside a tap unlocks the audio element on iOS Safari, which otherwise
// refuses audio started later from a streamed answer instead of a tap.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

export type SpeechOutput = {
  // Call from a tap or click handler.
  unlock: () => void;
  speak: (sentence: string) => void;
  // Resolves once everything queued so far has been spoken (or stopped).
  whenIdle: () => Promise<void>;
  stop: () => void;
};

type Synthesizer = import("microsoft-cognitiveservices-speech-sdk").SpeechSynthesizer;

export function createSpeechOutput(onSpeakingChange: (isSpeaking: boolean) => void): SpeechOutput {
  // Created inside the tap or click that starts a question, which lets playback begin later.
  const audioElement = new Audio();
  let generation = 0;
  let queueTail: Promise<void> = Promise.resolve();
  let queuedCount = 0;
  let synthesizerPromise: Promise<Synthesizer | null> | null = null;
  let endCurrentPlayback: (() => void) | null = null;

  function getSynthesizer(): Promise<Synthesizer | null> {
    synthesizerPromise ??= (async () => {
      const credentials = await fetchAzureCredentials();
      if (!credentials) return null;
      try {
        const sdk = await import("microsoft-cognitiveservices-speech-sdk");
        const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(credentials.token, credentials.region);
        speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
        // A null audio config keeps the audio in memory so this module controls playback and Stop.
        return new sdk.SpeechSynthesizer(speechConfig, null as never);
      } catch {
        discardAzureCredentials();
        return null;
      }
    })();
    return synthesizerPromise;
  }

  async function synthesizeWithAzure(sentence: string, language: SpokenLanguage): Promise<Blob | null> {
    const synthesizer = await getSynthesizer();
    if (!synthesizer) return null;
    const voice = VOICE_BY_LANGUAGE[language];
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.locale}">` +
      `<voice name="${voice.name}">${escapeXml(sentence)}</voice></speak>`;
    return new Promise((resolve) => {
      synthesizer.speakSsmlAsync(
        ssml,
        (result) => {
          const hasAudio = result.reason === SYNTHESIS_COMPLETED && result.audioData.byteLength > 0;
          resolve(hasAudio ? new Blob([result.audioData], { type: "audio/mpeg" }) : null);
        },
        () => resolve(null),
      );
    });
  }

  function playBlob(blob: Blob, runGeneration: number): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const finish = () => {
        audioElement.onended = null;
        audioElement.onerror = null;
        endCurrentPlayback = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      if (runGeneration !== generation) return finish();
      endCurrentPlayback = finish;
      audioElement.onended = finish;
      audioElement.onerror = finish;
      audioElement.src = url;
      audioElement.play().catch(finish);
    });
  }

  function speakWithBrowser(sentence: string, language: SpokenLanguage, runGeneration: number): Promise<void> {
    return new Promise((resolve) => {
      if (runGeneration !== generation || typeof speechSynthesis === "undefined") return resolve();
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = VOICE_BY_LANGUAGE[language].locale;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  }

  function speak(rawSentence: string) {
    const sentence = stripCitations(rawSentence);
    if (!sentence) return;
    const language = detectLanguage(sentence);
    const runGeneration = generation;

    // Synthesis starts at once so the next sentence is ready by the time the current one ends.
    const audioPromise = synthesizeWithAzure(sentence, language);

    queuedCount += 1;
    onSpeakingChange(true);
    queueTail = queueTail.then(async () => {
      if (runGeneration === generation) {
        const blob = await audioPromise;
        if (runGeneration === generation) {
          if (blob) await playBlob(blob, runGeneration);
          else await speakWithBrowser(sentence, language, runGeneration);
        }
      }
      queuedCount -= 1;
      if (queuedCount === 0) onSpeakingChange(false);
    });
  }

  function unlock() {
    if (audioElement.currentSrc || queuedCount > 0) return;
    audioElement.muted = true;
    audioElement.src = SILENT_WAV;
    void audioElement
      .play()
      .then(() => audioElement.pause())
      .catch(() => undefined)
      .finally(() => {
        audioElement.muted = false;
        audioElement.removeAttribute("src");
      });
  }

  function stop() {
    generation += 1;
    endCurrentPlayback?.();
    audioElement.pause();
    audioElement.removeAttribute("src");
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  return { unlock, speak, whenIdle: () => queueTail, stop };
}

// Cuts finished sentences out of streamed text. A sentence ends at . ! ? or the Arabic
// question mark followed by whitespace, so "3.5" mid-stream is safe, and a trailing citation
// before the full stop stays inside its sentence.
const SENTENCE_END = /[.!?؟](?:["”»)]*)\s+/;

export function createSentenceSplitter(onSentence: (sentence: string) => void) {
  let pending = "";

  return {
    push(text: string) {
      pending += text;
      for (let match = pending.match(SENTENCE_END); match; match = pending.match(SENTENCE_END)) {
        const end = (match.index ?? 0) + match[0].length;
        const sentence = pending.slice(0, end).trim();
        pending = pending.slice(end);
        if (sentence) onSentence(sentence);
      }
    },
    flush() {
      const sentence = pending.trim();
      pending = "";
      if (sentence) onSentence(sentence);
    },
  };
}
