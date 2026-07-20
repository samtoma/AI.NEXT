import type { SynthesizeOpts, SynthesizeOutcome, TtsProvider } from "./types";

/**
 * OpenAI TTS provider (non-streaming).
 *
 * POST https://api.openai.com/v1/audio/speech
 *   header Authorization: Bearer <key>
 *   json   { model, voice, input, response_format: "mp3", instructions? }
 *   -> audio/mpeg (mp3 bytes)
 *
 * No voice-tier restriction (unlike ElevenLabs free tier): any of the standard
 * voices work with any key. `gpt-4o-mini-tts` also accepts an `instructions`
 * field to steer tone — we nudge it toward a warm, encouraging tutor.
 *
 * Failures come back as a structured { ok:false } outcome so the route degrades
 * to the Web Speech fallback rather than throwing to the client.
 */

const ENDPOINT = "https://api.openai.com/v1/audio/speech";
const TIMEOUT_MS = 20_000;

const TUTOR_INSTRUCTIONS =
  "Speak like a warm, patient private tutor talking to a teenager: friendly, " +
  "encouraging, unhurried, with natural intonation. Not robotic, not overly formal.";

export function makeOpenAiProvider(apiKey: string): TtsProvider {
  return {
    id: "openai",
    async synthesize(
      text: string,
      opts: SynthesizeOpts
    ): Promise<SynthesizeOutcome> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const body: Record<string, unknown> = {
          model: opts.model,
          voice: opts.voiceId,
          input: text,
          response_format: "mp3",
        };
        // Tone steering is only supported on the gpt-4o-mini-tts family.
        if (opts.model.includes("gpt-4o")) body.instructions = TUTOR_INSTRUCTIONS;

        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          let detail = "";
          try {
            detail = (await res.text()).slice(0, 300);
          } catch {
            /* ignore */
          }
          return {
            ok: false,
            status: res.status,
            error: `openai ${res.status}: ${detail || res.statusText}`,
          };
        }

        const audio = await res.arrayBuffer();
        if (audio.byteLength === 0) {
          return { ok: false, status: 502, error: "openai: empty audio" };
        }
        return {
          ok: true,
          result: {
            audio,
            contentType: res.headers.get("content-type") ?? "audio/mpeg",
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, status: 502, error: `openai fetch: ${msg}` };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
