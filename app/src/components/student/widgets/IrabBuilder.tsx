"use client";

import { useMemo, useState } from "react";
import { arDigits, locateSpan } from "@/components/viz/arabic";
import {
  foldCompare,
  gradeIrab,
  impliedState,
  parseIrabPhrase,
  validateIrabKey,
  type IrabAnswer,
  type NounType,
} from "@/lib/irab";
import { stableShuffle, useFireOnce } from "./util";

/**
 * «أعرب ما تحته خط» — the canonical Arabic exam item, in two taps.
 *
 * Every judgement this widget makes comes from `@/lib/irab`: it never compares
 * strings and it never calls a model. That buys three things the student can
 * feel — a fuller-than-the-key answer is accepted (VARIANT), a wrong answer
 * produces a COMPUTED slot diff instead of a red X, and the whole interaction
 * works offline.
 *
 * Two gates before anything renders (arabic-viz-widgets.md §1.6 / §2.4):
 *   - the answer key must be coherent AND cite a printed rule clause;
 *   - one of the offered علامة options must actually grade as correct.
 * A mis-authored item renders NOTHING rather than marking a student against a
 * key we cannot license.
 *
 * Step 2's option list is filtered by the موقع picked in step 1 — which is
 * itself the rule («ما دام مضاف، يبقى حكمه إيه؟»), not a UI convenience.
 */

