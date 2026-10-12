/**
 * Which names the Your Progress Map writes, and the rule that keeps them from
 * landing on top of each other (FR-3224, Tamer 2026-10-01).
 *
 * TEXT FOLLOWS THE SELECTION, NOT THE ZOOM ALONE. Tapping into the map zooms to
 * what was tapped, so the zoom and the selection agree and only that part of
 * the map has text. Zooming with −, +, Fit or the wheel changes the level
 * without changing the selection; when labels were keyed to the level alone,
 * that switched on every lesson name or every objective box at once. So:
 *
 *  · something selected → only its own chapter's lesson names, and only its
 *    own (and linked) objective boxes, at any zoom;
 *  · nothing selected → everything the level allows, but through `declutter`,
 *    which keeps the most important labels and drops any that would overlap.
 *
 * A split book section's label ("1.7 Factorisation", FR-4315) is one more kind
 * of name, following the same rule: from the lessons level on (a section is
 * several lessons; at the chapters level there is no room to write it), and,
 * with something selected, only the selection's own chapter's. The section
 * the selected lesson belongs to is kept ahead of its neighbours.
 *
 * Pure: the canvas measures the labels and supplies the rectangles.
 */
import {
  focusOf,
  selectionPath,
  type Selection,
  type SkillMapModel,
} from "./skill-map";

export type LabelKind = "chapter" | "lesson" | "objective" | "section";

export interface LabelPick {
  kind: LabelKind;
  id: string;
  /** lower = more important; 0 is the selected item and is never dropped */
  priority: number;
}

/** The labels a level and a selection allow, most important first. */
export function labelCandidates(
  model: SkillMapModel,
  sel: Selection,
  level: 0 | 1 | 2
): LabelPick[] {
  const out: LabelPick[] = [];
  const path = selectionPath(model, sel);
  const focus = focusOf(model, sel);

  // Chapter titles: all of them zoomed out; deeper in, only the selection's.
  if (level === 0) {
    for (const c of model.chapters)
      out.push({ kind: "chapter", id: c.id, priority: path.chapter?.id === c.id ? 0 : 3 });
  } else if (level === 1) {
    if (path.chapter) out.push({ kind: "chapter", id: path.chapter.id, priority: 1 });
    else for (const c of model.chapters) out.push({ kind: "chapter", id: c.id, priority: 3 });
  }

  // Lesson names: from the lessons level on.
  if (level >= 1) {
    if (path.chapter) {
      for (const slug of path.chapter.lessons)
        out.push({
          kind: "lesson",
          id: slug,
          priority: sel?.kind === "lesson" && sel.slug === slug ? 0 : 2,
        });
    } else {
      for (const slug of model.lessonBySlug.keys()) out.push({ kind: "lesson", id: slug, priority: 4 });
    }
  }

  // Book sections' names (FR-4315): beside the lesson names, never at the
  // chapters level. Absent entirely for a map with no split section.
  if (level >= 1 && model.sections.length > 0) {
    const ownSection = (slug: string | undefined) =>
      slug === undefined ? undefined : model.sectionOfLesson.get(slug)?.sectionId;
    const selectedSection = ownSection(path.lesson?.slug);
    for (const sec of model.sections) {
      if (path.chapter && sec.chapterId !== path.chapter.id) continue;
      out.push({
        kind: "section",
        id: sec.id,
        priority: sec.id === selectedSection ? 1 : path.chapter ? 2 : 4,
      });
    }
  }

  // Objective boxes: the objectives level only.
  if (level === 2) {
    if (focus) {
      const ownRank = sel?.kind === "chapter" ? 2 : 1;
      for (const id of focus.own)
        out.push({
          kind: "objective",
          id,
          priority: sel?.kind === "objective" && sel.id === id ? 0 : ownRank,
        });
      for (const id of focus.linked) out.push({ kind: "objective", id, priority: ownRank + 1 });
    } else {
      for (const id of model.objectiveById.keys()) out.push({ kind: "objective", id, priority: 5 });
    }
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, m: number) =>
  a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/**
 * Greedy placement, most important first: keep a label unless it would overlap
 * one already kept, or lies wholly outside the viewport. Priority 0 (the
 * selected item) is always kept. Ties break on key, so the result is stable.
 */
export function declutter<T extends { key: string; priority: number; rect: Rect }>(
  labels: readonly T[],
  viewport: { w: number; h: number },
  margin = 4
): Set<string> {
  const ordered = [...labels].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  const kept: Rect[] = [];
  const keys = new Set<string>();
  const view: Rect = { x: 0, y: 0, w: viewport.w, h: viewport.h };
  for (const l of ordered) {
    if (l.priority > 0) {
      if (!overlaps(l.rect, view, 0)) continue;
      if (kept.some((k) => overlaps(l.rect, k, margin))) continue;
    }
    kept.push(l.rect);
    keys.add(l.key);
  }
  return keys;
}
