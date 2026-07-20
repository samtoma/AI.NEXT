import type { SynthesizeOpts, SynthesizeOutcome, TtsProvider } from "./types";

/**
 * ElevenLabs REST provider (non-streaming).
 *
 * POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 *   header xi-api-key: <key>
 *   json   { text, model_id, voice_settings: { stability, similarity_boost } }
 *   -> audio/mpeg (mp3 bytes)
 *
 * Failures (missing key, non-200, network) come back as a structured
 * { ok:false } outcome — the route degrades to the Web Speech fallback rather
 * than throwing to the client.
 */

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const TIMEOUT_MS = 20_000;

export function makeElevenLabsProvider(apiKey: string): TtsProvider {
  return {
    id: "elevenlabs",
    async synthesize(
      text: string,
      opts: SynthesizeOpts
    ): Promise<SynthesizeOutcome> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(
          `${ENDPOINT}/${encodeURIComponent(opts.voiceId)}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text,
              model_id: opts.model,
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
            signal: controller.signal,
          }
        );

        if (!res.ok) {
          // ElevenLabs returns JSON error bodies; surface a short tail only.
          let detail = "";
          try {
            detail = (await res.text()).slice(0, 300);
          } catch {
            /* ignore */
          }
          return {
            ok: false,
            status: res.status,
            error: `elevenlabs ${res.status}: ${detail || res.statusText}`,
          };
        }

        const audio = await res.arrayBuffer();
        if (audio.byteLength === 0) {
          return { ok: false, status: 502, error: "elevenlabs: empty audio" };
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
        return { ok: false, status: 502, error: `elevenlabs fetch: ${msg}` };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
