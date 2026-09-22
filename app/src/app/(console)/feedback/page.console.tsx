import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { ScrollList } from "@/components/console/ScrollList";
import { Chip, Empty, Figure, Panel, Td, Th, share, stamp } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import {
  getFeedbackOverview,
  parseFeedbackFilters,
  FEEDBACK_ROW_LIMIT,
  type FeedbackFilters,
  type FeedbackNote,
  type FeedbackOverview,
  type FeedbackTally,
} from "@/lib/feedback-queries";
import {
  FEEDBACK_GAP_DAYS,
  FEEDBACK_LONG_SESSION_MINUTES,
  FEEDBACK_MIN_SITTINGS,
} from "@/lib/feedback-rules";
import { SUBJECTS, displayLabel, subjectOfCourse } from "@/lib/subjects";

/**
 * Feedback — what the students say about us (FR-2808…FR-2810, migration 025).
 *
 * ---------------------------------------------------------------------------
 * THIS PAGE IS THE HUMAN PATH, AND THAT IS ITS WHOLE JOB
 * ---------------------------------------------------------------------------
 * `feedback.note` is free text written by a fourteen-year-old at the end of a
 * study session, sometimes straight after being told what she did not
 * understand. **Nothing anywhere reads it automatically** — no keyword scan,
 * no classifier, no sentiment score, and no `safety_flags` row is ever derived
 * from it. Migration 025's header carries that argument in full; the short
 * version is that a word list applied to teenagers produces false alarms in
 * bulk and false comfort in the other direction.
 *
 * What replaces it is this page, and three properties of it:
 *
 *  1. **It opens on the notes.** `parseFeedbackFilters` defaults `notesOnly`
 *     to true, so the first thing an operator meets is children's words rather
 *     than a bar chart with the words behind a filter. Counting is one click
 *     away; reading is the default.
 *  2. **Every note is printed in full.** No truncation, no "…more", no
 *     expander. A note somebody has to click to finish reading is a note
 *     somebody does not finish reading.
 *  3. **There is no "reviewed" tick, and there will not be one.** A queue with
 *     a done button is a queue people clear. `ainext_operator` holds SELECT on
 *     this table and nothing else (migration 025), so nobody can mark, edit or
 *     remove what a child said — the words stay visible, which is the property
 *     that was actually wanted.
 *
 * **The honest limit, stated rather than glossed:** this is a pull. Nothing
 * pages anybody. A note written on Friday is read when somebody next opens
 * this page. At pilot scale that is the right trade; the banner below says so
 * to the operator rather than leaving them to assume otherwise.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES UNDER **MONITOR**
 * ---------------------------------------------------------------------------
 * Beside Security and Overviews, because those three answer the same kind of
 * question — "what is happening across the pilot, and is any of it wrong?" —
 * rather than "tell me about this one person" (Students) or "what may they
 * see" (Courses, Content review). Feedback is the only one of the three that
 * carries a human voice instead of a derived number, and that is an argument
 * for putting it next to them rather than off on its own: an operator who
 * opens Overviews to find out whether the product is working meets, one link
 * away, the students saying whether it is.
 *
 * ---------------------------------------------------------------------------
 * `student-data`, NOT THE OVERVIEWS' ALL-FOUR
 * ---------------------------------------------------------------------------
 * contracts/admin.md permits the overviews to every role *because* every cell
 * in them is a count, a share, a duration or a curriculum label. This page is
 * the exact opposite and takes the exact opposite answer. `cost-billing` reads
 * no student content (FR-2406) and `content-review` must not learn a child's
 * name from a feature (FR-2707's argument again).
 *
 * ---------------------------------------------------------------------------
 * NO `operator_reads` ROW, AND THE REASON IS THE SAME AS `/security`'S
 * ---------------------------------------------------------------------------
 * `operator_reads` records that somebody opened ONE student's record; it has a
 * subject. A cross-student list has none, so writing a row per student shown
 * would turn one page view into forty audit entries and make the audit
 * unreadable — the same call `/security` already makes while showing student
 * names. Opening a student from here lands on the Student 360, which writes
 * its row as it always has.
 *
 * **`force-dynamic`** because a cached page of feedback is a page that stops
 * showing new notes, and a note nobody sees is the one failure this surface
 * exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * FILTERS ARE URLS, NEVER CLIENT STATE
 * ---------------------------------------------------------------------------
 * `FilterLink` below is a `<Link>`, and this page has no `"use client"`
 * anywhere in its own tree except the bounded `ScrollList` the security view
 * already established. Same idiom, same reasoning: a filter an operator cannot
 * paste into a message is a filter that did not happen as far as anybody
 * reading later is concerned. A third interaction idiom was not invented.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Feedback — Noor Console" };

const PATH = "/feedback";

export default async function FeedbackConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }
  const filters = parseFeedbackFilters(await searchParams);
  const view = await getFeedbackOverview(access.operatorId, filters);
  return <FeedbackPage view={view} />;
}

/* --------------------------------------------------------------- format */

