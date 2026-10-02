/**
 * What the student has selected on the Your Progress Map, as the chat sends it
 * (FR-3224). Shared by the browser (`NoorPanel` → `ChatCore`) and `/api/ask`.
 *
 * Only `kind` and `id` ever cross the wire. The label the browser shows is
 * NOT trusted: the server resolves every id against the curriculum the
 * student can see (`lib/ask.ts` `mapFocusNote`) and drops anything it cannot
 * find, so nothing typed into a request can reach the prompt as text.
 */
export type MapFocusKind = "chapter" | "lesson" | "objective";

export interface MapFocus {
  kind: MapFocusKind;
  id: string;
  /** for the browser's own use (suggestions); never sent */
  label: string;
}

const ID_PATTERN: Record<MapFocusKind, RegExp> = {
  chapter: /^module:[a-z0-9-]{1,40}$/,
  lesson: /^[a-z0-9-]{1,40}$/,
  objective: /^lo:[a-z0-9-]{1,60}$/,
};

/** Validate the request's `mapFocus`; anything malformed is null. */
export function parseMapFocus(raw: unknown): { kind: MapFocusKind; id: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, id } = raw as { kind?: unknown; id?: unknown };
  if (kind !== "chapter" && kind !== "lesson" && kind !== "objective") return null;
  if (typeof id !== "string" || !ID_PATTERN[kind].test(id)) return null;
  return { kind, id };
}
