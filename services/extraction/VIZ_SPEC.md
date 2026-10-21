# Visual Primitive Contract (v4)

One renderer library in the app (`app/src/components/viz/`), driven entirely by
`{kind, spec}` data. Content (seed JSON `visuals[]`) references primitives by
kind; renderers autoplay a looped animation (GIF feel) and offer light
interaction where marked. Both the extraction agents (producers) and the viz
renderer (consumer) build against THIS file. Do not invent kinds not listed.

v1 = the nine math kinds. v2 adds the three social-studies kinds (ADR-0004
Wave 0): `map_scene`, `timeline`, `flow_chain` — see the v2 section below.
v1 kinds and rules are unchanged.

v4 (2026-10-20, Samuel; `proto/interactive-figures`) is additive: `geo_scene`
draws any straight-edge-and-circle figure, not only circle theorems, and
carries the textbook's marks (equal-length ticks, parallel arrows, right-angle
squares, equal-angle arcs, dashed and shaded parts); `coordinate_plot` and
`function_graph` gain axis titles, labelled segments, shaded polygons and
quadrant labels; a tenth maths kind, `venn_diagram`, is added. Every v1/v2
spec is still valid and draws the same.

**Scope: this file covers only figures (`visuals[]`).** Two other kinds of
interactive have their own contracts:
- **Widget questions** (ADR-0009): the 11 maths widget kinds and their
  predicates live in `contracts/widget-predicates.json`, which is read by
  `widget_spec.py` and generates `app/src/lib/widget-predicates.ts`.
- **Lesson-content interactives** (`locate_on_map`, `term_match`,
  `timeline_builder`, `chain_builder`, and the Arabic `extract_spans`,
  `hamza_seat`, `style_purpose`, `irab_builder`) are stored in
  `seed/content/<lesson>.json` and read by `app/src/lib/lesson-content.ts`.

A figure that no kind below can express is recorded as a viz gap, not
forced into the nearest kind (see `docs/specs/extraction-pipeline.md`
§3.7).

Seed JSON shape:
```json
{"id": "v:u2-1:001", "lo": "lo:u2-1-1", "question": null,
 "kind": "ratio_bars", "caption": "3 : 5 as bars",
 "source_page": 25, "spec": { ... }}
```

## Kinds

1. **coordinate_plot** — points/segments appearing in sequence on a grid.
   spec: `{xRange:[-6,6], yRange:[-6,6], points:[{x,y,label?,color?}], segments:[[i,j] | {from:i,to:j,label?,dashed?:true}]?, polygons:[{points:[i,j,k,…], fill?:true}]?, axes:{x?:"Time in seconds", y?:"Distance in metres"}?, quadrants:true|["first","second","third","fourth"]?, notes:[{x,y,text}]?, scale:"numbers"|"none"?, animate:"plot-sequence"|"none", interactive:false|"click-to-plot"}`
   segments and polygons index into points. A segment's label is a length or expression written beside it (x₂ − x₁). polygons fill:true shades the region the figure shades. axes titles the axes. quadrants:true names the four quadrants (or give the four names, first quadrant first, anticlockwise); a "\n" in a name starts a new line ("first\nx > 0, y > 0"). notes places free text at a point of the plane.
   scale:"none" hides the grid and the number scale: use it for a DERIVATION drawn with symbolic points (M(x₁, y₁), N(x₂, y₂)) — put the points at any representative numbers, label them with the book's symbols, and no number can be read off.
2. **function_graph** — animated curve draw; vertex/intercept reveals.
   spec: `{fn:"linear"|"quadratic", coefs:[a,b]|[a,b,c], domain:[min,max], markers:[{x,label}]?, reveals:["vertex","axis","roots"]?, axes:{x?,y?}?, animate:"draw"}`
   axes titles the axes with the book's words ("Time in seconds", "Distance in metres").
3. **arrow_map** — two set columns, arrows animating one by one (relations/functions).
   spec: `{X:[..], Y:[..], pairs:[[xi,yi],..], highlight:"function-check"?, animate:"arrows"}`
4. **product_grid** — X×Y grid cells filling in sequence, count ticker.
   spec: `{X:[..], Y:[..], animate:"fill", showCount:true}`
5. **ratio_bars** — proportional bars/parts growing; good for ratio & variation.
   spec: `{parts:[{label,value,color?}], compare:[{label,value}]?, animate:"grow", unit?:string}`
