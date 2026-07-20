import type { SynthesizeOutcome, TtsProvider } from "./types";

/**
 * Deterministic in-process provider for tests (AINEXT_TTS_MOCK=1).
 *
 * Returns a tiny but structurally valid silent MP3 so the whole path can be
 * exercised — route returns audio/mpeg, disk cache writes then hits, the client
 * <audio> element loads it — with no real key and no network. Output is
 * byte-stable so the cache key is stable across identical requests.
 *
 * Never wired in unless the env flag is set; real behavior is untouched.
 */

/** Build N frames of a valid MPEG-1 Layer III 128kbps/44.1kHz silent stream. */
function silentMp3(frames: number): ArrayBuffer {
  const FRAME_LEN = 417; // floor(144 * 128000 / 44100)
  const bytes = new Uint8Array(FRAME_LEN * frames);
  for (let f = 0; f < frames; f++) {
    const off = f * FRAME_LEN;
    // Frame header: sync + MPEG1 + Layer3 + no-CRC, 128kbps, 44.1kHz, stereo.
    bytes[off] = 0xff;
    bytes[off + 1] = 0xfb;
    bytes[off + 2] = 0x90;
    bytes[off + 3] = 0x00;
    // Remaining bytes stay zero (silence).
  }
  return bytes.buffer;
}

const AUDIO = silentMp3(8);

export function makeMockProvider(): TtsProvider {
  return {
    id: "mock",
    async synthesize(): Promise<SynthesizeOutcome> {
      return {
        ok: true,
        result: { audio: AUDIO.slice(0), contentType: "audio/mpeg" },
      };
    },
  };
}
