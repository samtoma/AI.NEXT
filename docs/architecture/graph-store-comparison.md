# Graph Store Deep Comparison (for ADR-0003)

- **Status:** Study — decision pending Samuel
- **Date:** 2026-07-17 (web-verified; the landscape changed materially since the thesis was written)
- **Scope:** store for the curriculum graph per ADR-0001 architecture; must serve the Python ingestion/AI service (writer) and the Next.js app (reader) per ADR-0002

## 1. Our actual workload (size the decision honestly)

| Dimension | PoC / pilot reality |
|---|---|
| Graph size | ~10 modules, ~40–60 LearningObjectives, ~60–120 PREREQUISITE_OF edges, ~1,500–2,000 Question nodes at launch. **< 5k nodes total** |
| Query shapes | Prerequisite-DAG walk (depth ≤ 10); question selection by (LO, tier, status=live, syllabus_version); mastery as-of queries |
| Write pattern | Batch writes from Python ingestion + review-gate approvals; low frequency. Attempts/mastery are high-frequency but relational in nature |
| Temporal | Valid-interval attributes on edges (Ch. 15.3 pattern 2 + Ch. 16) — any store with edge properties or extra columns handles this |
| Consumers | **Two runtimes** (Python service + Next.js app) → an in-process/embedded store has a single-owner problem |
| Ops | Solo CTO; minors' data ⇒ managed backups are near-mandatory; zero budget |
| Future | Spine reuse across verticals (thesis Ch. 15.7); BKT/IRT at ~50k attempts; possible GraphRAG later |

Key honesty point: **at this scale, every candidate is fast.** The decision is about operations, ecosystem risk, the two-runtime constraint, and spine longevity — not performance.

## 2. Candidates

