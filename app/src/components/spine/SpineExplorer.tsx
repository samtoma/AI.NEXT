"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AttemptResult,
  SpineCourse,
  SpineData,
  SpineQuestion,
  SpineSubject,
} from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { SkillMap } from "./SkillMap";
import { displayStem } from "@/lib/question-figures";
import { MathText } from "@/components/MathText";
import { plainMath } from "@/lib/math-text";
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
import { displayLabelOfSpineKey, spineSubjectDef } from "@/lib/subjects";
import { HEADING, HONEY_BAND, STROKE, STROKE_SM, cx } from "@/components/sticker";
import { BEING_PREPARED, type PreparingChapter } from "@/lib/course-outline";

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
 * Since 003 the unit is the COURSE, not the subject (FR-4009): two maths
 * books are two maps, each in its own book's order and citing its own book.
 */
export function SpineExplorer({ data }: { data: SpineData }) {
  const router = useRouter();
  const [asOf, setAsOf] = useState<AsOf>("today");
  /* COURSE, NOT SUBJECT (FR-4009, T372). The courses on the map, in course
     order, each with its own book (`getSpineData`). A National student sees
     one course per subject, so this is the subject picker she always had —
     same entries, same order, same labels. A tester whose exception shows her
     the other curriculum's maths gets TWO maths entries, named by their
     course labels, and never one "Mathematics" map merging two books. */
  const coursesPresent = data.courses;
  /** a course's picker label: its subject's, unless another course shares it */
  const courseLabel = useCallback(
    (c: SpineCourse) =>
      c.subject !== null &&
      coursesPresent.filter((o) => o.subject === c.subject).length === 1
        ? displayLabelOfSpineKey(c.subject)
        : c.label,
    [coursesPresent]
  );
  const [coursePick, setCoursePick] = useState<string | null>(null);
  const course: SpineCourse | null =
    coursesPresent.find((c) => c.id === coursePick) ?? coursesPresent[0] ?? null;
  const subject: SpineSubject | null = course?.subject ?? null;
  /** the book of the course being looked at — never the first course's */
  const courseDoc = course?.doc ?? data.doc;
  const visibleLos = useMemo(
    () =>
      course === null || coursesPresent.length <= 1
        ? data.los
        : data.los.filter((l) => l.courseId === course.id),
    [data.los, course, coursesPresent.length]
  );
  /* The prerequisites the map draws: the book's own, plus — for a course with a
     split book section — the part n-1 → part n ones the product derives
     (FR-4317, `SpineData.partEdges`). With no split section — every National
     course — it is `data.edges` itself, the very array it always was. */
  const mapEdges = useMemo(
    () => (data.partEdges.length === 0 ? data.edges : [...data.edges, ...data.partEdges]),
    [data.edges, data.partEdges]
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const model = useMemo(
    // `data.sectionGroups` — the book sections split into parts (FR-4315): the
    // model groups each one's parts on its chapter's ring and the canvas draws
    // the tray and names it. Groups whose objectives are not on the map (another
    // course's) place nothing; with no split section — every National course —
    // the model is the one main builds.
    () => buildSkillMap(visibleLos, mapEdges, data.lessonTitles, data.sectionGroups),
    [visibleLos, mapEdges, data.lessonTitles, data.sectionGroups]
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
  /** the book a question's own course is built from (its provenance plate) */
  const docOfLo = useCallback(
    (loId: string) => {
      const id = losById.get(loId)?.courseId;
      return data.courses.find((c) => c.id === id)?.doc ?? courseDoc;
    },
    [losById, data.courses, courseDoc]
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
          title: plainMath(lo.label),
          sub: `${masteryPhrase(stage)}${lo.sourcePage ? ` · book p.${lo.sourcePage}` : ""}`,
        };
      }
      if (c.kind === "q") {
        const q = questionsById.get(c.id);
        return q
          ? {
              title: ((s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s))(displayStem(q.stem)),
              sub: q.provenance.sourcePage
                ? `From the book, p.${q.provenance.sourcePage}`
                : "From the book",
            }
          : null;
      }
      // A page is a page of the book of the course on screen (FR-4205): Noor's
      // answer here is about the map being looked at, and naming the first
      // course's book for another course's page is a wrong citation.
      return {
        title: courseDoc.title,
        sub: `${courseDoc.publisher} · page ${c.id}`,
      };
    },
    [losById, questionsById, courseDoc]
  );

  const handleChatAttempt = useCallback(
    (r: AttemptResult, _q: SpineQuestion) => {
      void _q;
      pulseLo([r.loId]);
      router.refresh(); // re-query mastery → the fills move
    },
    [pulseLo, router]
  );

  // What the title row and Ask Noor call the map: the subject's own name when
  // it is the only course of that subject (exactly what a National student has
  // always read), the course's name when two courses share it.
  const subjectLabel = course
    ? subject &&
      coursesPresent.filter((o) => o.subject === subject).length === 1
      ? (spineSubjectDef(subject)?.label ?? displayLabelOfSpineKey(subject))
      : course.label
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
        {coursesPresent.length > 1 && (
          <div className={SEGMENTED} role="group" aria-label="Subject">
            {coursesPresent.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCoursePick(c.id);
                  // a topic from another course is about to leave the view
                  setSelection(null);
                }}
                aria-pressed={course?.id === c.id}
                className={segment(course?.id === c.id)}
              >
                {courseLabel(c)}
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

      {/* THE REST OF THE BOOK (migration 037, lib/course-outline.ts): the
          chapters of this course's book with no lesson prepared yet, in book
          order — one placeholder each, named and nothing more. No objective
          is invented for them and nothing here opens or starts anything; a
          chapter joins the map below by itself, as a cluster, the moment its
          content is loaded (FR-4327). Absent for every course with no outline. */}
      {course?.preparing && course.preparing.length > 0 && (
        <ChaptersBeingPrepared chapters={course.preparing} />
      )}

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
          doc={docOfLo(openQuestion.loId)}
          onClose={() => setOpenQuestion(null)}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The chapters still being prepared, as one quiet row above the map.
 *
 * Placeholders, not topics: each is a chapter's name in the design system's
 * "not ready yet" anatomy — a dashed `--play-disabled-border` outline, no
 * fill, no shadow, no press (globals.css; SubjectHome's MoreSubjectsComing) —
 * with its text in `--play-text-muted` (6.9:1), because they are not
 * controls. They sit OUTSIDE the map: the map is a graph of objectives and
 * their prerequisites, and an unprepared chapter has neither, so a cluster for
 * it on the canvas would be a fake objective. One row that scrolls sideways,
 * so thirteen chapters cost the map one short strip rather than a block.
 *
 * "Chapter 1 — Algebraic expressions" arrives as one label; split on the em
 * dash like the check-in's units, the reference as a mono eyebrow.
 */
function ChaptersBeingPrepared({ chapters }: { chapters: readonly PreparingChapter[] }) {
  return (
    <section
      aria-labelledby="chapters-being-prepared"
      className="thin-scroll flex shrink-0 items-center gap-3 overflow-x-auto py-1"
    >
      <h2
        id="chapters-being-prepared"
        className="shrink-0 font-display text-[0.78rem] font-bold leading-none text-[color:var(--play-text-muted)]"
      >
        {BEING_PREPARED}
      </h2>
      <ul className="flex gap-2">
        {chapters.map((c) => {
          const [ref, ...rest] = c.label.split(" — ");
          const name = rest.join(" — ") || c.label;
          return (
            <li
              key={c.id}
              className="flex shrink-0 items-center gap-2 rounded-[var(--play-radius-sm)] border-[length:var(--play-stroke-sm)] border-dashed border-[color:var(--play-disabled-border)] px-3 py-1.5"
            >
              {ref !== name && (
                <span className="font-mono text-[0.66rem] uppercase leading-none tracking-[0.06em] text-[color:var(--play-text-muted)]">
                  {ref}
                </span>
              )}
              <span className="whitespace-nowrap font-display text-[0.8rem] font-bold leading-none text-[color:var(--play-text-muted)]">
                {name}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
              {/* a lesson's name may carry maths when it falls back to its first objective (backlog #37) */}
              <MathText text={c.label} />
            </button>
          </span>
        );
      })}
    </nav>
  );
}
