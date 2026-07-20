"use client";

/**
 * Client-side neural-voice player with automatic Web Speech fallback.
 *
 * speakRemote() POSTs the assistant text to /api/tts:
 *   - 200 audio/mpeg  → play through a single reused <audio> element.
 *   - 501 / any error → fall back to the local Web Speech speak() so the demo
 *                       never goes silent when no key is configured.
 *
 * Audio playback requires a prior user gesture (browser autoplay policy). Call
 * unlockAudio() from a click handler (the VOICE toggle) once per session.
 */

import { cancelSpeech, speak } from "@/lib/voice";

let audioEl: HTMLAudioElement | null = null;
let unlocked = false;
let currentUrl: string | null = null;

/** Lazily create the single session <audio> element. */
function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

function revoke() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/**
 * Unlock programmatic audio playback. MUST be called from within a user-gesture
 * handler (e.g. the VOICE toggle click) so later fetch-driven playback is
 * allowed. Plays a muted no-op to satisfy the autoplay gate; safe to call more
 * than once.
 */
export function unlockAudio(): void {
  const el = getAudio();
  if (!el || unlocked) return;
  try {
    el.muted = true;
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = false;
      }).catch(() => {
        el.muted = false;
      });
    } else {
      el.muted = false;
    }
    unlocked = true;
  } catch {
    /* ignore — we'll still try real playback later */
  }
}

/** Stop any in-flight neural audio AND any Web Speech utterance. */
export function stopSpeaking(): void {
  const el = audioEl;
  if (el) {
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  revoke();
  cancelSpeech();
}

interface SpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  signal?: AbortSignal;
}

/**
 * Speak `text` via the neural provider, falling back to Web Speech.
 * A new call cancels whatever was playing before it.
 */
export async function speakRemote(
  text: string,
  handlers: SpeakHandlers = {}
): Promise<void> {
  const { onStart, onEnd, signal } = handlers;

  // Interrupt whatever is currently speaking (audio + web speech).
  stopSpeaking();

  if (!text || !text.trim()) {
    onEnd?.();
    return;
  }

  const fallback = () => speak(text, { onStart, onEnd });

  let res: Response;
  try {
    res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch {
    // Network error / aborted → fall back locally.
    if (signal?.aborted) {
      onEnd?.();
      return;
    }
    fallback();
    return;
  }

  // 501 (no key), 4xx/5xx, or non-audio → Web Speech fallback.
  if (!res.ok || !res.headers.get("content-type")?.includes("audio")) {
    fallback();
    return;
  }

  let url: string;
  try {
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
  } catch {
    fallback();
    return;
  }

  const el = getAudio();
  if (!el) {
    fallback();
    return;
  }

  // Guard against a newer call that superseded us while we were fetching.
  if (signal?.aborted) {
    URL.revokeObjectURL(url);
    onEnd?.();
    return;
  }

  revoke();
  currentUrl = url;
  el.src = url;
  el.muted = false;

  const cleanup = () => {
    el.onplaying = null;
    el.onended = null;
    el.onerror = null;
  };
  el.onplaying = () => onStart?.();
  el.onended = () => {
    cleanup();
    revoke();
    onEnd?.();
  };
  el.onerror = () => {
    cleanup();
    revoke();
    // Playback failed after a successful fetch → last-resort local voice.
    fallback();
  };

  try {
    await el.play();
  } catch {
    cleanup();
    revoke();
    // Autoplay blocked (no gesture) or other play error → fall back.
    fallback();
  }
}
