import { makeElevenLabsProvider } from "./elevenlabs";
import { makeOpenAiProvider } from "./openai";
import { makeMockProvider } from "./mock";
import type { TtsProvider } from "./types";

export type { SynthesizeOpts, SynthesizeResult, TtsProvider } from "./types";

/** Resolved server-side TTS configuration, derived once from the environment. */
export interface TtsConfig {
  /** The active provider, or null when we should fall back to Web Speech. */
  provider: TtsProvider | null;
  voiceId: string;
  model: string;
  /** Human-readable provider name for cache namespacing / logs. */
  providerName: string;
}

// Per-provider defaults (all overridable via env).
const OPENAI_DEFAULT_VOICE = "nova"; // warm, friendly English
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini-tts"; // steerable, natural
const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // "Rachel"
const ELEVEN_DEFAULT_MODEL = "eleven_turbo_v2_5";

/**
 * Select the TTS provider from env.
 *
 *   AINEXT_TTS_PROVIDER = openai | elevenlabs | webspeech
 *     default: openai if OPENAI_API_KEY set, else elevenlabs if
 *     ELEVENLABS_API_KEY set, else webspeech.
 *
 * `webspeech` (or no usable key) yields provider:null → the route returns 501
 * { fallback: "webspeech" } and the client speaks locally. Never throws.
 *
 * AINEXT_TTS_MOCK=1 swaps in a deterministic in-process provider (tiny valid
 * mp3) to exercise the with-key path in tests without a real key or network.
 */
export function getTtsConfig(): TtsConfig {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();
  const requested = process.env.AINEXT_TTS_PROVIDER?.trim().toLowerCase();
  const provider =
    requested || (openaiKey ? "openai" : elevenKey ? "elevenlabs" : "webspeech");

  if (process.env.AINEXT_TTS_MOCK === "1") {
    return {
      provider: makeMockProvider(),
      voiceId: "mock",
      model: "mock",
      providerName: "mock",
    };
  }

  if (provider === "openai" && openaiKey) {
    return {
      provider: makeOpenAiProvider(openaiKey),
      voiceId: process.env.OPENAI_TTS_VOICE?.trim() || OPENAI_DEFAULT_VOICE,
      model: process.env.OPENAI_TTS_MODEL?.trim() || OPENAI_DEFAULT_MODEL,
      providerName: "openai",
    };
  }

  if (provider === "elevenlabs" && elevenKey) {
    return {
      provider: makeElevenLabsProvider(elevenKey),
      voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || ELEVEN_DEFAULT_VOICE,
      model: process.env.ELEVENLABS_MODEL?.trim() || ELEVEN_DEFAULT_MODEL,
      providerName: "elevenlabs",
    };
  }

  // webspeech, or a provider requested without its key → fall back.
  return {
    provider: null,
    voiceId: "webspeech",
    model: "webspeech",
    providerName: "webspeech",
  };
}
