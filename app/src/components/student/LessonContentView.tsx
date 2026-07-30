"use client";

import type { LessonContent, LessonInteractive } from "@/lib/lesson-content";
import { SealedPassageCard } from "@/components/student/SealedPassageCard";
import { LocateOnMap } from "@/components/student/widgets/LocateOnMap";
import { TermMatch } from "@/components/student/widgets/TermMatch";
import { TimelineBuilder } from "@/components/student/widgets/TimelineBuilder";
import { ChainBuilder } from "@/components/student/widgets/ChainBuilder";
// Arabic vertical (ADR-0006)
import { ExtractSpans } from "@/components/student/widgets/ExtractSpans";
import { HamzaSeat } from "@/components/student/widgets/HamzaSeat";
import { StylePurpose } from "@/components/student/widgets/StylePurpose";
import { IrabBuilder } from "@/components/student/widgets/IrabBuilder";
import type { IrabAnswer, NounType } from "@/lib/irab";

/**
 * «شرح الدرس» — the readable lesson surface for the rich content the
 * extraction pipeline emits (exposition, glossary, enrichment, misconceptions,
 * interactive beats). Arabic RTL throughout, Ledger design system.
 *
 * This is the calm READING companion to the AI-led check-in doors: the student
 * comes here to read the teaching narrative and try a few taps, at their own
 * pace — never quizzed, never scored, no AI turn spent. It is offered, never
 * forced (LessonCheckIn links to it only when a bundle exists), matching the
 * "the UI assigns, one clear next action" philosophy.
 *
 * Sections render only when the pipeline produced them, so a thin bundle (say,
 * exposition only) is still a clean page.
 */
