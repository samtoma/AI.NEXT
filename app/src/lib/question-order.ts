/**
 * The order a lesson's question bank reaches the tutor in, for ONE sitting.
 *
 * The tutor picks its questions from the bank ("a basic-tier question from
 * <objective>"), and the bank used to arrive sorted by `lo_id, tier, id` every
 * time. Same list, same order, so the model reached for the same first few
 * questions every sitting and a student who came back met the questions they
 * had already done.
 *
 * Two rules, and the objective/tier grouping the prompt relies on is kept:
 *
 *   1. Inside each (objective, tier) group, the questions THIS student has not
 *      answered come first, the ones they have answered after them. "Answered"
 *      is per student, read from their own `attempts` rows, never anybody
 *      else's.
 *   2. Inside each of those two halves the order is shuffled, seeded by the
 *      chat session. The lesson context is snapshotted per chat session
 *      (`snapshotContext`), and a seed keeps a rebuild mid-sitting (a scope or
 *      register change) on the same order, so the bank never reshuffles under
 *      a conversation that is already using it.
 *
 * Pure: no database, no clock, no `Math.random`.
 */

export interface OrderableQuestion {
  id: string;
  loId: string;
  tier: string;
}

/** FNV-1a, 32-bit: a stable number from the seed string. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator in [0, 1). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: T[], next: () => number): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * `questions` must arrive in the bank's own sort (`lo_id, tier, id`): groups
 * stay where they are and only their members move. `answered` is the set of
 * question ids this student has attempted before this sitting.
 */
export function orderQuestionsForSitting<Q extends OrderableQuestion>(
  questions: readonly Q[],
  answered: ReadonlySet<string>,
  seed: string
): Q[] {
  const next = rng(hash32(seed));
  const out: Q[] = [];
  let i = 0;
  while (i < questions.length) {
    const { loId, tier } = questions[i];
    let j = i;
    while (j < questions.length && questions[j].loId === loId && questions[j].tier === tier) j++;
    const group = questions.slice(i, j);
    out.push(
      ...shuffled(group.filter((q) => !answered.has(q.id)), next),
      ...shuffled(group.filter((q) => answered.has(q.id)), next)
    );
    i = j;
  }
  return out;
}
