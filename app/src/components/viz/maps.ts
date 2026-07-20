"use client";

/**
 * Base-map assets for `map_scene` and `locate_on_map` (VIZ_SPEC v2).
 *
 * Each base map ships as two static assets in /public/maps:
 *   <base>.svg   — Ledger ink-on-paper art (drawn once, by hand)
 *   <base>.json  — the GAZETTEER: Arabic place name -> px anchor in the
 *                  svg's viewBox, with a kind, a hit/highlight radius, and
 *                  (for regions/lines) the id of a path inside the svg.
 *
 * Producers (extraction agents, the lesson AI) refer to PLACES BY NAME,
 * never raw coordinates; this module owns name resolution. Assets are
 * fetched once per base and cached for the session.
 */

import { useEffect, useState } from "react";
import { normalizeArabic } from "./arabic";

export const BASE_MAPS = [
  "egypt",
  "nile_valley",
  "arab_world",
  "africa",
  "asia",
  "world",
  "mediterranean_east",
] as const;

export type BaseMapId = (typeof BASE_MAPS)[number];

export interface GazPlace {
  kind: "point" | "region" | "line" | "sea";
  /** anchor in viewBox px (marker position / label anchor / hit center) */
  at: [number, number];
  /** hit + highlight radius in viewBox px */
  r: number;
  /** id of a path in the base svg (region outline, river, canal…) */
  ref?: string;
  aliases?: string[];
}

export interface BaseMap {
  id: string;
  viewBox: [number, number, number, number];
  /** inner markup of the asset's root <svg> (the base art) */
  inner: string;
  /** style attribute of the asset's root svg (font stack for baked labels) */
  rootStyle: string;
  /** element id -> path `d` (regions/lines referenced by the gazetteer) */
  paths: Record<string, string>;
  places: Record<string, GazPlace>;
  /** normalized name/alias -> canonical gazetteer key */
  lookup: Map<string, string>;
}

const cache = new Map<string, Promise<BaseMap | null>>();

async function fetchBaseMap(id: string): Promise<BaseMap | null> {
  try {
    const [svgText, gaz] = await Promise.all([
      fetch(`/maps/${id}.svg`).then((r) => {
        if (!r.ok) throw new Error(`svg ${r.status}`);
        return r.text();
      }),
      fetch(`/maps/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`gazetteer ${r.status}`);
        return r.json();
      }),
    ]);
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    if (root.querySelector("parsererror") || root.tagName !== "svg") return null;

    const paths: Record<string, string> = {};
    root.querySelectorAll("[id]").forEach((el) => {
      const d = el.getAttribute("d");
      if (d) {
        paths[el.id] = d;
      } else if (el.tagName === "line") {
        paths[el.id] =
          `M${el.getAttribute("x1")},${el.getAttribute("y1")} ` +
          `L${el.getAttribute("x2")},${el.getAttribute("y2")}`;
      }
    });

    const vbRaw: unknown = gaz?.viewBox;
    const vb: [number, number, number, number] =
      Array.isArray(vbRaw) && vbRaw.length === 4 && vbRaw.every((n) => typeof n === "number")
        ? (vbRaw as [number, number, number, number])
        : ((root.getAttribute("viewBox") ?? "0 0 400 300")
            .split(/\s+/)
            .map(Number) as [number, number, number, number]);

    const places: Record<string, GazPlace> = {};
    const lookup = new Map<string, string>();
    for (const [name, raw] of Object.entries(gaz?.places ?? {})) {
      const p = raw as Partial<GazPlace>;
      if (!Array.isArray(p.at) || p.at.length < 2) continue;
      const place: GazPlace = {
        kind: p.kind === "region" || p.kind === "line" || p.kind === "sea" ? p.kind : "point",
        at: [Number(p.at[0]), Number(p.at[1])],
        r: typeof p.r === "number" && p.r > 0 ? p.r : 12,
        ...(typeof p.ref === "string" ? { ref: p.ref } : {}),
        ...(Array.isArray(p.aliases) ? { aliases: p.aliases.map(String) } : {}),
      };
      places[name] = place;
      lookup.set(normalizeArabic(name), name);
      for (const a of place.aliases ?? []) lookup.set(normalizeArabic(a), name);
    }

    return { id, viewBox: vb, inner: root.innerHTML, rootStyle: root.getAttribute("style") ?? "", paths, places, lookup };
  } catch {
    return null;
  }
}

export function loadBaseMap(id: string): Promise<BaseMap | null> {
  if (!cache.has(id)) cache.set(id, fetchBaseMap(id));
  return cache.get(id)!;
}

/** Resolve a producer-supplied place name against the gazetteer. */
export function resolvePlace(
  map: BaseMap,
  name: unknown
): { name: string; place: GazPlace } | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const canonical = map.lookup.get(normalizeArabic(name));
  if (!canonical) return null;
  return { name: canonical, place: map.places[canonical] };
}

/** Fetch-and-cache hook. `status` is "error" for unknown bases / bad assets. */
export function useBaseMap(id: string): {
  map: BaseMap | null;
  status: "loading" | "ready" | "error";
} {
  const [map, setMap] = useState<BaseMap | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setMap(null);
    loadBaseMap(id).then((m) => {
      if (!alive) return;
      setMap(m);
      setStatus(m ? "ready" : "error");
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return { map, status };
}
