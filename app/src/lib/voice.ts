"use client";

/**
 * Demo-grade voice layer over the Web Speech API — no external API.
 * TTS: speechSynthesis with an en-US voice; citations/directives/LaTeX are
 * stripped before speaking. STT: webkitSpeechRecognition (en-US), used to
 * fill the chat input. Everything is feature-detected and fails silent.
 */

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function sttSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    (("webkitSpeechRecognition" in window) || "SpeechRecognition" in window)
  );
}

export function makeRecognition(): any | null {
  if (!sttSupported()) return null;
  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  try {
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    return rec;
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Rough spoken form for the tiny LaTeX subset used in this lesson. */
function mathToWords(src: string): string {
  return src
    .replace(/\\times/g, " times ")
    .replace(/\\Rightarrow/g, " therefore ")
    .replace(/\\ne(q)?/g, " is not equal to ")
    .replace(/n\\?\(\s*([A-Za-z])\s*\\?\)/g, " n of $1 ")
    .replace(/\\\{|\\\}/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\^\s*2/g, " squared ")
    .replace(/=/g, " equals ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip citations, directives, markdown and LaTeX; drop Arabic for the en-US voice. */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/\{\{[^}]*\}\}+/g, " ") // action directives (incl. widget JSON tails)
    .replace(/\[\[[^\]]*\]\]/g, " ") // citation markers
    .replace(/\$([^$]+)\$/g, (_, m: string) => ` ${mathToWords(m)} `)
    .replace(/\*\*/g, "")
    .replace(/[؀-ۿݐ-ݿ]+/g, " ") // Arabic script — en-US voice would mangle it
    .replace(/[•▲▼✓✗✦⚡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let pickedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  if (pickedVoice) return pickedVoice;
  const voices = window.speechSynthesis.getVoices();
  pickedVoice =
    voices.find((v) => v.lang === "en-US" && /Samantha|Google US/i.test(v.name)) ??
    voices.find((v) => v.lang === "en-US") ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null;
  return pickedVoice;
}

export function speak(
  text: string,
  handlers?: { onStart?: () => void; onEnd?: () => void }
): void {
  if (!ttsSupported()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // new message interrupts the previous one
    const clean = sanitizeForSpeech(text);
    if (!clean) return;
    const utter = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.lang = "en-US";
    utter.rate = 1.02;
    utter.pitch = 1.0;
    utter.onstart = () => handlers?.onStart?.();
    utter.onend = () => handlers?.onEnd?.();
    utter.onerror = () => handlers?.onEnd?.();
    synth.speak(utter);
  } catch {
    handlers?.onEnd?.();
  }
}

export function cancelSpeech(): void {
  if (!ttsSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* noop */
  }
}
