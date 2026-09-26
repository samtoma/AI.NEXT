import Link from "next/link";
import type { SectionIndex } from "@/lib/book-sections";
import {
  addContentFigures,
  bookSections,
  contentByLesson,
  sectionChecks,
  getContentAdminView,
  rollUpBySection,
  scopeContentView,
  type ContentAdminView,
} from "@/lib/content-admin";
import { COURSE_IDS, PREP3_ARABIC_AR, isCourseId } from "@/lib/courses";
import { courseName, coursesByCurriculum } from "@/lib/console-course-names";
import { questionProvenance } from "@/lib/provenance";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { TeX } from "@/components/TeX";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import { IS_MVP1 } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = { title: "Content review — Noor Console" };

/**
 * Re-homed from `/admin/content` (ADR-0014). The page body below is unchanged;
 * what is new is the door in front of it.
 *
 * `content-review` is a **safety control**, not an administrative convenience
 * (FR-2204, constitution III): whoever holds it decides what unreviewed,
 * pipeline-generated content reaches a child. It used to be a build flag —
 * `AINEXT_INTERNAL_SURFACES` — which could tell a build from a build but not
 * one person from another. Now it is a role held by a named person, and
 * exercising it is recorded.
 */
const PATH = "/content";

export default async function ContentConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }
  const raw = (await searchParams).course;
  const course = COURSES.find((c) => c.courseId === raw)?.courseId ?? null;
  return <ContentAdminPage operatorId={access.operatorId} course={course} />;
}

/**
 * The courses, in course-registry order (curriculum, then subject), as the
 * switcher offers them, grouped by curriculum (contracts/console.md). Two
 * courses can share a subject since 003, so each is named by the course and
 * its curriculum — "Mathematics — Grade 10 (American)" (`courseName`).
 */
const COURSES = COURSE_IDS.map((id) => ({ courseId: id as string, label: courseName(id) }));

function courseLabel(courseId: string | null): string {
  return courseName(courseId);
}

/**
 * /admin/content — where did every question come from, and has a human read it?
 *
 * This exists because the database has carried provenance since ADR-0008 while
 * nothing showed it. "We authorised unreviewed content" and "we can see which
 * content is unreviewed" are different claims, and only the second one is a
 * control. FR-1108 asks for the count to be reportable on demand; a number in
 * a parity-check log is reportable to whoever runs the parity check, which is
 * not the same as reportable to whoever is responsible.
 *
 * Operator surface, not a student one. It shows stems and answers-adjacent
 * metadata and is reachable only from the internal nav.
 */