/** `trigger_kind` is a machine name; a column heading is not (FR-2211). */
const TRIGGER_LABEL: Record<string, string> = {
  lesson_completed: "Finished a lesson",
  session_ended: "Finished a practice plan",
  long_session: `Sitting over ${FEEDBACK_LONG_SESSION_MINUTES} minutes`,
};

const triggerLabel = (t: string) => TRIGGER_LABEL[t] ?? t;

/** 'up' | 'down' | null, in words. Colour is never the only signal. */
function ratingWord(rating: string | null): string {
  if (rating === "up") return "Thumbs up";
  if (rating === "down") return "Thumbs down";
  return "Closed without answering";
}

/**
 * A course id to the name a person calls it, from the subject registry —
 * the same source `/courses` prints from, so the two pages cannot disagree
 * about what a course is called.
 */
/**
 * "3rd", "2nd", "11th". Small, and here rather than inline because the number
 * it formats comes from `lib/feedback-rules.ts` — writing `{N}rd` would read
 * correctly today and print "2rd" the day somebody lowers the threshold, which
 * is the kind of wrongness a reader blames the writer for rather than the code.
 */
function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function courseLabel(courseId: string | null): string {
  if (!courseId) return "No course recorded";
  const subject = subjectOfCourse(courseId);
  return subject ? displayLabel(SUBJECTS[subject]) : courseId;
}

/* ----------------------------------------------------------------- page */

function FeedbackPage({ view }: { view: FeedbackOverview }) {
  return (
    <div>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[19px] font-bold text-ink">Feedback</h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
          environment {view.environment}
        </p>
      </header>

      <ReadThisFirst view={view} />
      <Shape view={view} />
      <FiltersBar view={view} />
      <Notes view={view} />
      <HowOftenWeAsk />
    </div>
  );
}

/**
 * The banner, and it is not decoration.
 *
 * It says three things an operator cannot work out from the table: that these
 * are children's words, that nothing has read them before this page did, and
 * that there is no alerting behind it. The third is the one somebody would
 * otherwise assume — every other Monitor surface has an alert rule behind it
 * (`lib/alerts.ts`), and assuming this one does too is how a note sits unread
 * for a week while somebody waits for an email that was never going to come.
 *
 * `gold` rather than `rust`: `components/console/ui.tsx` reserves the rust
 * family deliberately, and gold is this console's "look here" colour. Every
 * value is a token with its paired foreground (constitution XII).
 */
