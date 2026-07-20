"""Typed extraction schemas (thesis Pillar I: schema-first, not text-first).

Every fact carries provenance back to a content-addressed source document.
Validation happens here, before anything touches the database.
"""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

NodeKind = Literal["program", "course", "module", "learning_objective", "topic"]
EdgeType = Literal["part_of", "teaches", "prerequisite_of", "about"]
Tier = Literal["basic", "standard", "advanced"]
QuestionType = Literal["mcq", "numeric", "short"]


class SourceDocument(BaseModel):
    title: str
    publisher: str
    edition: Optional[str] = None
    language: Literal["en", "ar"]
    grade: str
    subject: str
    file_path: Optional[str] = None


class ExtractionRun(BaseModel):
    extractor: str
    extractor_version: str
    schema_version: str


class Node(BaseModel):
    id: str
    kind: NodeKind
    label: str
    description: Optional[str] = None
    syllabus_ref: Optional[str] = None
    source_page: Optional[int] = None
    order_in_parent: Optional[int] = None


class Edge(BaseModel):
    src: str
    dst: str
    type: EdgeType


class Choice(BaseModel):
    key: str
    text: str


class Question(BaseModel):
    id: str
    lo: str
    tier: Tier
    type: QuestionType
    stem: str
    choices: Optional[list[Choice]] = None
    answer: str
    solution: list[str] = Field(min_length=1, description="Canonical step-by-step solution")
    source_page: int
    source_note: str
    verified: bool = False  # True only after an INDEPENDENT re-solve confirmed the answer

    @model_validator(mode="after")
    def mcq_has_valid_answer(self) -> "Question":
        if self.type == "mcq":
            if not self.choices or len(self.choices) < 2:
                raise ValueError(f"{self.id}: mcq needs >= 2 choices")
            if self.answer not in {c.key for c in self.choices}:
                raise ValueError(f"{self.id}: answer '{self.answer}' not among choice keys")
        return self


VIZ_KINDS = {"coordinate_plot", "function_graph", "arrow_map", "product_grid",
             "ratio_bars", "stat_chart", "trig_triangle", "geo_scene", "number_line",
             # VIZ_SPEC v2 (ADR-0004, Social Studies vertical)
             "map_scene", "timeline", "flow_chain"}


class Visual(BaseModel):
    id: str
    lo: str
    question: Optional[str] = None
    kind: str
    spec: dict
    caption: Optional[str] = None
    source_page: Optional[int] = None

    @model_validator(mode="after")
    def known_kind(self) -> "Visual":
        if self.kind not in VIZ_KINDS:
            raise ValueError(f"{self.id}: unknown viz kind '{self.kind}' (see VIZ_SPEC.md)")
        return self


class SeedBundle(BaseModel):
    # Source-document resolution (per bundle, in batch order):
    #   1. source_document set  -> this bundle defines (and uses) that document
    #   2. source_file set      -> reuse the document with this file_path, defined by an
    #                              earlier bundle in the batch or already present in the DB
    #   3. neither              -> inherit the previous bundle's resolved document
    # (unit1.json-style batches keep working unchanged: first bundle defines, rest inherit)
    source_document: Optional[SourceDocument] = None
    source_file: Optional[str] = None  # file_path of a source document defined elsewhere
    extraction_run: ExtractionRun
    syllabus_version: str
    nodes: list[Node]
    edges: list[Edge]
    questions: list[Question]
    visuals: list[Visual] = []
    external_node_refs: list[str] = []  # node ids defined by an earlier bundle (e.g. course:...)

    @model_validator(mode="after")
    def referential_integrity(self) -> "SeedBundle":
        if self.source_document and self.source_file:
            raise ValueError("set source_document OR source_file, not both")
        ids = {n.id for n in self.nodes} | set(self.external_node_refs)
        for e in self.edges:
            if e.src not in ids or e.dst not in ids:
                raise ValueError(f"edge {e.src} -> {e.dst}: unknown node id")
        lo_ids = {n.id for n in self.nodes if n.kind == "learning_objective"}
        for q in self.questions:
            if q.lo not in lo_ids:
                raise ValueError(f"question {q.id}: unknown LO {q.lo}")
        qids = {q.id for q in self.questions}
        for v in self.visuals:
            if v.lo not in lo_ids:
                raise ValueError(f"visual {v.id}: unknown LO {v.lo}")
            if v.question and v.question not in qids:
                raise ValueError(f"visual {v.id}: unknown question {v.question}")
        # prerequisite graph must be a DAG (Ch. 15.4)
        prereq = [(e.src, e.dst) for e in self.edges if e.type == "prerequisite_of"]
        adj: dict[str, list[str]] = {}
        for s, d in prereq:
            adj.setdefault(s, []).append(d)
        seen: dict[str, int] = {}  # 0=visiting, 1=done

        def dfs(u: str) -> None:
            seen[u] = 0
            for v in adj.get(u, []):
                if seen.get(v) == 0:
                    raise ValueError(f"prerequisite cycle involving {u} -> {v}")
                if v not in seen:
                    dfs(v)
            seen[u] = 1

        for s, _ in prereq:
            if s not in seen:
                dfs(s)
        return self