6. **stat_chart** — bar / sector (pie) / dot-plot with grow-in animation.
   spec: `{type:"bar"|"sector"|"dots", data:[{label,value}], animate:"grow", meanLine?:number}`
7. **trig_triangle** — right triangle, one acute angle marked; sides pulse-highlight
   to show sin/cos/tan as ratios. spec: `{angleDeg:30|45|60|"θ", emphasize:"sin"|"cos"|"tan", sides:{opp?,adj?,hyp?}, animate:"ratio-highlight"}`
8. **geo_scene** — any straight-edge-and-circle figure: circle theorems, triangles, quadrilaterals, parallel lines and transversals, constructions. Elements appear in step order, the way a teacher draws on the board.
   spec: `{elements:[{type:"circle"|"point"|"segment"|"chord"|"radius"|"diameter"|"tangent"|"polygon"|"arc"|"angle"|"label", ...geometry-specific fields, step:int}] | panels:[{label, elements}], animate:"sequence"}`
   circle {cx,cy,r,label?,fill?:true}; point {x,y,label}; segment|chord|radius|diameter|tangent {from:[x,y],to:[x,y],label?,ticks?:1|2|3,parallel?:1|2|3,dashed?:true,arrow?:"end"|"both"}; polygon {points:[[x,y],…],fill?:true,dashed?:true} (a closed triangle, quadrilateral …; put labels on its vertices as points); arc {cx?,cy?,r?,startDeg,endDeg,label?,ticks?:1|2|3} (defaults to the first circle); angle {at:[x,y],fromDeg,toDeg,label?,arcs?:1|2|3,right?:true}; label {x,y,text}.
   MARKS ARE GIVENS — draw every mark the book draws, never drop one: ticks = equal-length marks (sides, chords or arcs with the same tick count are equal); parallel = arrow marks (lines with the same arrow count are parallel); angle right:true = the right-angle square; angle arcs = equal-angle arcs (angles with the same arc count are equal). An angle's label is its value or expression as printed (50°, (5x − 40)°, θ).
   dashed:true = a construction or hidden line; fill:true = lightly shades a region the figure shades (two filled circles shade their overlap darker); arrow = a ray or a line that runs on past its last point ("end": past `to`; "both": both ways). A moving figure (a circle slid along a line) is its positions as successive steps, the motion an arrow segment.
   TASKS (`tasks`, written by the compile step from the drawing — figure_tasks.py — NEVER by a producer): what a student can work on the figure, in order: `{name:"marks", mode:"marks", ask:"equal"|"parallel"|"both", prompt}`; `{name:"spot", mode:"equal_angle", angle:[X,V,Y], prompt}`; `{name:"drag", mode:"drag", point, along:"circle", angle, compare, prompt, question, options}`; `{name:"converse", mode:"drag", point, along:"free", angle, compare, prompt, question, options, key}`. A figure shown with an exercise carries `marks` only. The app grades every task from the spec itself; the tutor pushes one with `{{widget:figure_task:<visual id>#<name>}}`.
   PANELS: a figure printed as several numbered drawings side by side is ONE geo_scene with `panels:[{label:"(1)", elements:[…]}, …]` in place of `elements` — each panel its own drawing with its own coordinates, labelled as the book numbers it, drawn one after another.
9. **number_line** — points/intervals sweeping onto a line.
   spec: `{range:[min,max], points:[{x,label?}], intervals:[{from,to,open?:bool}]?, animate:"sweep"}`
13. **venn_diagram** — 1–3 sets as ovals inside a universe rectangle, drawn as RELATIONSHIPS (overlapping, apart, one inside another), not proportional areas; elements or region counts in their regions; regions shaded. Sets draw in, then the shading, then the items.
   spec: `{universe?:"S", sets:[{label:"A", inside?:"B"}], overlaps:[["A","B"]]?, items:[{text:"6", in:["A","B"]}]?, shade:[{in:["A","B"], out?:["C"]}]?, notes:[{text:"A ∩ B", in:["A","B"], out?:[]}]?, animate:"sequence"|"none"}`
   Two sets overlap only when the pair is listed in overlaps; otherwise they are drawn apart (mutually exclusive). A set with inside sits wholly inside that set (A ⊂ B). An item sits in the region inside exactly the sets in its in, and no other (in:[] = inside the universe, outside every set); write a region COUNT the same way, as an item whose text is the number. A shade or note region is inside every set in in and outside every set in out (in:[] = the whole universe): A ∩ B = {in:["A","B"]}; A − B = {in:["A"],out:["B"]}; A′ = {in:[],out:["A"]}; A ∪ B = two entries, {in:["A"]} and {in:["B"]}. notes writes a region's name where the book prints one (the book's "A − B" tag).

