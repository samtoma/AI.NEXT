import { NextResponse } from "next/server";
import { cacheKey, readCache, writeCache } from "@/lib/tts/cache";
import { getTtsConfig } from "@/lib/tts";
import { sanitizeForNeuralSpeech } from "@/lib/tts/sanitize";

/**
 * POST /api/tts — provider-abstracted neural speech with disk cache.
 *
 * Body: { text: string, cacheKey?: string }  (cacheKey is advisory only; the
 * real key is derived from provider|voice|model|cleanText so cache correctness
 * never depends on the client.)
 *
 * - No key / provider=webspeech → 501 { fallback: "webspeech" } (never 500).
 * - Cache hit → mp3 from disk. Miss → provider, then write-through.
 * - Provider failure → structured error status, client falls back to Web Speech.
 */

export const dynamic = "force-dynamic";

const MAX_CHARS = 1200;

function audioResponse(buf: Buffer, cache: "HIT" | "MISS"): NextResponse {
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.byteLength),
      // Immutable: the URL body is content-addressed by the request text.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-TTS-Cache": cache,
    },
  });
}

export async function POST(req: Request) {
  let body: { text?: string; cacheKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const raw = typeof body.text === "string" ? body.text : "";
  if (raw.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `text too long (>${MAX_CHARS} chars)` },
      { status: 413 }
    );
  }

  const cleanText = sanitizeForNeuralSpeech(raw);
  if (!cleanText) {
    return NextResponse.json({ error: "empty text" }, { status: 400 });
  }

  const cfg = getTtsConfig();

  // No provider configured (webspeech / missing key) → tell the client to
  // fall back. This is the default CI state; it must not be an error.
  if (!cfg.provider) {
    return NextResponse.json({ fallback: "webspeech" }, { status: 501 });
  }

  const hash = cacheKey(cfg.providerName, cfg.voiceId, cfg.model, cleanText);

  // 1) cache lookup (disk is source of truth)
  const cached = await readCache(hash);
  if (cached) return audioResponse(cached, "HIT");

  // 2) miss → synthesize
  const outcome = await cfg.provider.synthesize(cleanText, {
    voiceId: cfg.voiceId,
    model: cfg.model,
  });

  if (!outcome.ok) {
    console.error(`tts provider failed (${cfg.providerName}):`, outcome.error);
    // Degrade gracefully: let the client fall back to Web Speech rather than
    // surfacing a hard failure that would break the demo.
    return NextResponse.json(
      { fallback: "webspeech", error: outcome.error },
      { status: outcome.status >= 500 ? 502 : outcome.status }
    );
  }

  const buf = Buffer.from(outcome.result.audio);
  // 3) write-through (best-effort; don't block the response on a slow disk)
  void writeCache(hash, buf);
  return audioResponse(buf, "MISS");
}
