/** Display metadata per primitive kind (chips in gallery / panel / lesson). */

export interface KindMeta {
  glyph: string;
  /** tailwind classes for the kind chip */
  chip: string;
}

const META: Record<string, KindMeta> = {
  coordinate_plot: { glyph: "⊹", chip: "border-accent/35 bg-accent-wash text-accent-deep" },
  function_graph: { glyph: "∿", chip: "border-accent/35 bg-accent-wash text-accent-deep" },
  arrow_map: { glyph: "⇉", chip: "border-gold/40 bg-gold-wash text-gold" },
  product_grid: { glyph: "⊞", chip: "border-gold/40 bg-gold-wash text-gold" },
  ratio_bars: { glyph: "▤", chip: "border-line text-ink-soft bg-card" },
  stat_chart: { glyph: "◔", chip: "border-line text-ink-soft bg-card" },
  trig_triangle: { glyph: "◺", chip: "border-rust/35 bg-rust-wash text-rust" },
  geo_scene: { glyph: "◎", chip: "border-rust/35 bg-rust-wash text-rust" },
  number_line: { glyph: "⊷", chip: "border-accent/35 bg-accent-wash text-accent-deep" },
  // VIZ_SPEC v2 — social studies
  map_scene: { glyph: "⌖", chip: "border-accent/35 bg-accent-wash text-accent-deep" },
  timeline: { glyph: "⧖", chip: "border-gold/40 bg-gold-wash text-gold" },
  flow_chain: { glyph: "⇶", chip: "border-rust/35 bg-rust-wash text-rust" },
  // VIZ_SPEC v3 — Arabic language (ADR-0006). The third territory reads
  // aubergine, the way math reads viridian and social reads sepia.
  text_passage: { glyph: "¶", chip: "border-arabic-line bg-arabic-wash text-arabic" },
  gloss_table: { glyph: "☰", chip: "border-arabic-line bg-arabic-wash text-arabic" },
  rule_tree: { glyph: "⋔", chip: "border-accent/35 bg-accent-wash text-accent-deep" },
  verse_layout: { glyph: "❈", chip: "border-gold/40 bg-gold-wash text-gold" },
  harakat_reveal: { glyph: "⁘", chip: "border-arabic-line bg-arabic-wash text-arabic" },
  case_table: { glyph: "▦", chip: "border-rust/35 bg-rust-wash text-rust" },
  irab_tree: { glyph: "⑂", chip: "border-accent/35 bg-accent-wash text-accent-deep" },
};

export function kindMeta(kind: string): KindMeta {
  return META[kind] ?? { glyph: "▧", chip: "border-line text-ink-soft bg-card" };
}