function ReadThisFirst({ view }: { view: FeedbackOverview }) {
  return (
    <section className="mt-4 rounded-lg border border-gold/50 bg-gold-wash px-4 py-3">
      <p className="text-[13px] font-semibold text-ink">
        These are students&rsquo; own words, and you are the first reader.
      </p>
      <p className="mt-1 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-soft">
        Nothing scans, scores or classifies a note — no keyword list, no sentiment model, and
        no safety flag is ever raised from one. That is deliberate (migration 025): a word
        list applied to teenagers produces false alarms in bulk and false comfort in the other
        direction. <strong className="font-semibold text-ink">It also means nothing will
        email you.</strong> A note written on Friday is read when somebody opens this page.
      </p>
      <p className="mt-1 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-soft">
        A note can carry more than an opinion — distress, something happening at home, another
        person&rsquo;s name. If one does, it is a person&rsquo;s job to act on it, not this
        page&rsquo;s. Nothing here can edit or delete what a child wrote, by design.
        {view.totals.withNote > 0 ? (
          <>
            {" "}
            <strong className="font-semibold text-ink">
              {view.totals.withNote} note{view.totals.withNote === 1 ? "" : "s"}
            </strong>{" "}
            {view.totals.withNote === 1 ? "has" : "have"} been written in this environment.
          </>
        ) : null}
      </p>
    </section>
  );
}

