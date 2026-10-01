"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AttemptResult,
  SpineData,
  SpineQuestion,
  SpineSubject,
} from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { SkillMap } from "./SkillMap";
import { QuestionModal } from "./QuestionModal";
import { NoorPanel } from "./NoorPanel";
import type { CiteInfo } from "@/components/chat/CitationChip";
import { MASTERY_LEGEND, masteryStage, masteryPhrase } from "@/lib/mastery";
import {
  buildSkillMap,
  objectivesStarted,
  parentSelection,
  selectionPath,
  type AsOf,
  type Selection,
} from "@/lib/skill-map";
import {
  SPINE_SUBJECT_KEYS,
  displayLabelOfSpineKey,
  spineSubjectDef,
} from "@/lib/subjects";
import { HEADING, HONEY_BAND, STROKE, STROKE_SM, cx } from "@/components/sticker";

/** "mathematics" → "Mathematics". The subject, never a unit name. */
const titleCase = (s: string) =>
  s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;

/** A pill holding its segments — the thin Play stroke, no shadow. */
const SEGMENTED = cx(
  STROKE_SM,
  "flex gap-1.5 rounded-[var(--play-radius-pill)] bg-card p-[3px]"
);
/** One segment. The chosen one is ink in BOTH pickers — subject and
 *  snapshot. The snapshot toggle used to spend amber on its chosen segment
 *  (Tamer's design), which made two selected-state styles in one header and
 *  a second amber beside the composer's send; the send keeps the screen's one
 *  amber. Both hold the touch floor (main's Play fixes); an unchosen label is
 *  under 0.9rem, so it takes `--play-text-muted`, not ink-soft. */
const segment = (on: boolean) =>
  cx(
    "inline-flex min-h-[var(--noor-touch-min)] items-center rounded-[var(--play-radius-pill)] px-3.5",
    "font-display text-[0.82rem] font-bold leading-none transition-colors duration-200",
    on
      ? "bg-ink text-paper"
      : "text-[color:var(--play-text-muted)] hover:text-ink"
  );

/**
 * Your Progress Map (FR-3219, FR-3224) — the student's mastery, subject-wide.
 *
 * This screen used to be "The Evidence Walk": the same tree and the same
 * chat, wrapped in an internal tool. What came off, and why (Noor Play skill
 * map v1 build spec):
 *
 *  · the stat-chip row — 90 objectives, 1041 questions, 112 prerequisite
 *    edges, 117 attempts. Graph metadata. A student needs their own place in
 *    the graph, not its size.
 *  · the as-of query string — "MASTERY FOR SYSTEM_TIME AS OF NOW()", a
 *    literal temporal-table clause printed at a fifteen-year-old. The two
 *    states it named are now two tabs in plain words.
 *  · node ids leading every card, and a percentage badge on every node.
 *  · the DAG footer ("graph_edges where edge_type='prerequisite_of'"), the
 *    arrowheads, and the "→ = is prerequisite of" key.
 *  · the live session-cost meter in the chat header (see NoorPanel).
 *
 * Scope widened with it: the tree covers the whole subject, so the title
 * names the subject and nothing smaller. A unit-level view is a different
 * screen.
 *
 * ON MAIN (trial merge): the demo-student switcher the branch kept is gone —
 * main retired the demo cast and the student comes from her session. And
 * because main serves up to three subjects behind the course gate (ADR-0018),
 * the map shows ONE subject at a time, as this design intends, with a subject
 * picker when more than one is visible to her. It never mixes subjects in one
 * tree; the branch's version would have, the moment a second course went live.
 */
