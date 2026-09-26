/**
 * TEST FIXTURE — the real Prep-3 maths skill map, read from the seed files the
 * content loader itself reads (`services/extraction/seed/`), for
 * `spine-layout.test.mts` and `spine-order-db.test.mts` — and, at the bottom,
 * the catalogue across all three subjects for the FR-3217 tests. Nothing in
 * the app imports it.
 *
 * Not a copy: the ten files below ARE the maths curriculum that reaches the
 * database (90 objectives, 112 prerequisite edges, ten modules — the set
 * `parity_check.py` guards), so a test built on them fails if the curriculum
 * changes shape under the layout, rather than passing on a stale snapshot.
 *
 * `catalogueCompare` is `MODULE_ORDER` (lib/module-order.ts) written in
 * TypeScript, because the layout tests run with no database. It is a
 * re-statement, and a re-statement can drift — which is why the scratch-
 * database test runs the real SQL over the same rows and asserts the two
 * orders are identical.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { computeLayers } from "./spine-layout.ts";
import { COURSE_IDS } from "./courses.ts";

/** Load order is irrelevant; listed in catalogue order for the reader. */
export const MATHS_SEED_FILES = [
  "unit1",
  "unit2",
  "unit3",
  "unit4",
  "unit5",
  "t2-unit12",
  "t2-unit3",
  "geo-unit1",
  "geo-unit2a",
  "geo-unit2b",
] as const;

export interface SeedNode {
  id: string;
  kind: string;
  label: string;
  description?: string | null;
  syllabus_ref?: string | null;
  order_in_parent?: number | null;
  source_page?: number | null;
}

export interface SeedEdge {
  src: string;
  dst: string;
  type: string;
}

export interface MathsLo {
  id: string;
  label: string;
  moduleId: string | null;
  moduleOrder: number | null;
  orderInParent: number;
  layer: number;
  /** in catalogue order, as `spineDataOn` hands them over */
  prereqIds: string[];
  /** index in `catalogueCompare` order — what the SQL's row index would be */
  catalogRank: number;
}

export function readMathsSeeds(): { nodes: SeedNode[]; edges: SeedEdge[] } {
  const nodes: SeedNode[] = [];
  const edges: SeedEdge[] = [];
  for (const f of MATHS_SEED_FILES) {
    const doc = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(`../../../services/extraction/seed/${f}.json`, import.meta.url)
        ),
        "utf8"
      )
    ) as { nodes: SeedNode[]; edges: SeedEdge[] };
    nodes.push(...doc.nodes);
    edges.push(...doc.edges);
  }
  return { nodes, edges };
}

/** `MODULE_ORDER`'s term rank: Term-1 algebra, then Term 2, then geometry.
 *  SQL's `NULL LIKE …` is not true, so a missing module falls to the ELSE. */
export function termRank(moduleId: string | null): number {
  if (moduleId?.startsWith("module:geo")) return 2;
  if (moduleId?.startsWith("module:t2-")) return 1;
  return 0;
}

type CatalogueKey = {
  id: string;
  moduleId: string | null;
  moduleOrder: number | null;
  orderInParent: number;
};

/** `MODULE_ORDER`, in TypeScript: term, module position (NULLS LAST),
 *  objective position, id. */
export function catalogueCompare(a: CatalogueKey, b: CatalogueKey): number {
  const mo = (x: CatalogueKey) => x.moduleOrder ?? Number.POSITIVE_INFINITY;
  const byModule = mo(a) - mo(b);
  return (
    termRank(a.moduleId) - termRank(b.moduleId) ||
    (Number.isNaN(byModule) ? 0 : byModule) ||
    a.orderInParent - b.orderInParent ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The maths map as `spineDataOn` would build it: layered, ranked, and with
 *  each objective's prerequisites in catalogue order. */
export function loadMathsGraph(): {
  los: MathsLo[];
  edges: { src: string; dst: string }[];
  moduleLabel: Map<string, string>;
} {
  const { nodes, edges: seedEdges } = readMathsSeeds();
  const moduleOrder = new Map<string, number | null>();
  const moduleLabel = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind !== "module") continue;
    moduleOrder.set(n.id, n.order_in_parent ?? null);
    moduleLabel.set(n.id, n.label);
  }
  const moduleOf = new Map<string, string>();
  for (const e of seedEdges) if (e.type === "teaches") moduleOf.set(e.dst, e.src);

  const edges = seedEdges
    .filter((e) => e.type === "prerequisite_of")
    .map((e) => ({ src: e.src, dst: e.dst }));

  const keyed = nodes
    .filter((n) => n.kind === "learning_objective")
    .map((n) => {
      const moduleId = moduleOf.get(n.id) ?? null;
      return {
        id: n.id,
        label: n.label,
        moduleId,
        moduleOrder: moduleId ? (moduleOrder.get(moduleId) ?? null) : null,
        orderInParent: Number(n.order_in_parent ?? 0),
      };
    })
    .sort(catalogueCompare);

  const rank = new Map(keyed.map((k, i) => [k.id, i]));
  const layers = computeLayers(
    keyed.map((k) => k.id),
    edges
  );
  const prereqs = new Map<string, string[]>();
  for (const e of edges) prereqs.set(e.dst, [...(prereqs.get(e.dst) ?? []), e.src]);

  const los: MathsLo[] = keyed.map((k, i) => ({
    ...k,
    layer: layers.get(k.id) ?? 0,
    prereqIds: (prereqs.get(k.id) ?? []).sort(
      (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)
    ),
    catalogRank: i,
  }));
  return { los, edges, moduleLabel };
}