## Rules for producers (extraction agents)
- 2–4 visuals per learning objective; attach to the LO (question link optional).
- (v4) A right triangle is a `trig_triangle` only when it shows ONE acute angle and its sides as a sin/cos/tan ratio; any other triangle — both acute angles labelled, an altitude, an isosceles triangle, a plain right triangle — is a `geo_scene` with a polygon and a right-angle mark.
- Every visual carries `source_page` (the book page whose idea it animates) and a
  one-line caption (plain English, student-voiced).
- Coordinates/values must be small integers or half-integers where possible.
- ids: `v:<lesson>:<nnn>` — globally unique.

---

# v2 kinds — Social Studies (ADR-0004 Wave 0)

Three additional kinds for the دراسات اجتماعية vertical. All three carry REAL
step semantics: every element takes an integer `step` (1-based; ties reveal
together), and the whiteboard can drive them step-by-step exactly like
`geo_scene`. All are Ledger-styled and RTL-aware; **labels are Arabic**,
student-voiced, with Arabic-Indic digits for dates («١٧٩٨م» not "1798").

10. **map_scene** — a named base map + marks appearing in step order. THE
    signature primitive of the subject.
    spec: `{base:"egypt", marks:[{kind:"point"|"region"|"route"|"badge"|"label",
    place:"القاهرة", through:["طولون","الإسكندرية"], label?, color?, step:int}],
    animate:"sequence"|"none"}`
    - `base` ∈ `egypt | nile_valley | arab_world | africa | asia | world |
      mediterranean_east` (SVG assets + gazetteers in `app/public/maps/`).
    - Content refers to **place names, never coordinates**. `place` (point /
      region / badge marks) and every entry of `through` (route marks) must be
      an EXACT name from the base's gazetteer list below (matching is tolerant
      of hamza/taa-marbuta/diacritics, but use the canonical spelling).
    - `route` draws an animated arrow through 2+ waypoints in order — use it
      for خط سير campaigns, trade routes, river journeys.
    - `badge` is an event stamp (e.g. `label:"موقعة أبي قير ١٧٩٨"`) anchored
      at a place; `region` tints the named region; `color` is an optional
      Ledger color name (`green|gold|rust|ink`).
    - An unknown `base` is a spec error; an unknown place name silently skips
      that one mark — so producers MUST take names from the lists below.

11. **timeline** — horizontal era band, events stamping in by step.
    **RTL: the EARLIEST event sits on the RIGHT** (Arabic reading order).
    spec: `{era?:[1798,1801], events:[{label:"دخول القاهرة",
    when:"يوليو ١٧٩٨", step:int}], animate:"sequence"|"none"}`
    - `when` is a display string (year-only or month+year, Arabic-Indic
      digits, matching the book). List `events` in story order; `step`
      follows that order.

