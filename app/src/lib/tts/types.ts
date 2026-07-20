/**
 * Provider-abstracted neural TTS — server-only contract.
 *
 * v1 is non-streaming: a provider takes cleaned text and returns the full
 * audio buffer + its content type. Non-streaming keeps the route cache-friendly
 * (one hash → one mp3 on disk) and the client trivial (one <audio> src).
 */

export interface SynthesizeOpts {
  /** Voice identifier, provider-specific (e.g. an ElevenLabs voice_id). */
  voiceId: string;
  /** Model identifier, provider-specific (e.g. eleven_turbo_v2_5). */
  model: string;
}

export interface SynthesizeResult {
  audio: ArrayBuffer;
  contentType: string;
}

/**
 * A provider either synthesizes audio or reports a structured, non-throwing
 * failure. Route code turns `ok:false` into a graceful client-facing status —
 * it must never surface as a 500.
 */
export type SynthesizeOutcome =
  | { ok: true; result: SynthesizeResult }
  | { ok: false; status: number; error: string };

export interface TtsProvider {
  /** Stable id for cache-key namespacing and logging. */
  readonly id: string;
  synthesize(text: string, opts: SynthesizeOpts): Promise<SynthesizeOutcome>;
}
