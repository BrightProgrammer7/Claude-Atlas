// Listens once and returns the transcript. Azure Speech is preferred (token from
// /api/speech-token); when the server has no Azure key or the SDK cannot start, the
// browser's own Web Speech API takes over so the mic button still works.

import {
  discardAzureCredentials,
  fetchAzureCredentials,
  type AzureCredentials,
} from "./azure-speech-token";

export type SpeechEngine = "azure" | "browser";

export type VoiceInputFailure = "unsupported" | "denied" | "no-speech" | "cancelled" | "failed";

export class VoiceInputError extends Error {
  readonly failure: VoiceInputFailure;

  constructor(failure: VoiceInputFailure, message: string) {
    super(message);
    this.failure = failure;
  }
}

export type ListenSession = {
  result: Promise<{ text: string; engine: SpeechEngine; language: SpokenLanguage }>;
  cancel: () => void;
};

// Azure picks among these per utterance, so a French or Moroccan Arabic question needs no
// language switch. The browser fallback cannot do this and listens for English.
const AZURE_CANDIDATE_LANGUAGES = ["en-US", "fr-FR", "ar-MA"];
const BROWSER_FALLBACK_LANGUAGE = "en-US";

export type SpokenLanguage = "en" | "fr" | "ar";

const toSpokenLanguage = (azureLanguageTag: string | undefined): SpokenLanguage =>
  azureLanguageTag?.startsWith("fr") ? "fr" : azureLanguageTag?.startsWith("ar") ? "ar" : "en";

async function recognizeWithAzure(
  credentials: AzureCredentials,
  registerCancel: (cancel: () => void) => void,
): Promise<{ text: string; language: SpokenLanguage }> {
  const sdk = await import("microsoft-cognitiveservices-speech-sdk");

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(credentials.token, credentials.region);
  const recognizer = sdk.SpeechRecognizer.FromConfig(
    speechConfig,
    sdk.AutoDetectSourceLanguageConfig.fromLanguages(AZURE_CANDIDATE_LANGUAGES),
    sdk.AudioConfig.fromDefaultMicrophoneInput(),
  );

  return new Promise((resolve, reject) => {
    registerCancel(() => {
      recognizer.close();
      reject(new VoiceInputError("cancelled", "Listening was cancelled."));
    });

    recognizer.recognizeOnceAsync(
      (result) => {
        recognizer.close();
        if (result.reason === sdk.ResultReason.RecognizedSpeech && result.text.trim()) {
          resolve({
            text: result.text,
            language: toSpokenLanguage(sdk.AutoDetectSourceLanguageResult.fromResult(result).language),
          });
        } else if (result.reason === sdk.ResultReason.NoMatch) {
          reject(new VoiceInputError("no-speech", "No speech was recognised."));
        } else {
          const details = sdk.CancellationDetails.fromResult(result).errorDetails ?? "";
          reject(
            /permission|notallowed|denied/i.test(details)
              ? new VoiceInputError("denied", "Microphone access was denied.")
              : new VoiceInputError("failed", "Azure speech recognition failed."),
          );
        }
      },
      () => {
        recognizer.close();
        reject(new VoiceInputError("failed", "Azure speech recognition failed."));
      },
    );
  });
}

// The Web Speech API is missing from TypeScript's DOM typings, so only the surface used
// here is declared.
type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

type BrowserRecognitionConstructor = new () => BrowserRecognition;

function recognizeWithBrowser(registerCancel: (cancel: () => void) => void): Promise<string> {
  const speechWindow = window as unknown as {
    SpeechRecognition?: BrowserRecognitionConstructor;
    webkitSpeechRecognition?: BrowserRecognitionConstructor;
  };
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) {
    return Promise.reject(
      new VoiceInputError("unsupported", "Voice input is not supported in this browser."),
    );
  }

  return new Promise<string>((resolve, reject) => {
    const recognition = new Recognition();
    recognition.lang = BROWSER_FALLBACK_LANGUAGE;
    recognition.continuous = false;
    recognition.interimResults = false;

    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      finish();
    };

    registerCancel(() => {
      recognition.abort();
      settle(() => reject(new VoiceInputError("cancelled", "Listening was cancelled.")));
    });

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
      settle(() =>
        transcript
          ? resolve(transcript)
          : reject(new VoiceInputError("no-speech", "No speech was recognised.")),
      );
    };
    recognition.onerror = (event) => {
      settle(() => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          reject(new VoiceInputError("denied", "Microphone access was denied."));
        } else if (event.error === "no-speech") {
          reject(new VoiceInputError("no-speech", "No speech was recognised."));
        } else if (event.error === "aborted") {
          reject(new VoiceInputError("cancelled", "Listening was cancelled."));
        } else {
          reject(new VoiceInputError("failed", "Browser speech recognition failed."));
        }
      });
    };
    recognition.onend = () => {
      settle(() => reject(new VoiceInputError("no-speech", "No speech was recognised.")));
    };

    recognition.start();
  });
}

export function startListening(): ListenSession {
  let cancelActiveEngine: () => void = () => {};
  let wasCancelled = false;

  const result = (async () => {
    const credentials = await fetchAzureCredentials();
    if (wasCancelled) throw new VoiceInputError("cancelled", "Listening was cancelled.");

    if (credentials) {
      try {
        const { text, language } = await recognizeWithAzure(credentials, (cancel) => {
          cancelActiveEngine = cancel;
        });
        return { text, language, engine: "azure" as const };
      } catch (error) {
        const isFinalAnswer =
          error instanceof VoiceInputError && error.failure !== "failed" && error.failure !== "unsupported";
        if (isFinalAnswer || wasCancelled) throw error;
        // The token or SDK failed before any answer, so fall through to the browser engine.
        discardAzureCredentials();
      }
    }

    const text = await recognizeWithBrowser((cancel) => {
      cancelActiveEngine = cancel;
    });
    return { text, language: "en" as const, engine: "browser" as const };
  })();

  return {
    result,
    cancel: () => {
      wasCancelled = true;
      cancelActiveEngine();
    },
  };
}