export function LessonContentView({ content }: { content: LessonContent }) {
  const {
    title,
    tamheed,
    subtopics,
    key_terms,
    enrichment,
    misconceptions,
    interactives,
    passages,
    out_of_scope,
    qadaya,
  } = content;

  return (
    <main
      dir="rtl"
      className="mx-auto max-w-2xl px-5 pb-20 pt-8 md:px-6"
      style={{ fontFamily: "var(--stack-sans)" }}
    >
      {/* title */}
      <header className="anim-rise">
        <p className="text-[10.5px] font-semibold tracking-wide text-ink-faint">
          شرح الدرس · قراءة هادية
        </p>
        <h1 className="mt-1 font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">
          {title}
        </h1>
      </header>

      {/* القضايا المتضمنة — the printed issues box (Arabic vertical) */}
      {qadaya.length > 0 && (
        <div className="anim-rise mt-4 flex flex-wrap gap-2" style={{ animationDelay: "60ms" }}>
          {qadaya.map((q) => (
            <span
              key={q}
              className="rounded-full border border-line-soft bg-paper px-3 py-1 text-[11.5px] text-ink-soft"
            >
              {q}
            </span>
          ))}
        </div>
      )}

      {/* النص — the sealed passages (Arabic vertical, ADR-0006): rendered
          verbatim from the verified store; the tutor only ever points here */}
      {passages.length > 0 && (
        <section className="anim-rise mt-6" style={{ animationDelay: "70ms" }}>
          {passages.map((p) => (
            <SealedPassageCard key={p.id} passage={p} />
          ))}
        </section>
      )}

      {/* tamheed — the opening hook */}
      {tamheed && (
        <section
          className="anim-rise mt-5 overflow-hidden rounded-xl border border-accent/30 bg-accent-wash px-5 py-4"
          style={{ animationDelay: "80ms" }}
        >
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-accent-deep">
            تمهيد
          </p>
          <p className="text-[15px] leading-loose text-ink">{tamheed}</p>
        </section>
      )}

      {/* exposition — the teaching narrative, per sub-topic */}
      {subtopics.length > 0 && (
        <section className="anim-rise mt-8" style={{ animationDelay: "140ms" }}>
          <SectionRule
            ar="شرح الدرس"
            note={`${subtopics.length} ${subtopics.length === 1 ? "فقرة" : "فقرات"}`}
          />
          <div className="mt-4 space-y-5">
            {subtopics.map((st) => (
              <article key={st.key} className="ledger-card px-5 py-4">
                {st.title && (
                  <h2 className="font-display text-[17px] font-medium text-accent-deep">
                    {st.title}
                  </h2>
                )}
                <p className="mt-2 text-[14.5px] leading-loose text-ink-soft">
                  {st.exposition}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* key terms — the glossary strip «مفاهيم أتعلمها» */}
      {key_terms.length > 0 && (
        <section className="anim-rise mt-8" style={{ animationDelay: "180ms" }}>
          <SectionRule ar="مفاهيم أتعلمها" note={`${key_terms.length}`} />
          <dl className="mt-4 overflow-hidden rounded-xl border border-gold/40 bg-gold-wash">
            {key_terms.map((t, i) => (
              <div
                key={`${t.term_ar}-${i}`}
                className={`grid grid-cols-[minmax(88px,34%)_1fr] gap-x-4 px-4 py-3 ${
                  i > 0 ? "border-t border-gold/20" : ""
                }`}
              >
                <dt className="text-[13.5px] font-bold leading-snug text-ink">
                  {t.term_ar}
                </dt>
                <dd className="text-[13px] leading-relaxed text-ink-soft">
                  {t.definition_ar}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* enrichment — «معلومات إثرائية» side-boxes */}
      {enrichment.length > 0 && (
        <section className="anim-rise mt-8" style={{ animationDelay: "220ms" }}>
          <SectionRule ar="معلومات إثرائية" note="اعرف أكتر" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {enrichment.map((e, i) => (
              <aside
                key={`${e.title}-${i}`}
                className="relative overflow-hidden rounded-lg border border-line bg-card px-4 py-3.5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_10px_24px_-18px_rgba(32,41,58,0.3)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 right-0 w-1"
                  style={{ background: "var(--gold)" }}
                />
                <p className="pe-1 text-[10px] font-semibold tracking-wide text-gold">
                  ✦ اعرف أكتر
                </p>
                {e.title && (
                  <h3 className="mt-1 font-display text-[15px] font-medium text-ink">
                    {e.title}
                  </h3>
                )}
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                  {e.body_ar}
                </p>
              </aside>
            ))}
          </div>
        </section>
      )}

      {/* misconceptions — subtle «تنبيه شائع» callouts (never alarmist) */}
      {misconceptions.length > 0 && (
        <section className="anim-rise mt-8" style={{ animationDelay: "260ms" }}>
          <SectionRule ar="تنبيه شائع" note="غلطة بيقع فيها كتير" />
          <div className="mt-4 space-y-2.5">
            {misconceptions.map((m, i) => (
              <div
                key={i}
                className="rounded-lg border border-line-soft bg-card-warm px-4 py-3"
              >
                <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-faint">
                  <span className="mt-[3px] shrink-0 text-[11px] text-rust">✕</span>
                  <span className="line-through decoration-rust/40">{m.wrong}</span>
                </p>
                <p className="mt-1.5 flex items-start gap-2 text-[13.5px] font-medium leading-relaxed text-ink">
                  <span className="mt-[3px] shrink-0 text-[11px] text-accent">✓</span>
                  <span>{m.correction}</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* interactive practice beats */}
      {interactives.length > 0 && (
        <section className="anim-rise mt-8" style={{ animationDelay: "300ms" }}>
          <SectionRule ar="جرّب بنفسك" note="تفاعلي · من غير درجات" />
          <div className="mt-4 space-y-3">
            {interactives.map((it, i) => (
              <InteractiveBeat key={i} interactive={it} />
            ))}
          </div>
        </section>
      )}

      {/* ما لا نقيسه — ADR-0006 §4: خط/تعبير/تلاوة are printed objectives we
          deliberately do not score. Disclosed here in visible copy — never
          hidden, never left at 0% forever. */}
      {out_of_scope.length > 0 && (
        <section className="anim-rise mt-8" style={{ animationDelay: "340ms" }}>
          <SectionRule ar="مهارات في الكتاب لا نقيسها هنا" note="بأمانة" />
          <div className="mt-4 rounded-xl border border-line-soft bg-paper px-5 py-4">
            {out_of_scope.map((o) => (
              <p key={o.text} className="py-1 text-[13.5px] leading-relaxed text-ink-soft">
                <span className="font-medium text-ink">{o.text}</span>
                <span className="text-ink-faint"> — {o.reason}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      <p className="mt-10 text-center text-[10.5px] text-ink-faint">
        كل جملة من كتاب الوزارة، بمراجعة بشرية · اقرأ على راحتك من غير امتحان
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function SectionRule({ ar, note }: { ar: string; note?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-display text-[15px] font-medium text-ink">{ar}</span>
      {note && <span className="text-[10.5px] text-ink-faint">{note}</span>}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive adapters — map pipeline `spec` shapes to the Wave-0     */
/* widgets. In this reading view the widgets self-grade and show their */
/* own inline feedback; there is no AI turn, so onResult is a no-op.   */
/* ------------------------------------------------------------------ */

const NOOP = () => {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const asIntArray = (v: unknown): number[] | undefined =>
  Array.isArray(v)
    ? v.filter((n): n is number => Number.isInteger(n))
    : undefined;
const asStringArray = (v: unknown): string[] =>
  asArray(v)
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
const BASE_RE = /^[a-z_]{1,32}$/;

function InteractiveBeat({ interactive }: { interactive: LessonInteractive }) {
  const nodes = renderInteractive(interactive);
  if (nodes.length === 0) return null;
  return <>{nodes}</>;
}

/**
 * One pipeline interactive → one or more rendered widgets. Returns [] for a
 * shape the widget can't accept (defensive — the pipeline spec may drift).
 */
function renderInteractive(it: LessonInteractive): React.ReactNode[] {
  const { kind, spec, prompt_ar } = it;
  const prompt = prompt_ar || asString(spec.prompt);

  if (kind === "term_match") {
    const pairs = asArray(spec.pairs)
      .map((p) =>
        p && typeof p === "object"
          ? {
              term: asString((p as Record<string, unknown>).term),
              definition: asString(
                (p as Record<string, unknown>).definition ??
                  (p as Record<string, unknown>).def
              ),
            }
          : { term: "", definition: "" }
      )
      .filter((p) => p.term && p.definition);
    if (pairs.length === 0) return [];
    return [
      <TermMatch
        key="tm"
        prompt={prompt || undefined}
        pairs={pairs}
        decoyDefs={asStringArray(spec.decoyDefs)}
        onResult={NOOP}
      />,
    ];
  }

  if (kind === "timeline_builder") {
    // events may be plain strings or {label} objects
    const events = asArray(spec.events)
      .map((e) =>
        typeof e === "string"
          ? e.trim()
          : e && typeof e === "object"
            ? asString((e as Record<string, unknown>).label)
            : ""
      )
      .filter(Boolean);
    if (events.length < 2) return [];
    const correctOrder =
      asIntArray(spec.correctOrder) ??
      asIntArray(spec.answerOrder) ??
      asIntArray(spec.order);
    return [
      <TimelineBuilder
        key="tl"
        prompt={prompt || "رتب الأحداث زي ما حصلت"}
        events={events}
        correctOrder={correctOrder}
        onResult={NOOP}
      />,
    ];
  }

  if (kind === "chain_builder") {
    const cards = asArray(spec.cards)
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const label = asString((c as Record<string, unknown>).label);
        const role = asString((c as Record<string, unknown>).role);
        return label ? (role ? { label, role } : { label }) : null;
      })
      .filter((c): c is { label: string; role?: string } => c !== null);
    if (cards.length < 2) return [];
    const correctChain = asIntArray(spec.correctChain) ?? asIntArray(spec.chain);
    return [
      <ChainBuilder
        key="cb"
        prompt={prompt || "ركّب السلسلة بالترتيب"}
        cards={cards}
        correctChain={correctChain}
        onResult={NOOP}
      />,
    ];
  }

  /* ---- Arabic vertical (ADR-0006) ---- */

  if (kind === "extract_spans") {
    const text = asString(spec.text ?? spec.passage);
    const targets = asStringArray(spec.targets);
    if (!text || targets.length === 0) return [];
    return [
      <ExtractSpans
        key="ex"
        prompt={prompt || "دوس على الكلمات المطلوبة"}
        text={text}
        category={asString(spec.category) || "نحو"}
        targets={targets}
        distractorHint={asString(spec.distractorHint) || undefined}
        onResult={NOOP}
      />,
    ];
  }

  if (kind === "hamza_seat") {
    const items = asArray(spec.items)
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const it = raw as Record<string, unknown>;
        const word = asString(it.word);
        const answer = asString(it.answer);
        if (!word || !answer) return null;
        return {
          word,
          answer,
          seats: asStringArray(it.seats),
          rule: asString(it.rule) || undefined,
          page: typeof it.page === "number" ? it.page : undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (items.length === 0) return [];
    return [
      <HamzaSeat
        key="hz"
        prompt={prompt || "الهمزة دي بتتكتب إزاي؟"}
        items={items}
        onResult={NOOP}
      />,
    ];
  }

  if (kind === "style_purpose") {
    const ans = (spec.answer ?? {}) as Record<string, unknown>;
    const text = asString(spec.text);
    const span = asString(spec.span);
    const style = asString(ans.style);
    const purpose = asString(ans.purpose);
    const styles = asStringArray(spec.styles);
    const purposes = asStringArray(spec.purposes);
    if (!text || !span || !style || !purpose || styles.length < 2 || purposes.length < 2)
      return [];
    return [
      <StylePurpose
        key="sp"
        prompt={prompt || "الأسلوب ده إيه، وغرضه إيه؟"}
        text={text}
        span={span}
        styles={styles}
        purposes={purposes}
        answer={{ style, purpose }}
        onResult={NOOP}
      />,
    ];
  }

  if (kind === "irab_builder") {
    const ans = (spec.answer ?? {}) as Record<string, unknown>;
    const ref = (spec.rule_ref ?? {}) as Record<string, unknown>;
    const sentence = asString(spec.sentence);
    const target = asString(spec.target);
    const roles = asStringArray(spec.roles);
    const marks = asStringArray(spec.marks);
    if (
      !sentence ||
      !target ||
      roles.length < 2 ||
      marks.length < 2 ||
      !asString(ans.word_ar) ||
      !asString(ans.role_ar)
    )
      return [];
    return [
      <IrabBuilder
        key="ib"
        prompt={prompt || "أعرب الكلمة اللي تحتها خط"}
        sentence={sentence}
        target={target}
        roles={roles}
        marks={marks}
        answer={ans as unknown as IrabAnswer}
        rule_ref={{
          quote: asString(ref.quote) || undefined,
          page: typeof ref.page === "number" ? ref.page : undefined,
        }}
        nounType={(asString(spec.nounType) || undefined) as NounType | undefined}
        onResult={NOOP}
      />,
    ];
  }

  if (kind === "locate_on_map") {
    const base = asString(spec.base);
    if (!BASE_RE.test(base)) return [];
    // the pipeline may give a single `target` or a list of `targets`; the
    // widget locates ONE place, so a multi-target beat becomes one tap per
    // target (each a small locate moment, using the others as no worse than
    // context — decoys stay whatever the pipeline supplied).
    const targets = asStringArray(spec.targets);
    const single = asString(spec.target);
    const list = targets.length > 0 ? targets : single ? [single] : [];
    if (list.length === 0) return [];
    const decoys = asStringArray(spec.decoys).slice(0, 4);
    return list.map((target, i) => (
      <LocateOnMap
        key={`lm-${i}`}
        base={base}
        prompt={
          prompt
            ? list.length > 1
              ? `${prompt} — ${target}`
              : prompt
            : `فين ${target}؟ دوس على مكانها`
        }
        target={target}
        decoys={decoys.length > 0 ? decoys : undefined}
        onResult={NOOP}
      />
    ));
  }

  return [];
}