### A. KuzuDB (thesis-endorsed) — ⚠️ status changed since the thesis
Kùzu Inc. **abandoned the project in October 2025**; the GitHub repo was archived and the company stopped supporting it ([The Register](https://www.theregister.com/2025/10/14/kuzudb_abandoned/), [HN](https://news.ycombinator.com/item?id=45560036)). Community forks exist — [Vela-Engineering/kuzu](https://github.com/Vela-Engineering/kuzu), Kineviz's "bighorn", LadybugDB — but none has yet proven durable stewardship. Graphiti dropped it too ([getzep/graphiti#1132](https://github.com/getzep/graphiti/issues/1132)).
Also architectural: embedded/in-process conflicts with our two-runtime split (ADR-0002) — one process must own the file and proxy the other.
**Verdict: eliminated.** The thesis's endorsement predates the abandonment. Betting the curriculum asset on an orphaned engine or a young fork is unjustifiable risk for zero benefit at our scale.

### B. Neo4j AuraDB (thesis-endorsed)
- **Free tier:** $0, no card; ~200k nodes / 400k relationships (FAQ; product page says 50k/175k — either bound fits our <5k-node graph ~10× over) ([Neo4j pricing](https://neo4j.com/pricing/), [Aura Free FAQ](https://support.neo4j.com/s/article/16094506528787-Support-resources-and-FAQ-for-Aura-Free-Tier)).
- **Pros:** real Cypher; mature ecosystem; graph visualization (Bloom) — excellent for founder/investor demos of the curriculum graph and the provenance story; drivers for both Python and Node; zero ops.
- **Cons:** **free tier has no backups** and auto-pauses when idle; paid starts at $65/GB/month (Professional) — real money for a zero-budget pilot; a second datastore alongside Postgres (app data, attempts, families must live somewhere transactional anyway); external network hop from wherever we host; vendor dependency.

### C. Postgres, graph modeled relationally (nodes/edges tables + recursive CTEs)
- **Pros:** **one database for everything** — curriculum graph, questions, attempts, mastery, families, sessions — one connection story for both runtimes, one managed-backup story (critical for minors' data), zero added cost, any hosting provider. Thesis-compliant: Ch. 15.3 explicitly notes the simple isolation/versioning patterns "don't require special DB features." Recursive CTEs traverse a 60-node DAG in microseconds. Bitemporal = indexed timestamp-range columns (thesis Ch. 16.4 pattern 1 is literally SQL).
- **Cons:** no Cypher — DAG queries are more verbose and less pleasant to write; no native graph visualization (mitigable: export to GraphML/Mermaid, or point Neo4j Aura Free at a read-only projection for demos); if v2 brings GraphRAG/multi-vertical spine, a migration or projection layer will be needed then.

### D. Apache AGE (openCypher extension *inside* Postgres)
- Actively maintained (releases through mid-2026, supports PG 11–18; Azure Database for PostgreSQL offers it managed) ([apache/age](https://github.com/apache/age), [Azure docs](https://learn.microsoft.com/en-us/azure/postgresql/azure-ai/generative-ai-age-overview)).
- **Pros:** Cypher + SQL in one Postgres — conceptually the best of B and C.
- **Cons:** hosting constraint — most managed Postgres providers don't offer the AGE extension (Azure Flexible Server does; Supabase/Neon/RDS generally don't), so it dictates the hosting choice; smaller community; adds an extension dependency to the system of record. A middle path with real strings attached.

### E. Memgraph Community / FalkorDB (for completeness)
Memgraph: BSL-licensed, free self-host, in-memory, Cypher-compatible — but self-hosted ops burden on a solo team. FalkorDB: Redis-module, SSPL, cloud from ~$73/month ([comparison](https://aimultiple.com/graph-databases), [ArcadeDB overview](https://arcadedb.com/blog/neo4j-alternatives-in-2026-a-fair-look-at-the-open-source-options/)). Neither beats B or C on any dimension that matters to us. **Eliminated.**

## 3. Decision matrix (weighted for this pilot)

| Criterion (weight) | B. AuraDB | C. Postgres-modeled | D. AGE |
|---|---|---|---|
| Ops simplicity for solo CTO (×3) | ◐ second store, auto-pause | **● one store** | ◐ hosting constraint |
| Backup/data-safety, minors' data (×3) | ○ none on free tier | **● managed, standard** | ● (if Azure) |
| Cost at pilot scale (×2) | ● free (until it isn't) | **● free** | ● |
| Query ergonomics / Cypher (×2) | **●** | ○ CTEs | ● |
| Two-runtime access (×2) | ● drivers both | **● SQL everywhere** | ● |
| Ecosystem risk (×2) | **● mature** | **● boring** | ◐ niche |
| Demo/visualization power (×1) | **● Bloom** | ○ | ◐ |
| Spine longevity / v2 path (×1) | ● | ◐ projection later | ● |

## 4. Recommendation

**C — Postgres as the single system of record, graph modeled relationally**, with two riders:

1. **Schema discipline now:** model nodes/edges as first-class tables (`lo_nodes`, `lo_edges {type, valid_from, valid_to, syllabus_version}`) with the graph semantics of Ch. 15.1 — so a future migration to a dedicated graph store (or an AGE upgrade, option D, which sits *on* Postgres) is a projection, not a redesign.
2. **Optional demo projection:** when we need the investor/parent-facing "evidence walk" visual, load a read-only snapshot into **AuraDB Free** (option B) purely for visualization — zero risk, zero cost, and we get the Bloom demo without operating a second production store.

Rationale in one sentence: at <5k nodes the graph store buys us nothing operationally that Postgres doesn't already give us, and the pilot's binding constraints — one-person ops, mandatory backups for minors' data, zero budget, two runtimes — all point the same direction; the thesis itself licenses this via Ch. 15.3 + the Ch. 19.6 MVP-cut.

**Revisit trigger (write into ADR-0003):** adopt a dedicated graph engine when any of: multi-vertical spine reuse begins, GraphRAG retrieval lands, graph exceeds ~1M edges, or DAG query complexity starts consuming real engineering time.
