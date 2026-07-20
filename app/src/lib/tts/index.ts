import { makeElevenLabsProvider } from "./elevenlabs";
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

// ElevenLabs' default "Rachel" — a natural English voice. Overridable.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
// Low-latency, multilingual-capable (so Arabic works when we add it later).
const DEFAULT_MODEL = "eleven_turbo_v2_5";

/**
 * Select the TTS provider from env.
 *
 *   AINEXT_TTS_PROVIDER = elevenlabs | webspeech
 *     default: elevenlabs if ELEVENLABS_API_KEY is set, else webspeech
 *
 * `webspeech` (or a missing key) yields provider:null → the route returns 501
 * { fallback: "webspeech" } and the client speaks locally. Never throws.
 *
 * AINEXT_TTS_MOCK=1 swaps in a deterministic in-process provider that returns a
 * tiny valid mp3 — used only to exercise the with-key path in tests without a
 * real key or network. Guard is off by default, so real behavior is unchanged.
 */
export function getTtsConfig(): TtsConfig {
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
  const model = process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_MODEL;

  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const requested = process.env.AINEXT_TTS_PROVIDER?.trim().toLowerCase();
  const provider = requested || (key ? "elevenlabs" : "webspeech");

  if (process.env.AINEXT_TTS_MOCK === "1") {
    return {
      provider: makeMockProvider(),
      voiceId,
      model,
      providerName: "mock",
    };
  }

  if (provider === "elevenlabs" && key) {
    return {
      provider: makeElevenLabsProvider(key),
      voiceId,
      model,
      providerName: "elevenlabs",
    };
  }

  // webspeech, or elevenlabs requested without a key → fall back.
  return { provider: null, voiceId, model, providerName: "webspeech" };
}