/* ------------------------------------------------------------------ */
/* The catalogue across subjects (FR-3217)                             */
/* ------------------------------------------------------------------ */

export interface CatalogueLo {
  id: string;
  label: string;
  description: string | null;
  syllabus_ref: string | null;
  source_page: number | null;
  moduleId: string | null;
  courseId: string | null;
}

/**
 * The curriculum as `catalogueObjectivesSql` returns it — for the tests that
 * drive the REAL practice plan and ask context over a fake client. `"maths"`
 * is the ten maths bundles; `"all"` adds Social Studies and Arabic (the
 * bundles the loader loads for them; `social-t1` supersedes the skeleton).
 *
 * Ordered by the registry position of the course (`COURSE_RANK`, from
 * `COURSE_IDS` in lib/courses.ts), then `catalogueCompare` (`MODULE_ORDER`):
 * the statement `catalogue-order-db.test.mts` holds the SQL to on a real
 * database. Modules come back in the same split order (`COURSE_RANK`, then
 * `MODULE_RANK`), and prerequisite edges carry ids in seed order.
 */
export function loadCatalogueFixture(which: "maths" | "all"): {
  los: CatalogueLo[];
  modules: { id: string; label: string; courseId: string | null }[];
  edges: { id: number; src: string; dst: string }[];
} {
  const files = which === "maths" ? [...MATHS_SEED_FILES] : [...MATHS_SEED_FILES, "social-t1", "arabic-t1", "arabic-t2"];
  const nodes = new Map<string, SeedNode>();
  const seedEdges: SeedEdge[] = [];
  for (const f of files) {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../services/extraction/seed/${f}.json`, import.meta.url)), "utf8")
    ) as { nodes: SeedNode[]; edges: SeedEdge[] };
    for (const n of doc.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    seedEdges.push(...doc.edges);
  }
  const moduleOf = new Map(seedEdges.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src]));
  const courseOf = new Map(seedEdges.filter((e) => e.type === "part_of").map((e) => [e.src, e.dst]));
  const courses: readonly string[] = COURSE_IDS;
  const subjectRank = (c: string | null | undefined) =>
    c && courses.includes(c) ? courses.indexOf(c) : courses.length;
  const position = (id: string | null) => (id ? (nodes.get(id)?.order_in_parent ?? null) : null);

  const los = [...nodes.values()]
    .filter((n) => n.kind === "learning_objective")
    .map((n) => {
      const moduleId = moduleOf.get(n.id) ?? null;
      return {
        id: n.id,
        label: n.label,
        description: n.description ?? null,
        syllabus_ref: n.syllabus_ref ?? null,
        source_page: n.source_page ?? null,
        moduleId,
        courseId: moduleId ? (courseOf.get(moduleId) ?? null) : null,
        moduleOrder: position(moduleId),
        orderInParent: Number(n.order_in_parent ?? 0),
      };
    })
    .sort((a, b) => subjectRank(a.courseId) - subjectRank(b.courseId) || catalogueCompare(a, b))
    .map(({ moduleOrder: _m, orderInParent: _o, ...rest }) => rest);

  const modules = [...nodes.values()]
    .filter((n) => n.kind === "module")
    .map((n) => ({ id: n.id, label: n.label, courseId: courseOf.get(n.id) ?? null }))
    .sort((a, b) => {
      const pa = position(a.id) ?? Number.POSITIVE_INFINITY;
      const pb = position(b.id) ?? Number.POSITIVE_INFINITY;
      return (
        subjectRank(a.courseId) - subjectRank(b.courseId) ||
        termRank(a.id) - termRank(b.id) ||
        pa - pb ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    });

  const edges = seedEdges
    .filter((e) => e.type === "prerequisite_of")
    .map((e, i) => ({ id: i + 1, src: e.src, dst: e.dst }));
  return { los, modules, edges };
}
