# Visual Primitive Contract (v1)

One renderer library in the app (`app/src/components/viz/`), driven entirely by
`{kind, spec}` data. Content (seed JSON `visuals[]`) references primitives by
kind; renderers autoplay a looped animation (GIF feel) and offer light
interaction where marked. Both the extraction agents (producers) and the viz
renderer (consumer) build against THIS file. Do not invent kinds not listed.

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