12. **flow_chain** — سبب → حدث → نتيجة boxes joined by arrows, revealing in
    step order (the book's three-column event boxes as motion). RTL flow.
    spec: `{nodes:[{id?, label:"فرض الضرائب الفادحة", role:"سبب"|"حدث"|"نتيجة",
    step:int}], links?:[[a,b],…], animate:"sequence"}`
    - `links` (node ids or indices) is optional; when it forms one linear
      path it fixes the ordering, otherwise nodes render in step order.

## v2 rules for producers
- Everything in the v1 rules still applies (ids, source_page, 2–4 per LO) —
  except captions for this subject are **Arabic**, student-voiced.
- Place names only, from the gazetteer lists below — never invent a place,
  never emit coordinates. If a lesson needs a place that is missing, flag it
  to the frontend-engineer to add to the base map asset (one-line change)
  rather than working around it.
- Dates in Arabic-Indic digits everywhere the student sees them.
- History content: labels/captions strictly book-grounded (ADR-0004 §5) — no
  editorial framing beyond the ministry text.

## Gazetteer name lists (canonical, per base map)

Producers must copy names EXACTLY from here (source of truth:
`app/public/maps/<base>.json`).

### `egypt`
- **point**: القاهرة، الجيزة، الإسكندرية، بورسعيد، السويس، الإسماعيلية، دمياط، رشيد، طنطا، المنصورة، الفيوم، بني سويف، المنيا، أسيوط، سوهاج، قنا، الأقصر، أسوان، الغردقة، مرسى مطروح، العريش، شرم الشيخ، السلوم، طابا، واحة سيوة، السد العالي، حلايب
- **region**: سيناء، الدلتا، الصحراء الغربية، الصحراء الشرقية، الصعيد، بحيرة ناصر
- **line**: نهر النيل، قناة السويس، فرع رشيد، فرع دمياط
- **sea**: البحر المتوسط، البحر الأحمر، خليج السويس، خليج العقبة

### `nile_valley`
- **point**: القاهرة، الجيزة، الإسكندرية، بورسعيد، السويس، الإسماعيلية، دمياط، رشيد، طنطا، المنصورة، الفيوم، بني سويف، المنيا، أسيوط، سوهاج، قنا، الأقصر، أسوان، السد العالي
- **region**: الدلتا، الوادي، بحيرة ناصر، منخفض الفيوم
- **line**: نهر النيل، فرع رشيد، فرع دمياط، قناة السويس
- **sea**: البحر المتوسط، البحر الأحمر، خليج السويس، خليج العقبة

### `arab_world`
- **point**: القاهرة، الرياض، بغداد، دمشق، عمّان، بيروت، القدس، الخرطوم، طرابلس، الرباط، نواكشوط، صنعاء، مسقط، أبوظبي، الدوحة، المنامة، مدينة الكويت، مقديشو، الجزائر العاصمة، تونس العاصمة
- **region**: مصر، السودان، ليبيا، تونس، الجزائر، المغرب، موريتانيا، السعودية، اليمن، عُمان، الإمارات، قطر، البحرين، الكويت، العراق، سوريا، الأردن، لبنان، فلسطين، الصومال، جيبوتي
- **line**: قناة السويس
- **sea**: البحر المتوسط، البحر الأحمر، الخليج العربي، بحر العرب، خليج عدن، المحيط الأطلنطي، مضيق باب المندب، مضيق هرمز، مضيق جبل طارق

### `africa`
- **point**: رأس الرجاء الصالح، القاهرة، قناة السويس
- **region**: جبال أطلس، هضبة الحبشة، هضبة البحيرات، الصحراء الكبرى، حوض الكونغو، جبال دراكنزبرج، مدغشقر، مصر، بحيرة فيكتوريا، بحيرة تشاد
- **line**: نهر النيل، نهر الكونغو، نهر النيجر، نهر الزمبيزي، خط الاستواء، مدار السرطان، مدار الجدي
- **sea**: البحر المتوسط، البحر الأحمر، المحيط الأطلنطي، المحيط الهندي، خليج غينيا

### `asia`
- **region**: جبال الهيمالايا، هضبة التبت، سهول سيبيريا، شبه الجزيرة العربية، شبه القارة الهندية، الهند، الصين، اليابان، إندونيسيا، الفلبين، تركيا، إيران، باكستان، بنجلاديش، ميانمار، تايلاند، فيتنام، ماليزيا، كوريا، منغوليا، كازاخستان، العراق، السعودية، سريلانكا، بحر قزوين، بحيرة بايكال
- **line**: نهر الجانج، نهر اليانجتسي، نهرا دجلة والفرات
- **sea**: المحيط الهندي، المحيط الهادي، المحيط المتجمد الشمالي، بحر العرب، خليج البنغال، بحر الصين الجنوبي، الخليج العربي، البحر المتوسط

### `world`
- **point**: مصر
- **region**: أفريقيا، آسيا، أوروبا، أمريكا الشمالية، أمريكا الجنوبية، أستراليا، القارة القطبية الجنوبية، جرينلاند
- **line**: خط الاستواء، مدار السرطان، مدار الجدي، خط جرينتش
- **sea**: المحيط الهادي، المحيط الأطلنطي، المحيط الهندي، المحيط المتجمد الشمالي، البحر المتوسط

### `mediterranean_east`
- **point**: طولون، مالطا، الإسكندرية، أبو قير، رشيد، دمياط، إمبابة، القاهرة، الصالحية، العريش، غزة، يافا، عكا، دمشق، القسطنطينية
- **region**: فرنسا، إيطاليا، اليونان، مصر، الشام، الدولة العثمانية، صقلية، كريت، قبرص
- **line**: فرع رشيد، فرع دمياط
- **sea**: البحر المتوسط، بحر إيجه، البحر الأسود، البحر الأدرياتيكي

## Schema note
`services/extraction/schemas.py` `VIZ_KINDS` must include the three v2 kinds
(`map_scene`, `timeline`, `flow_chain`) — already done as of 2026-07-20.