export function SpineExplorer({ data }: { data: SpineData }) {
  const router = useRouter();
  const [asOf, setAsOf] = useState<AsOf>("today");
  // Subjects present in what the gate let through, registry order.
  const subjectsPresent = useMemo(() => {
    const present = new Set(data.los.map((l) => l.subject));
    return SPINE_SUBJECT_KEYS.filter((k) => present.has(k));
  }, [data.los]);
  const [subjectPick, setSubjectPick] = useState<SpineSubject | null>(null);
  const subject: SpineSubject | null =
    subjectPick && subjectsPresent.includes(subjectPick)
      ? subjectPick
      : (subjectsPresent[0] ?? null);
  const visibleLos = useMemo(
    () =>
      subject === null || subjectsPresent.length <= 1
        ? data.los
        : data.los.filter((l) => l.subject === subject),
    [data.los, subject, subjectsPresent.length]
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const model = useMemo(
    () => buildSkillMap(visibleLos, data.edges, data.lessonTitles),
    [visibleLos, data.edges, data.lessonTitles]
  );
  // Selecting an objective just selects it: the topic panel that used to open
  // here is gone (Tamer, 2026-10-01 — "remove it for now").
  const setSelectedLoId = useCallback(
    (id: string | null) => setSelection(id ? { kind: "objective", id } : null),
    []
  );
  const stepUp = useCallback(
    () => setSelection((cur) => parentSelection(model, cur)),
    [model]
  );
  const [openQuestion, setOpenQuestion] = useState<SpineQuestion | null>(null);
  // Topics Noor references while she writes: the card rings once.
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const pulseNonce = useRef(0);

  const questionsById = useMemo(
    () => new Map(data.questions.map((q) => [q.id, q])),
    [data.questions]
  );
  const losById = useMemo(
    () => new Map(data.los.map((l) => [l.id, l])),
    [data.los]
  );

  const started = useMemo(() => objectivesStarted(model, asOf), [model, asOf]);

  const pulseLo = useCallback((loIds: string[]) => {
    if (loIds.length === 0) return;
    setPulses((prev) => {
      const next = { ...prev };
      for (const id of loIds) next[id] = ++pulseNonce.current;
      return next;
    });
  }, []);

  const citeToLos = useCallback(
    (c: Cite): string[] => {
      if (c.kind === "lo") return losById.has(c.id) ? [c.id] : [];
      if (c.kind === "q") {
        const q = questionsById.get(c.id);
        return q ? [q.loId] : [];
      }
      return [];
    },
    [losById, questionsById]
  );

  const handleCite = useCallback(
    (c: Cite) => pulseLo(citeToLos(c)),
    [pulseLo, citeToLos]
  );

  const handleCiteClick = useCallback(
    (c: Cite) => {
      if (c.kind === "lo" && model.objectiveById.has(c.id)) {
        setSelectedLoId(c.id);
        pulseLo([c.id]);
      } else if (c.kind === "q") {
        const q = questionsById.get(c.id);
        if (q) setOpenQuestion(q);
      }
    },
    [model, questionsById, pulseLo, setSelectedLoId]
  );

  /**
   * What a reference inside Noor's answer expands to on hover.
   *
   * Citations are allowed to appear INSIDE her answers; what they may not do
   * is carry the engineering surface back in. So this used to read "mastery
   * 69% today · 15% at baseline · book p.12" for a topic and "standard ·
   * lo:u3-1 · p.40 · reviewed ✓" for a question — a percentage, an internal
   * key and review vocabulary, one hover away from a screen that cut all
   * three. The topic now names its stage in the same words its card uses,
   * and a question names the page it came from.
   */
  const resolveCite = useCallback(
    (c: Cite): CiteInfo | null => {
      if (c.kind === "lo") {
        const lo = losById.get(c.id);
        if (!lo) return null;
        const stage = masteryStage(lo.current, lo.current > 0);
        return {
          title: lo.label,
          sub: `${masteryPhrase(stage)}${lo.sourcePage ? ` · book p.${lo.sourcePage}` : ""}`,
        };
      }
      if (c.kind === "q") {
        const q = questionsById.get(c.id);
        return q
          ? {
              title: q.stem.length > 90 ? `${q.stem.slice(0, 90)}…` : q.stem,
              sub: q.provenance.sourcePage
                ? `From the book, p.${q.provenance.sourcePage}`
                : "From the book",
            }
          : null;
      }
      return {
        title: data.doc.title,
        sub: `${data.doc.publisher} · page ${c.id}`,
      };
    },
    [losById, questionsById, data.doc]
  );

  const handleChatAttempt = useCallback(
    (r: AttemptResult, _q: SpineQuestion) => {
      void _q;
      pulseLo([r.loId]);
      router.refresh(); // re-query mastery → the fills move
    },
    [pulseLo, router]
  );

  const subjectLabel = subject
    ? (spineSubjectDef(subject)?.label ?? displayLabelOfSpineKey(subject))
    : titleCase(data.doc.subject);
  const path = selectionPath(model, selection);
  const mapSub =
    level === 0
      ? "Tap a chapter to zoom in"
      : level === 1
        ? "Tap a lesson to see inside"
        : "Tap empty space to step back";

  return (
    /* The Your Progress Map (FR-3224): a title row, one quiet legend line,
       then the map and Ask Noor side by side at the same top and height.
       Below 1100px the chat stacks under the map (handoff §0). */
    <main className="anim-rise mx-auto flex w-full max-w-[1680px] flex-col gap-2.5 px-4 pb-6 pt-3.5 min-[900px]:px-7">
      {/* title row */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <h1 className={cx(HEADING, "text-[1.6rem] leading-[1.1]")}>Your Progress Map</h1>
        <span className="text-[0.9rem] text-ink-soft">
          {subjectLabel} · <span dir="ltr">{started.started}</span> of{" "}
          <span dir="ltr">{started.total}</span> objectives started
        </span>
        <span className="flex-1" />
        {subjectsPresent.length > 1 && (
          <div className={SEGMENTED} role="group" aria-label="Subject">
            {subjectsPresent.map((key) => (
              <button
                key={key}
                onClick={() => {
                  setSubjectPick(key);
                  // a topic from another subject is about to leave the view
                  setSelection(null);
                }}
                aria-pressed={subject === key}
                className={segment(subject === key)}
              >
                {displayLabelOfSpineKey(key)}
              </button>
            ))}
          </div>
        )}
        <div className={SEGMENTED} role="group" aria-label="Show your map as of">
          {(
            [
              ["baseline", "Where you started"],
              ["today", "Today"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setAsOf(key)}
              aria-pressed={asOf === key}
              className={segment(asOf === key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Legend />

      <div className="flex flex-wrap items-stretch gap-[22px]">
        {/* the map panel */}
        <section
          className={cx(
            STROKE,
            "flex min-w-0 basis-full flex-col overflow-hidden rounded-[var(--play-radius)] bg-card sticker-shadow",
            "h-[max(420px,70dvh)] min-[1100px]:h-[max(520px,calc(100dvh_-_252px))] min-[1100px]:min-w-[560px] min-[1100px]:flex-1 min-[1100px]:basis-[560px]"
          )}
        >
          <PanelHeader>
            <span className="flex shrink-0 flex-col gap-1">
              <h2 className="font-display text-[1.4rem] font-extrabold leading-none text-ink">Your map</h2>
              <span className="font-display text-[0.82rem] font-bold leading-[1.2] text-ink-soft">{mapSub}</span>
            </span>
            <span className="flex-1" />
            <Breadcrumb
              chapter={path.chapter ? { id: path.chapter.id, title: path.chapter.title } : null}
              lesson={path.lesson ? { slug: path.lesson.slug, title: path.lesson.title } : null}
              onAll={() => setSelection(null)}
              onChapter={(id) => setSelection({ kind: "chapter", id })}
              onLesson={(slug) => setSelection({ kind: "lesson", slug })}
            />
          </PanelHeader>

          <div className="relative min-h-0 flex-1 overflow-clip">
            <SkillMap
              model={model}
              asOf={asOf}
              selection={selection}
              onSelect={setSelection}
              onStepUp={stepUp}
              onLevel={setLevel}
              pulses={pulses}
            />
          </div>
        </section>

        <NoorPanel
          subjectLabel={subjectLabel}
          focus={
            selection?.kind === "chapter"
              ? { kind: "chapter", id: selection.id, label: path.chapter?.title ?? "" }
              : selection?.kind === "lesson"
                ? { kind: "lesson", id: selection.slug, label: path.lesson?.title ?? "" }
                : selection?.kind === "objective"
                  ? {
                      kind: "objective",
                      id: selection.id,
                      label: model.objectiveById.get(selection.id)?.label ?? "",
                    }
                  : null
          }
          lookupQuestion={(qid) => questionsById.get(qid)}
          resolveCite={resolveCite}
          onCite={handleCite}
          onCiteClick={handleCiteClick}
          onAttemptResult={handleChatAttempt}
        />
      </div>

      {openQuestion && (
        <QuestionModal
          question={openQuestion}
          lo={data.los.find((l) => l.id === openQuestion.loId) ?? null}
          doc={data.doc}
          onClose={() => setOpenQuestion(null)}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

/** Both panel headers are this bar: 79px, honey, ink rule underneath. */
export function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx(HONEY_BAND, "flex h-[79px] shrink-0 items-center gap-3 px-[18px] py-[14px]")}>
      {children}
    </div>
  );
}

/**
 * One quiet legend line, no boxes: the five stages in words, then what the
 * two kinds of arrow mean. The colour is never the only signal (FR-3208) —
 * every stage is named here and on the map itself.
 */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 font-display text-[0.82rem] font-bold text-ink-soft">
      <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        {MASTERY_LEGEND.map((step, i) => (
          <span key={step.band} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cx(STROKE_SM, "size-[13px] rounded-[var(--play-radius-pill)]")}
              style={{ background: step.color, borderWidth: 2 }}
            />
            {masteryPhrase(i as 0 | 1 | 2 | 3 | 4)}
          </span>
        ))}
      </span>
      <span aria-hidden className="h-4 w-px" style={{ background: "var(--play-disabled-border)" }} />
      <span className="flex items-center gap-1.5">
        <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden>
          <path d="M2 6 H21" stroke="var(--ink)" strokeWidth="2.2" fill="none" />
          <path d="M19 1.5 L28 6 L19 10.5 z" fill="var(--ink)" />
        </svg>
        Links within a chapter
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden>
          <path d="M2 6 H21" stroke="var(--ink)" strokeWidth="2.2" strokeDasharray="4.5 3" fill="none" />
          <path d="M19 1.5 L28 6 L19 10.5 z" fill="var(--ink)" />
        </svg>
        Links across chapters
      </span>
    </div>
  );
}

/** All chapters › {chapter} › {lesson}; the current crumb is a white sticker pill. */
function Breadcrumb({
  chapter,
  lesson,
  onAll,
  onChapter,
  onLesson,
}: {
  chapter: { id: string; title: string } | null;
  lesson: { slug: string; title: string } | null;
  onAll: () => void;
  onChapter: (id: string) => void;
  onLesson: (slug: string) => void;
}) {
  const crumbs: { key: string; label: string; go: () => void }[] = [
    { key: "all", label: "All chapters", go: onAll },
  ];
  if (chapter) crumbs.push({ key: chapter.id, label: chapter.title, go: () => onChapter(chapter.id) });
  if (lesson) crumbs.push({ key: lesson.slug, label: lesson.title, go: () => onLesson(lesson.slug) });
  return (
    <nav
      aria-label="Where you are on the map"
      className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden pb-[7px] pe-1.5 ps-1 pt-1"
    >
      {crumbs.map((c, i) => {
        const current = i === crumbs.length - 1;
        return (
          <span key={c.key} className="flex min-w-0 shrink items-center gap-1">
            {i > 0 && <span aria-hidden className="text-[0.8rem] text-ink-soft">›</span>}
            <button
              type="button"
              onClick={c.go}
              aria-current={current ? "location" : undefined}
              className={cx(
                "min-w-0 truncate whitespace-nowrap font-display text-[0.85rem] font-bold leading-none",
                current
                  ? cx(STROKE_SM, "rounded-[var(--play-radius-pill)] bg-card px-3 py-2 text-ink")
                  : "px-1 py-2 text-ink-soft hover:text-ink"
              )}
              style={current ? { boxShadow: "2px 2px 0 var(--ink)" } : undefined}
            >
              {c.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
