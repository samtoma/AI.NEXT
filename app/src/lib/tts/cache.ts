import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * On-disk mp3 cache for synthesized speech — the cost-control lever.
 *
 * Disk is the source of truth (survives process restarts, shared across
 * requests). An in-memory Set of known hashes short-circuits the stat() on hot
 * lines. Key = sha256(provider|voiceId|model|cleanText) so any change to voice,
 * model, or text produces a fresh entry.
 */

const CACHE_DIR = path.join(tmpdir(), "ainext-tts");
const knownHashes = new Set<string>();

export function cacheKey(
  provider: string,
  voiceId: string,
  model: string,
  cleanText: string
): string {
  return createHash("sha256")
    .update(`${provider}|${voiceId}|${model}|${cleanText}`)
    .digest("hex");
}

function fileFor(hash: string): string {
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

/** Return cached mp3 bytes for this hash, or null on miss. */
export async function readCache(hash: string): Promise<Buffer | null> {
  try {
    const buf = await fs.readFile(fileFor(hash));
    knownHashes.add(hash);
    return buf;
  } catch {
    return null;
  }
}

/** Write-through: persist mp3 bytes for this hash. Best-effort. */
export async function writeCache(
  hash: string,
  audio: ArrayBuffer | Buffer
): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const buf = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
    // Atomic-ish: write temp then rename so a reader never sees a partial file.
    const tmp = `${fileFor(hash)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, fileFor(hash));
    knownHashes.add(hash);
  } catch (e) {
    console.error("tts cache write failed:", e);
  }
}

/** In-memory hint: have we written/read this hash in this process? */
export function cacheHint(hash: string): boolean {
  return knownHashes.has(hash);
}

export function cacheDir(): string {
  return CACHE_DIR;
}
