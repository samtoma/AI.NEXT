# Geometry Part — Structure Map

Source: `docs/Source/Math_En_Prp3_Tr1_2.pdf` (178 PDF pages).
Mapped: 2026-07-18, geometry extraction agent (poc-2).

## How the PDF is organized (important discovery)

The PDF contains **two complete Student's Books**, not "algebra + geometry":

| Book | PDF pages | Printed pages | Content |
|---|---|---|---|
| **First Term book** | 1–73 | own numbering | Algebra Units 1–2, Statistics Unit 3, (trig etc.) — extraction underway by the algebra agent |
| **Second Term book** | 74–178 | 1–103 (restarts) | Algebra Units 1–2, Probability Unit 3, **Geometry Units 4–5** |

- PDF 74 = "Second Term" title page. PDF 75 = second-term Algebra/Probability contents. PDF 76 = **Geometry contents** (Units 4–5).
- Page footers in the second book read "Student's Book – Second term", so **both geometry units are Second Term material**. The first book (PDF 1–73) is First Term.
- ⚠️ Flag for the algebra agent: the second-term book also contains **Algebra Unit 1 (Equations), Unit 2 (Algebraic Fractional Functions), and Probability Unit 3** at PDF 77–110 (printed 4–37). These are *different* units from the first-term Units 1–3 already extracted (`unit1.json`, `unit3.json`) and are not covered by any bundle yet.

## Book-page ↔ PDF-page offset (second-term book)

**PDF page = printed page + 73** for the entire second-term book.
Verified at: printed 5 → PDF 78, printed 39 → PDF 112, printed 42 → PDF 115, printed 64 → PDF 137, printed 100 → PDF 173.

## Geometry units and lessons

### Unit 4: The Circle — printed 38–62, PDF 111–135
Unit opener (unnumbered, printed 38) at PDF 111.

| Lesson | Title | Printed | PDF |
|---|---|---|---|
| 4-1 | Basic Definitions and Concepts | 39–45 | 112–118 |
| 4-2 | Positions of a Point, a Straight Line and a Circle with Respect to a Circle | 46–53 | 119–126 |
| 4-3 | Identifying the Circle | 54–57 | 127–130 |
| 4-4 | The Relation Between the Chords of a Circle and its Center | 58–62 | 131–135 |

### Unit 5: Angles and Arcs in the Circle — printed 63–103, PDF 136–176
Unit opener (unnumbered, printed 63) at PDF 136. PDF 177–178 = Arabic colophon / back matter.

| Lesson | Title | Printed | PDF |
|---|---|---|---|
| 5-1 | Central Angle and Measuring Arcs | 64–70 | 137–143 |
| 5-2 | The Relation Between the Inscribed and Central Angles Subtended by the Same Arc | 71–78 | 144–151 |
| 5-3 | Inscribed Angles Subtended by the Same Arc | 79–84 | 152–157 |
| 5-4 | Cyclic Quadrilaterals | 85–87 | 158–160 |
| 5-5 | Properties of Cyclic Quadrilaterals | 88–92 | 161–165 |
| 5-6 | The Relation Between the Tangents of a Circle | 93–99 | 166–172 |
| 5-7 | Angle of Tangency | 100–103 | 173–176 |

Lesson-start pages come from the book contents (PDF 76) and were cross-checked against the lesson tab markers ("4-1" … "5-7") and printed footer numbers in the page text layer. End pages are the page before the next lesson's start; each lesson closes with a "For More Exercises, go to MOE website" footer.

## Extracted in this pass

- **`geo-unit1.json`** = Unit 4 complete (module `module:geo-u1`, 9 LOs, 43 questions, 22 visuals). All four lessons read in full (PDF 111–136).

## Recommended extraction order for the remainder

1. **Unit 5, lessons 5-1 → 5-3** (arcs, central/inscribed angles) as one bundle — these theorems are the prerequisite spine for everything after; heaviest theorem density.
2. **Unit 5, lessons 5-4 → 5-5** (cyclic quadrilaterals) — depends on 5-2/5-3.
3. **Unit 5, lessons 5-6 → 5-7** (tangent properties, angle of tangency) — depends on 4-2 (tangent basics) and 5-2.
4. Splitting Unit 5 into 2–3 bundles is advised: it is 40 printed pages with ~7 theorems + converses, too large for a single high-quality verified pass.
5. Separately schedule the **second-term Algebra/Probability units** (PDF 77–110) with the algebra agent — currently unowned.

Prerequisite note for the graph: `module:geo-u1` (Unit 4) precedes all Unit 5 lessons; within Unit 4 the chord-corollaries objective (`lo:geo1-1-3`) is the load-bearing prerequisite for 4-4 and for Unit 5's chord/arc theorems.