/** The counting half: totals, then the same tally cut three ways. */
function Shape({ view }: { view: FeedbackOverview }) {
  const { totals } = view;
  const answered = totals.up + totals.down;
  return (
    <Panel
      title="The shape of it"
      note={
        <>
          Every answer in this environment, unfiltered — the tallies below do <em>not</em>{" "}
          follow the filters, so one student&rsquo;s four thumbs down never read as the
          cohort&rsquo;s verdict.
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Thumbs up"
          value={totals.up}
          unit="answers"
          period="all time"
          hint={answered > 0 ? share(totals.up, answered) : "nothing answered yet"}
        />
        <Figure
          label="Thumbs down"
          value={totals.down}
          unit="answers"
          period="all time"
          hint={answered > 0 ? share(totals.down, answered) : "nothing answered yet"}
        />
        <Figure
          label="Closed without answering"
          value={totals.dismissed}
          unit="prompts"
          period="all time"
          hint="A dismissal is recorded so the student is not asked again for a fortnight."
        />
        <Figure
          label="Carrying a note"
          value={totals.withNote}
          unit="answers"
          period="all time"
          hint="The rest are a thumb and nothing else, which is a complete answer."
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <TallyTable title="By week" rows={view.byWeek} label={(k) => `week of ${k}`} />
        <TallyTable title="By trigger" rows={view.byTrigger} label={triggerLabel} />
        <TallyTable title="By course" rows={view.byCourse} label={courseLabel} />
      </div>
    </Panel>
  );
}

/**
 * One tally, three columns and a ratio.
 *
 * The ratio is printed by `share`, which always carries its denominator —
 * "80% (4 of 5)" — because at pilot volume a bare percentage of five answers
 * is a number that will be quoted at a meeting and should not be.
 */
function TallyTable({
  title,
  rows,
  label,
}: {
  title: string;
  rows: FeedbackTally[];
  label: (key: string) => string;
}) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-soft">Nothing yet.</p>
      ) : (
        <table className="mt-1 w-full border-collapse text-[12.5px] text-ink">
          <thead className="text-ink-faint">
            <tr>
              <Th>{title.replace(/^By /, "")}</Th>
              <Th right>Up</Th>
              <Th right>Down</Th>
              <Th right>Up share</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line-soft">
                <Td>{label(r.key)}</Td>
                <Td right mono>
                  {r.up}
                </Td>
                <Td right mono>
                  {r.down}
                </Td>
                <Td right>{r.up + r.down > 0 ? share(r.up, r.up + r.down) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- filters */

/**
 * One place every link is built, so no filter link can forget to carry a
 * dimension a reader had already chosen — `security/page.console.tsx`'s
 * `hrefFor` with this page's four dimensions instead of that one's seven.
 */
function hrefFor(filters: FeedbackFilters, patch: Partial<FeedbackFilters>): string {
  const next: FeedbackFilters = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.trigger) params.set("trigger", next.trigger);
  if (next.rating) params.set("rating", next.rating);
  // `notesOnly` is the DEFAULT, so it is the un-set state that carries a
  // parameter. Writing `notes=notes` for the default would put a parameter in
  // every URL an operator pastes, and the one that matters would be the one
  // that is absent.
  if (!next.notesOnly) params.set("notes", "all");
  if (next.student != null) params.set("student", String(next.student));
  const qs = params.toString();
  return qs ? `${PATH}?${qs}` : PATH;
}

function FiltersBar({ view }: { view: FeedbackOverview }) {
  const f = view.filters;
  return (
    <Panel
      title="Filters"
      note="Every combination below is a URL — bookmark one, paste it into a message, or hand it to someone else exactly as it is."
    >
      <FilterGroup label="Show">
        <FilterLink href={hrefFor(f, { notesOnly: true })} active={f.notesOnly}>
          notes only
        </FilterLink>
        <FilterLink href={hrefFor(f, { notesOnly: false })} active={!f.notesOnly}>
          every answer
        </FilterLink>
      </FilterGroup>

      <FilterGroup label="Answer">
        <FilterLink href={hrefFor(f, { rating: null })} active={f.rating === null}>
          everything
        </FilterLink>
        <FilterLink href={hrefFor(f, { rating: "up" })} active={f.rating === "up"}>
          thumbs up
        </FilterLink>
        <FilterLink href={hrefFor(f, { rating: "down" })} active={f.rating === "down"}>
          thumbs down
        </FilterLink>
        <FilterLink href={hrefFor(f, { rating: "dismissed" })} active={f.rating === "dismissed"}>
          closed without answering
        </FilterLink>
      </FilterGroup>

      <FilterGroup label="Asked by">
        <FilterLink href={hrefFor(f, { trigger: null })} active={f.trigger === null}>
          everything
        </FilterLink>
        {(["lesson_completed", "session_ended", "long_session"] as const).map((t) => (
          <FilterLink key={t} href={hrefFor(f, { trigger: t })} active={f.trigger === t}>
            {triggerLabel(t)}
          </FilterLink>
        ))}
      </FilterGroup>

      {view.studentOptions.length > 0 ? (
        <FilterGroup label="Who">
          <FilterLink href={hrefFor(f, { student: null })} active={f.student === null}>
            everyone
          </FilterLink>
          {view.studentOptions.map((s) => (
            <FilterLink key={s.id} href={hrefFor(f, { student: s.id })} active={f.student === s.id}>
              {s.name}
            </FilterLink>
          ))}
        </FilterGroup>
      ) : null}
    </Panel>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function FilterLink({
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
      className={`rounded px-2 py-0.5 text-[11.5px] font-medium ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:bg-line-soft hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------- notes */

/**
 * The list, newest first, inside the bounded `ScrollList` the security view
 * established — one scroll region, a sticky header, a `vh`-based cap.
 *
 * Newest first, against the tallies' oldest-first, and the difference is
 * deliberate: a tally is a trend and reads forwards, a note is something
 * somebody said and the most recent one matters most.
 */
function Notes({ view }: { view: FeedbackOverview }) {
  const f = view.filters;
  return (
    <Panel
      title={f.notesOnly ? "What they wrote" : "Every answer"}
      note={
        <>
          {view.capped ? (
            <>
              <strong>The most recent {FEEDBACK_ROW_LIMIT}</strong>, newest first — this is a
              cap, not a count. Narrow with the filters above to see past it.
            </>
          ) : (
            <>
              <strong>
                {view.rows.length} {f.notesOnly ? "note" : "answer"}
                {view.rows.length === 1 ? "" : "s"}
              </strong>
              , newest first.
            </>
          )}{" "}
          Every note is printed in full — nothing here is shortened, and nothing in this
          console can change or remove one.
        </>
      }
    >
      {view.rows.length === 0 ? (
        <Empty>
          {f.notesOnly
            ? "No notes match. A thumb with no note is a complete answer, so try “every answer”."
            : "Nothing matches these filters yet."}
        </Empty>
      ) : (
        <ScrollList
          ariaLabel="Student feedback, newest first"
          header={
            <div className="flex items-baseline justify-between px-4 py-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
                Student · when · what asked
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
                {view.rows.length} shown
              </span>
            </div>
          }
        >
          {view.rows.map((r) => (
            <NoteRow key={r.id} row={r} />
          ))}
        </ScrollList>
      )}
    </Panel>
  );
}

/**
 * One answer.
 *
 * The note is rendered in a `<p>` with `whitespace-pre-wrap` and **`dir="auto"`**
 * — the one place on this console where direction is decided by the content
 * rather than by the page. A child on an Arabic course writes Arabic into this
 * box; rendering her sentence left-to-right would put its punctuation in the
 * wrong place and read as carelessness about her language. `auto` takes the
 * direction from the first strong character, which is exactly right for a
 * field that can hold either script and sometimes both.
 */
function NoteRow({ row }: { row: FeedbackNote }) {
  return (
    <article className="border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* FR-2211: the identifier is never shown alone. */}
        <Link
          href={`/students/${row.studentId}`}
          className="text-[13px] font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
        >
          {row.studentName} #{row.studentId}
        </Link>
        <span className="font-mono text-[11px] text-ink-faint">{stamp(row.createdAt)}</span>
        <Chip tone={row.rating === "up" ? "good" : row.rating === "down" ? "attention" : "neutral"}>
          {ratingWord(row.rating)}
        </Chip>
        <Chip>{triggerLabel(row.trigger)}</Chip>
      </div>

      <p className="mt-1 text-[12px] text-ink-soft">
        {courseLabel(row.courseId)}
        {row.lessonSlug ? ` · lesson ${row.lessonSlug}` : " · practice plan"}
        {row.sessionRef != null ? (
          <>
            {" · "}
            <Link
              href={`/students/${row.studentId}/sessions/${row.sessionRef}`}
              className="underline decoration-line underline-offset-2 hover:decoration-ink"
            >
              the session it followed
            </Link>
          </>
        ) : (
          // FR-2309's gap, shown as a gap. A session we could not establish is
          // never guessed at, here or anywhere else.
          " · no session recorded"
        )}
      </p>

      {row.note ? (
        <p
          dir="auto"
          className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-paper-deep px-3 py-2 text-[13.5px] leading-relaxed text-ink"
        >
          {row.note}
        </p>
      ) : null}
    </article>
  );
}

/**
 * The cadence, printed where an operator can read it.
 *
 * It is here because the first question anybody asks of a feedback surface is
 * "why is there so little of it", and the answer is a rule somebody chose
 * rather than a signal about the product. Every number comes from
 * `lib/feedback-rules.ts` — there is no second copy of them on this page.
 */
function HowOftenWeAsk() {
  return (
    <Panel title="How often a student is asked">
      <ul className="max-w-[80ch] list-disc space-y-1 ps-5 text-[12.5px] leading-relaxed text-ink-soft">
        <li>
          At the end of a lesson or a practice plan, never in the middle of either, and never
          as something that blocks the screen.
        </li>
        <li>
          At most once every <strong className="text-ink">{FEEDBACK_GAP_DAYS} days</strong>,
          counting from the last time she was asked — whether she answered or closed it.
        </li>
        <li>
          Never twice about the same sitting, and never before her{" "}
          <strong className="text-ink">{ordinal(FEEDBACK_MIN_SITTINGS)}</strong> finished sitting:
          a child asked after her first lesson is rating that lesson, not us.
        </li>
        <li>
          A sitting over{" "}
          <strong className="text-ink">{FEEDBACK_LONG_SESSION_MINUTES} minutes</strong> is
          recorded as a long session, so a tired answer can be told apart from a quick one.
        </li>
      </ul>
    </Panel>
  );
}
