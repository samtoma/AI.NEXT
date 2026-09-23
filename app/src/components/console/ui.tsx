/**
 * The console's small shared parts, and the place FR-2211 is enforced rather
 * than remembered ("Obligations on every view", contracts/admin.md).
 *
 * The obligations are four sentences, and four sentences repeated across a
 * dozen panels is four sentences that drift. So they are components:
 *
 *  · `<Figure>` takes a **unit** and refuses to render without one, and takes a
 *    **period** it prints beside the number. A figure with no unit cannot be
 *    built here, which is stronger than a review that notices one that has.
 *  · `<Cost>` always prints *imputed at list price*. There is no prop to turn
 *    that off, because the runtime is a Claude subscription and the number is
 *    an imputation at published rates — "spent" would be a claim about a bank
 *    account (research A4.4).
 *  · every view that shows an identifier shows it **beside the name it belongs
 *    to** — `Omar Hassan #3`, never `#3`. That one is a habit rather than a
 *    component: the name and the id sit inside links and headings whose
 *    markup differs per view, and a wrapper that had to be told where it was
 *    would be a component in name only.
 *  · `<Th>` is a column heading in prose. It cannot stop somebody typing
 *    `last_login_at`, but every heading in the console goes through it, so the
 *    rule has one place to be read next to.
 *
 * **Tokens only, and no red or coral.** Every colour below is a design-system
 * token with its paired `on-` foreground (constitution XII, FR-2209). The rust
 * family is deliberately unused across the console: a wrong answer, a failed
 * parse and a low mastery estimate are all states of a fourteen-year-old's
 * learning, and an internal tool that paints them as alarms teaches the reader
 * to read them as faults. Gold is the "look here" colour; the progress tint
 * (`bg-progress/15`, ink text) is "this went well"; ink and its tints are
 * everything else.
 *
 * **Say what an element IS, and Play sizes it** (review 2026-09-23, F10). The
 * Play variant's blanket pass gives every `border` a 3px ink sticker edge,
 * which is right for a `Panel` and wrong for a 10px state word or a 20px
 * button. So console markup carries one semantic class per element, styled
 * in `globals.css` and inert in any variant that does not define it:
 * `ds-tag` (a label — `Chip` below), `ds-control` + `play-pressable` (a
 * button or a link styled as one), `ds-control-quiet` (a borderless nav link,
 * filter or Cancel), `ds-field` (an input or select), `ds-empty` (a region or
 * data mark with nothing in it). Tables inside the console shell read in the
 * dense data type through `ds-dense` on the shell itself.
 */

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ frames */

export function Panel({
  title,
  note,
  children,
  right,
}: {
  title: string;
  /** One line under the heading: what the panel counts and over what period. */
  note?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-5 rounded-lg border border-line bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
          {title}
        </h2>
        {right}
      </div>
      {note ? (
        <p className="border-b border-line-soft px-4 py-2 text-[12.5px] leading-relaxed text-ink-soft">
          {note}
        </p>
      ) : null}
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed text-ink-soft">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ figures */

/**
 * A number with its unit and the period it covers. Both are required: a
 * console figure without them is the defect FR-2211 names.
 */
export function Figure({
  label,
  value,
  unit,
  period,
  hint,
}: {
  label: string;
  value: string | number;
  /** "attempts", "minutes", "sessions", "US dollars" — never blank. */
  unit: string;
  /** "all time", "last 30 days", "this session" — never blank. */
  period: string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold leading-tight text-ink">
        {value}{" "}
        <span className="text-[12px] font-normal text-ink-soft">{unit}</span>
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-faint">{period}</p>
      {hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{hint}</p> : null}
    </div>
  );
}

/** US dollars, imputed at list price. There is no other way to print money here. */
export function Cost({ usd, period }: { usd: number; period: string }) {
  return (
    <Figure
      label="Cost"
      value={`$${usd.toFixed(4)}`}
      unit="US dollars, imputed at list price"
      period={period}
      hint="The tutor runs on a Claude subscription: no money left an account per turn."
    />
  );
}

/* ------------------------------------------------------------------- tables */

export function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] ${
        right ? "text-end" : "text-start"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right = false,
  mono = false,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${right ? "text-end" : "text-start"} ${
        mono ? "font-mono text-[12px]" : ""
      }`}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------- time */

/**
 * One timestamp format across the console, and it says UTC.
 *
 * The pilot is in Cairo and the server is not, so a bare "14:32" is a question
 * rather than a fact. Rendering the zone is cheaper than the twenty minutes
 * somebody will otherwise spend deciding whether a session happened during
 * school.
 */
export function stamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** A percentage with its denominator, because "80%" of five is not a rate. */
export function share(n: number, of: number): string {
  if (of <= 0) return "—";
  return `${Math.round((n / of) * 100)}% (${n} of ${of})`;
}

/* ------------------------------------------------------------------- chips */

export type ChipTone = "neutral" | "good" | "attention";

/**
 * A short state word. **The word is always present** — the colour is a second
 * signal, never the only one, so the state survives a greyscale print and a
 * colourblind reader (the same rule `WidgetShell` enforces for students).
 */
export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  const skin =
    tone === "good"
      ? "border-progress/60 bg-progress/15 text-ink"
      : tone === "attention"
        ? "border-gold/50 bg-gold-wash text-gold"
        : "border-line bg-paper-deep text-ink-soft";
  return (
    <span
      className={`ds-tag inline-block whitespace-nowrap rounded border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.08em] ${skin}`}
    >
      {children}
    </span>
  );
}