export function IrabBuilder({
  prompt,
  sentence,
  target,
  roles,
  marks,
  answer,
  rule_ref,
  nounType,
  onResult,
}: {
  prompt: string;
  sentence: string;
  target: string;
  roles: string[];
  marks: string[];
  answer: IrabAnswer;
  rule_ref?: { page?: number; quote?: string };
  nounType?: NounType;
  onResult: (note: string) => void;
}) {
  const opts = useMemo(
    () => ({ rule: { quote_ar: rule_ref?.quote, page: rule_ref?.page }, nounType }),
    [rule_ref?.quote, rule_ref?.page, nounType]
  );

  const keyErrors = useMemo(() => validateIrabKey(answer), [answer]);

  const roleOpts = useMemo(
    () => stableShuffle((roles ?? []).filter(Boolean), (r) => r),
    [roles]
  );
  const markOpts = useMemo(
    () => stableShuffle((marks ?? []).filter(Boolean), (m) => m),
    [marks]
  );

  /** the offered موقع that the grader accepts */
  const rightRole = useMemo(
    () =>
      keyErrors.length > 0
        ? undefined
        : roleOpts.find(
            (r) =>
              gradeIrab({ role_ar: r }, answer, opts).slots.find((s) => s.slot === "role")
                ?.status !== "conflict"
          ),
    [roleOpts, answer, opts, keyErrors]
  );
  /** the offered علامة phrase that grades correct */
  const rightMark = useMemo(
    () =>
      keyErrors.length > 0 || !rightRole
        ? undefined
        : markOpts.find(
            (m) => gradeIrab({ role_ar: rightRole, mark_phrase: m }, answer, opts).correct
          ),
    [markOpts, rightRole, answer, opts, keyErrors]
  );

  const at = useMemo(
    () => locateSpan(sentence, target, 1, { wholeWord: true }) ?? locateSpan(sentence, target),
    [sentence, target]
  );

  const fire = useFireOnce(onResult);
  const [roleTries, setRoleTries] = useState<string[]>([]);
  const [pickedRole, setPickedRole] = useState<string | null>(null);
  const [markTries, setMarkTries] = useState<string[]>([]);
  const [pickedMark, setPickedMark] = useState<string | null>(null);
  const [coach, setCoach] = useState<string>("");

  // ---- the gates. Refuse, loudly in dev, silently in production.
  if (keyErrors.length > 0 || !rightRole || !rightMark) {
    if (process.env.NODE_ENV !== "production")
      console.warn(
        "[irab_builder] refused to render:",
        keyErrors.length > 0
          ? keyErrors.join("; ")
          : !rightRole
            ? "no offered موقع matches the answer key"
            : "no offered علامة grades as correct"
      );
    return null;
  }

  const wordAligned =
    foldCompare(answer.word_ar) === foldCompare(target) ||
    foldCompare(target).includes(foldCompare(answer.word_ar));
  if (!wordAligned) {
    if (process.env.NODE_ENV !== "production")
      console.warn(
        `[irab_builder] refused: key parses «${answer.word_ar}» but the target is «${target}»`
      );
    return null;
  }

  const roleDone = pickedRole !== null;
  const done = pickedMark !== null;

  // filter the علامة list by the حالة the chosen موقع implies — only where the
  // book states it, and never if that would hide the correct option
  const implied = roleDone ? impliedState(pickedRole!) : undefined;
  const shownMarks =
    implied === undefined
      ? markOpts
      : (() => {
          const kept = markOpts.filter(
            (m) => (parseIrabPhrase(m).state ?? implied) === implied
          );
          return kept.includes(rightMark) && kept.length >= 2 ? kept : markOpts;
        })();

  const pickRole = (r: string) => {
    if (roleDone) return;
    if (r === rightRole) {
      setPickedRole(r);
      setCoach("");
      return;
    }
    const tries = [...roleTries, r];
    setRoleTries(tries);
    const g = gradeIrab({ role_ar: r }, answer, opts);
    setCoach(g.diagnosis?.message_ar ?? "");
    if (tries.length >= 2) {
      setPickedRole(rightRole); // reveal, never leave him stuck
      setCoach(`الموقع الصح: ${answer.role_ar}.`);
    }
  };

  const pickMark = (m: string) => {
    if (done || !roleDone) return;
    const g = gradeIrab(
      { word_ar: answer.word_ar, role_ar: pickedRole!, mark_phrase: m },
      answer,
      opts
    );
    if (g.correct) {
      setPickedMark(m);
      setCoach("");
      fire(
        `irab_builder «${answer.word_ar}»: ${g.verdict} — role ${
          roleTries.length === 0 ? "✓ first try" : `✗ ${roleTries.length}×`
        }, sign ${markTries.length === 0 ? "✓ first try" : `✗ ${markTries.length}×`}. ${g.note}`
      );
      return;
    }
    const tries = [...markTries, m];
    setMarkTries(tries);
    setCoach(g.diagnosis?.message_ar ?? "");
    if (tries.length >= 2) {
      setPickedMark(rightMark);
      setCoach(`العلامة الصح: ${answer.surface_ar}.`);
      fire(
        `irab_builder «${answer.word_ar}»: REVEALED — role ${
          roleTries.length === 0 ? "✓ first try" : `✗ ${roleTries.length}×`
        }, sign ✗ ${tries.length}× (${tries.map((t) => `'${t}'`).join(", ")}). ${g.note}`
      );
    }
  };

  const head = at ? sentence.slice(0, at[0]) : sentence;
  const mid = at ? sentence.slice(at[0], at[1]) : "";
  const tail = at ? sentence.slice(at[1]) : "";

  return (
    <div
      dir="rtl"
      lang="ar"
      className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="ar-label font-mono text-[9px] text-accent-deep">
          ✳ تفاعلي · إعراب
        </span>
        <span className="ar-label font-mono text-[9px] text-ink-faint">
          {done ? "تمام" : roleDone ? "٢ · العلامة" : "١ · الموقع"}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="ar-block ar-plain text-[13px] font-medium text-ink">{prompt}</p>

        <p className="ar-block ar-vowelled mt-2 rounded-md border border-line-soft bg-card-warm px-2.5 py-1.5 text-[16.5px] text-ink">
          {head}
          {mid && (
            <mark
              style={{
                background: "rgba(13,74,66,0.16)",
                color: "inherit",
                borderRadius: "0.2rem",
                textDecorationLine: "underline",
                textDecorationColor: "var(--accent-deep)",
                textUnderlineOffset: "0.45em",
              }}
            >
              {mid}
            </mark>
          )}
          {tail}
        </p>

        {/* stage 1 — الموقع */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {roleOpts.map((r) => {
            const isRight = roleDone && r === rightRole;
            const isWrong = roleTries.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => pickRole(r)}
                disabled={roleDone || isWrong}
                className={`ar-block min-h-[36px] rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-all duration-150 ${
                  isRight
                    ? "border-accent bg-accent text-paper"
                    : isWrong
                      ? "border-rust/45 bg-rust-wash text-rust opacity-60"
                      : roleDone
                        ? "border-line-soft bg-card text-ink-faint"
                        : "border-line bg-card text-ink hover:-translate-y-px hover:border-ink/40"
                }`}
              >
                <bdi>{r}</bdi>
              </button>
            );
          })}
        </div>

        {/* stage 2 — العلامة, unlocked (and narrowed) by stage 1 */}
        <div className={`mt-2.5 ${roleDone ? "" : "pointer-events-none opacity-40"}`}>
          <span className="ar-label ar-block font-mono text-[9.5px] text-ink-faint">
            العلامة
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {shownMarks.map((m) => {
              const isRight = done && m === pickedMark;
              const isWrong = markTries.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pickMark(m)}
                  disabled={!roleDone || done || isWrong}
                  className={`ar-block min-h-[36px] rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-all duration-150 ${
                    isRight
                      ? "border-accent bg-accent text-paper"
                      : isWrong
                        ? "border-rust/45 bg-rust-wash text-rust opacity-60"
                        : "border-line bg-card text-ink hover:-translate-y-px hover:border-ink/40"
                  }`}
                >
                  <bdi>{m}</bdi>
                </button>
              );
            })}
          </div>
        </div>

        {/* the COMPUTED diagnosis — a slot diff verbalised, never a red X */}
        {coach && !done && (
          <p className="ar-block ar-plain anim-fade mt-2 rounded-md border border-gold/40 bg-gold-wash px-2.5 py-1.5 text-[12px] text-ink-soft">
            <bdi>{coach}</bdi>
          </p>
        )}

        {done && (
          <div className="anim-pop mt-3 rounded-md border border-accent/45 bg-accent-wash px-3 py-2">
            <span className="ar-block font-display text-[13.5px] font-medium text-accent-deep">
              <bdi>{answer.surface_ar}</bdi>
            </span>
            {rule_ref?.quote && (
              <p className="ar-block ar-plain mt-1 border-r-2 border-gold/50 pr-1.5 text-[11.5px] text-ink-soft">
                <bdi>
                  «{rule_ref.quote}»
                  {rule_ref.page ? ` — ص ${arDigits(rule_ref.page)}` : ""}
                </bdi>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
