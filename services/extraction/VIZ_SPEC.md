# Visual Primitive Contract (v2)

One renderer library in the app (`app/src/components/viz/`), driven entirely by
`{kind, spec}` data. Content (seed JSON `visuals[]`) references primitives by
kind; renderers autoplay a looped animation (GIF feel) and offer light
interaction where marked. Both the extraction agents (producers) and the viz
renderer (consumer) build against THIS file. Do not invent kinds not listed.

v1 = the nine math kinds. v2 adds the three social-studies kinds (ADR-0004
Wave 0): `map_scene`, `timeline`, `flow_chain` — see the v2 section below.
v1 kinds and rules are unchanged.

Seed JSON shape:
```json
{"id": "v:u2-1:001", "lo": "lo:u2-1-1", "question": null,
 "kind": "ratio_bars", "caption": "3 : 5 as bars",
 "source_page": 25, "spec": { ... }}
```

## Kinds

1. **coordinate_plot** — points/segments appearing in sequence on a grid.
   spec: `{xRange:[-6,6], yRange:[-6,6], points:[{x,y,label?,color?}], segments:[[i,j]]?, animate:"plot-sequence"|"none", interactive:false|"click-to-plot"}`
2. **function_graph** — animated curve draw; vertex/intercept reveals.
   spec: `{fn:"linear"|"quadratic", coefs:[a,b]|[a,b,c], domain:[min,max], markers:[{x,label}]?, reveals:["vertex","axis","roots"]?, animate:"draw"}`
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
8. **geo_scene** — generic circle-geometry scene, elements appearing in order.
   spec: `{elements:[{type:"circle"|"point"|"segment"|"chord"|"radius"|"diameter"|"tangent"|"arc"|"angle"|"label", ...geometry-specific fields, step:int}], animate:"sequence"}`
   (circle: {cx,cy,r}; point: {x,y,label}; segment: {from:[x,y],to:[x,y],label?};
    arc: {startDeg,endDeg,label?}; angle: {at:[x,y],fromDeg,toDeg,label?})
9. **number_line** — points/intervals sweeping onto a line.
   spec: `{range:[min,max], points:[{x,label?}], intervals:[{from,to,open?:bool}]?, animate:"sweep"}`

## Rules for producers (extraction agents)
- 2–4 visuals per learning objective; attach to the LO (question link optional).
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
