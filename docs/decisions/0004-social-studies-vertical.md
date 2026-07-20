# ADR-0004: Social Studies vertical — Wave-0 decisions

- **Status:** Accepted
- **Date:** 2026-07-20
- **Decided by:** Samuel (CTO/Architect)

## Context
Proposal `docs/specs/proposal-social-studies.md` (backed by three specialist reports) laid out the methodology for ingesting the ministry Prep-3 Social Studies book (Arabic, 186pp) as the second vertical on the spine, with five decision points.

## Decisions (Samuel: "I agree with all of what you have recommended; for the voice, let me think about it later")
1. **Question policy:** inference-verb emphasis (بم تفسر / النتائج المترتبة / قارن) per the book's own directive that figures/years are not exam targets; recall questions reserved for المصطلحات.
2. **Voice vendor: DEFERRED.** No Arabic TTS vendor chosen yet (Azure ar-EG remains the standing recommendation). Social Studies ships text-first; the provider abstraction accepts the vendor whenever decided.
3. **Maps:** build the `map_scene` primitive properly — Ledger-styled SVG base maps + gazetteer (place names, never coordinates). No page-image stopgap.
4. **Scope:** Term 1 first (4 units, ~15 lessons); Term 2 follows the same playbook after the skeleton proves out.
5. **Sensitive content:** hard rule — history explanations strictly book-grounded; no model commentary on political material; enforced in prompts and checked at the review gate.

## Consequences
- Wave 0 (contracts) starts now: VIZ_SPEC v2 (map_scene, timeline, flow_chain), base-map assets, subject-keyed language contracts (Arabic-first for social studies), the social extraction contract (grounded cross-check verification, watermark blacklist, authoring policy), and loader multi-course support (social must load WITHOUT wiping the math spine — current loader truncates globally).
- RTL lesson-surface flip lands with Wave 1 (skeleton lessons), not Wave 0.
- Voice: when Samuel decides, it's an env/config change + one provider file (see ADR-0002/0003 pattern); an ADR addendum will record it.