async function ContentAdminPage({
  operatorId,
  course,
}: {
  operatorId: number;
  course: string | null;
}) {
  const bank = await getContentAdminView(operatorId);
  const view = scopeContentView(bank, course);
  // the selected course's book sections (migration 034), for FR-4319
  const sections = course ? await bookSections(operatorId, [course]) : null;
  const scope = course ? courseLabel(course) : "Every course";

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="rule-label">Content provenance</p>
        <h1 className="mt-1 font-display text-[26px] font-bold text-ink">
          Where every question came from
        </h1>
        <p className="mt-1 max-w-[70ch] text-[14px] text-ink-soft">
          Three states, and the one that matters is whether a human has read the
          item — not whether a machine wrote it. Generated rows sort to the top,
          unchecked before checked.
        </p>
      </header>

      {!IS_MVP1 && (
        <div
          className="mb-6 rounded-xl border px-4 py-3 text-[14px]"
          style={{ borderColor: "var(--gold)", background: "var(--gold-wash)" }}
        >
          This is the <strong>baseline</strong> environment. It must carry no
          generated content at all — any row below tagged “generated” is a
          governance breach, not a content difference (constitution III).
        </div>
      )}

      {/* The switcher is over COURSES, grouped by curriculum (FR-4104,
          contracts/console.md) — never over subjects, and "every course" is
          a side-by-side breakdown, never one pooled figure: two courses of
          one subject are two rows, not a sum. */}
      <nav aria-label="Course" className="mb-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <SubjectLink href={PATH} active={course === null}>
            Every course, side by side
          </SubjectLink>
        </div>
        {coursesByCurriculum().map((g) => (
          <div key={g.curriculum} className="flex flex-wrap items-center gap-1.5">
            <span className="w-[6.5rem] shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {g.label}
            </span>
            {g.courses.map((id) => (
              <SubjectLink
                key={id}
                href={`${PATH}?course=${encodeURIComponent(id)}`}
                active={course === id}
              >
                {courseName(id)} · {bank.rows.filter((r) => r.courseId === id).length}
              </SubjectLink>
            ))}
          </div>
        ))}
      </nav>

      {course === null ? (
        <CourseBreakdown bank={bank} />
      ) : (
        <>
          <p className="mb-3 text-[13px] text-ink-soft">
            <strong className="text-ink">{scope}</strong> — {view.rows.length} questions,{" "}
            {view.live.total} of them live. The first four tiles count live questions only.
          </p>

          <section className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Tile
              n={view.live.book}
              k="From the book · live"
              note="Extracted and gated normally"
            />
            <Tile
              n={view.live.generatedUnchecked}
              k="Generated · unchecked"
              note="Live and servable to students"
              tone="attention"
            />
            <Tile
              n={view.live.generatedChecked}
              k="Generated · read"
              note="A human read this item"
              tone="confirmed"
            />
            <Tile
              n={view.live.generatedFamilyChecked}
              k="Generated · family"
              note="A sibling was read and accepted"
              tone="confirmed"
            />
            <Tile
              n={view.pendingPromotion}
              k="Generated · waiting"
              note="Loaded, not yet servable"
            />
            <Tile
              n={view.bookHeld}
              k="From the book · held"
              note={
                course === PREP3_ARABIC_AR
                  ? "At review, not servable. Arabic scripture waits for its named checker (ADR-0006)"
                  : "At review, not servable to students"
              }
            />
          </section>
          {sections && <SectionBreakdown view={view} sections={sections} />}
        </>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left">
              <Th>Question</Th>
              {course === null && <Th>Course</Th>}
              <Th>Provenance</Th>
              <Th>Objective</Th>
              <Th>Tier</Th>
              <Th>Status</Th>
              <Th>Derived from</Th>
              <Th className="text-right">Attempts</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const prov = questionProvenance(r);
              return (
                <tr
                  key={r.id}
                  className="border-b border-line-soft align-top"
                  style={
                    prov.origin === "generated" && !prov.humanChecked
                      ? { background: "var(--gold-wash)" }
                      : undefined
                  }
                >
                  <td className="py-2.5 pr-3">
                    <span className="block font-mono text-[10.5px] text-ink-faint">
                      {r.id}
                    </span>
                    <span className="mt-0.5 block max-w-[32ch] text-ink">
                      <TeX text={r.stem} />
                    </span>
                  </td>
                  {course === null && (
                    <td className="py-2.5 pr-3 text-ink-soft">{courseLabel(r.courseId)}</td>
                  )}
                  <td className="py-2.5 pr-3">
                    <ProvenanceBadge question={r} size="md" />
                    {r.reviewedBy && (
                      <span className="mt-1 block font-mono text-[10px] text-ink-faint">
                        {r.reviewedBy}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-ink-soft">
                    <span className="block max-w-[26ch]">{r.loLabel}</span>
                    {r.sourcePage && (
                      <span className="font-mono text-[10px] text-ink-faint">
                        p.{r.sourcePage}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-ink-soft">
                    {r.tier}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-ink-soft">
                    {r.status}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[10.5px] text-ink-faint">
                    {r.parentQuestionId ?? "—"}
                  </td>
                  <td className="py-2.5 text-right font-mono text-[11px] text-ink-soft">
                    {r.attempts}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-6 max-w-[74ch] text-[13px] text-ink-soft">
        A generated item names the reviewed book question it was derived from,
        so a defect found in one can be traced to its family and that family
        retired together. What to do about a rejected family is still open —
        see{" "}
        <Link href="/spine" className="underline">
          the evidence walk
        </Link>{" "}
        for the per-question passport, and ADR-0008 for the decision that
        allowed any of this.
      </p>
    </main>
  );
}

/**
 * "Every course": the six figures per course, side by side (FR-4104,
 * FR-3212). Each row is computed from that course's rows alone
 * (`scopeContentView`), so every figure names the one course it counts, and
 * there is deliberately no total row — a sum across courses would add the two
 * maths books into one number. A question whose objective belongs to no
 * course is its own row, said as such.
 */
function CourseBreakdown({ bank }: { bank: ContentAdminView }) {
  const unfiled = bank.rows.filter((r) => !isCourseId(r.courseId));
  const lines = [
    ...COURSE_IDS.map((id) => ({ key: id as string, label: courseName(id), view: scopeContentView(bank, id) })),
    ...(unfiled.length > 0
      ? [
          {
            key: "unfiled",
            label: "No course recorded",
            view: scopeContentView({ ...bank, rows: unfiled }, null),
          },
        ]
      : []),
  ];
  return (
    <section className="mb-7">
      <p className="mb-2 text-[13px] text-ink-soft">
        Each row counts one course. Choose a course above for its tiles and nothing else.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left">
              <Th>Course</Th>
              <Th className="text-right">From the book · live</Th>
              <Th className="text-right">Generated · unchecked</Th>
              <Th className="text-right">Generated · read</Th>
              <Th className="text-right">Generated · family</Th>
              <Th className="text-right">Generated · waiting</Th>
              <Th className="text-right">From the book · held</Th>
              <Th className="text-right">Questions</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ key, label, view }) => (
              <tr key={key} className="border-b border-line-soft">
                <td className="py-2 pr-3 text-ink">{label}</td>
                <td className="py-2 pr-3 text-right font-mono">{view.live.book}</td>
                <td className="py-2 pr-3 text-right font-mono">{view.live.generatedUnchecked}</td>
                <td className="py-2 pr-3 text-right font-mono">{view.live.generatedChecked}</td>
                <td className="py-2 pr-3 text-right font-mono">{view.live.generatedFamilyChecked}</td>
                <td className="py-2 pr-3 text-right font-mono">{view.pendingPromotion}</td>
                <td className="py-2 pr-3 text-right font-mono">{view.bookHeld}</td>
                <td className="py-2 text-right font-mono">{view.rows.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One course's figures per book SECTION, with its lessons beneath (003,
 * FR-4319, decision 18). A split section's parts roll up into one section
 * row whose figures are computed from its parts' rows (`rollUpBySection`).
 * The units are `lib/book-sections.ts`'s, from the store (migration 034); a
 * course with no store rows — every National course until the loader writes
 * them — is one row per lesson, which is exactly what a National lesson is.
 */
function SectionBreakdown({
  view,
  sections: store,
}: {
  view: ContentAdminView;
  sections: { index: SectionIndex; storeProblems: string[] };
}) {
  const lessons = contentByLesson(view.rows);
  const sections = rollUpBySection(lessons, store.index, addContentFigures);
  const problems = sectionChecks(lessons, store);
  if (sections.length === 0) return null;
  const cells = (f: ReturnType<typeof addContentFigures>) => (
    <>
      <td className="py-1.5 pr-3 text-right font-mono">{f.bookLive}</td>
      <td className="py-1.5 pr-3 text-right font-mono">{f.generatedUnchecked}</td>
      <td className="py-1.5 pr-3 text-right font-mono">
        {f.generatedChecked + f.generatedFamily}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono">{f.waiting}</td>
      <td className="py-1.5 pr-3 text-right font-mono">{f.held}</td>
      <td className="py-1.5 text-right font-mono">{f.questions}</td>
    </>
  );
  return (
    <section className="mb-7">
      <h2 className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
        By book section and lesson
      </h2>
      <p className="mb-2 max-w-[80ch] text-[12.5px] text-ink-soft">
        A section split into parts is one row, counted from its parts&rsquo; rows, with each part
        beneath it. In catalogue order.
      </p>
      <p className="mb-2 text-[12.5px] text-ink-soft">
        <strong className="text-ink">Book-section checks:</strong>{" "}
        {problems.length === 0
          ? store.index.hasSplits
            ? "every split section's parts are consecutive, in part order, and numbered 1 to m."
            : "no split section in this course."
          : `${problems.length} to look at.`}
      </p>
      {problems.length > 0 && (
        <ul className="mb-2 list-disc ps-5 text-[12.5px] text-ink">
          {problems.map((p) => (
            <li key={p} className="font-mono text-[11.5px]">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <Th>Section · lesson</Th>
              <Th className="text-right">Book · live</Th>
              <Th className="text-right">Generated · unchecked</Th>
              <Th className="text-right">Generated · read</Th>
              <Th className="text-right">Waiting</Th>
              <Th className="text-right">Book · held</Th>
              <Th className="text-right">Questions</Th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => (
              <SectionRows key={sec.key} sec={sec} cells={cells} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SectionRows({
  sec,
  cells,
}: {
  sec: ReturnType<typeof rollUpBySection<ReturnType<typeof addContentFigures>>>[number];
  cells: (f: ReturnType<typeof addContentFigures>) => React.ReactNode;
}) {
  return (
    <>
      <tr className="border-b border-line-soft">
        <td className="py-1.5 pr-3 text-ink">
          {sec.label}
          {sec.parts.length > 1 && (
            <span className="ms-2 font-mono text-[10.5px] text-ink-faint">{sec.parts.length} parts</span>
          )}
        </td>
        {cells(sec.figures)}
      </tr>
      {sec.parts.length > 1 &&
        sec.parts.map((p) => (
          <tr key={p.lessonSlug} className="border-b border-line-soft text-ink-soft">
            <td className="py-1 pe-3 ps-5 font-mono text-[11px]">
              {p.lessonSlug}
              {p.partN != null && p.partOf != null ? ` · part ${p.partN} of ${p.partOf}` : ""}
            </td>
            {cells(p.figures)}
          </tr>
        ))}
    </>
  );
}

function SubjectLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`ds-control-quiet rounded px-2.5 py-1 text-[12.5px] font-medium ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:bg-line-soft hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`pb-2 pr-3 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint ${className}`}
    >
      {children}
    </th>
  );
}

function Tile({
  n,
  k,
  note,
  tone,
}: {
  n: number;
  k: string;
  note: string;
  tone?: "attention" | "confirmed";
}) {
  const colour =
    tone === "attention"
      ? "var(--gold)"
      : tone === "confirmed"
        ? "var(--noor-progress, var(--accent))"
        : "var(--ink)";
  return (
    <div className="ledger-card px-4 py-3">
      <span
        className="block font-display text-[30px] font-bold leading-none"
        style={{ color: colour }}
      >
        {n}
      </span>
      <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        {k}
      </span>
      <span className="mt-0.5 block text-[12.5px] text-ink-soft">{note}</span>
    </div>
  );
}
