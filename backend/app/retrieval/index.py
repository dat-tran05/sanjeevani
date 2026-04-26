"""In-process BM25 + dense matrix index over the enriched facility subset.

Loaded once at FastAPI startup. ~150-200 facilities, ~1024-dim dense vectors,
trivial memory footprint (<100 MB).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
from rank_bm25 import BM25Okapi

from app.data.databricks_sql import query


_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9'-]+")


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]


@dataclass
class FacilityRecord:
    facility_id: str
    name: str
    state: str | None
    city: str | None
    description: str | None
    explicit_capabilities: list[str]
    embedding: np.ndarray  # (1024,) float32
    bm25_text: str         # the concatenated text we BM25 over


class FacilityIndex:
    def __init__(self, records: list[FacilityRecord]):
        self.records = records
        self._id_to_pos = {r.facility_id: i for i, r in enumerate(records)}
        # Dense matrix
        if records:
            self.dense = np.stack([r.embedding for r in records]).astype(np.float32)
            norms = np.linalg.norm(self.dense, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self.dense_normalized = self.dense / norms
        else:
            self.dense = np.zeros((0, 1024), dtype=np.float32)
            self.dense_normalized = self.dense
        # BM25 over tokenized concatenated text
        self.bm25 = BM25Okapi([_tokenize(r.bm25_text) for r in records]) if records else None

    def __len__(self) -> int:
        return len(self.records)

    def position_of(self, facility_id: str) -> int | None:
        return self._id_to_pos.get(facility_id)

    def bm25_topk(self, query_text: str, candidate_ids: list[str] | None, k: int = 32) -> list[tuple[str, float]]:
        if self.bm25 is None:
            return []
        tokens = _tokenize(query_text)
        scores = self.bm25.get_scores(tokens)
        if candidate_ids is not None:
            mask = np.zeros(len(self.records), dtype=bool)
            for cid in candidate_ids:
                pos = self._id_to_pos.get(cid)
                if pos is not None:
                    mask[pos] = True
            scores = np.where(mask, scores, -np.inf)
        idxs = np.argsort(-scores)[:k]
        return [(self.records[i].facility_id, float(scores[i]))
                for i in idxs if scores[i] > -np.inf]

    def dense_topk(self, query_vec: list[float], candidate_ids: list[str] | None, k: int = 32) -> list[tuple[str, float]]:
        if len(self.records) == 0:
            return []
        q = np.asarray(query_vec, dtype=np.float32)
        qn = q / (np.linalg.norm(q) or 1.0)
        sims = self.dense_normalized @ qn  # (N,)
        if candidate_ids is not None:
            mask = np.zeros(len(self.records), dtype=bool)
            for cid in candidate_ids:
                pos = self._id_to_pos.get(cid)
                if pos is not None:
                    mask[pos] = True
            sims = np.where(mask, sims, -np.inf)
        idxs = np.argsort(-sims)[:k]
        return [(self.records[i].facility_id, float(sims[i]))
                for i in idxs if sims[i] > -np.inf]


_INDEX: FacilityIndex | None = None


def load_index() -> FacilityIndex:
    """Read enriched facilities from Delta and build the in-process index."""
    global _INDEX
    rows = query("""
        SELECT p.facility_id, p.name, p.state, p.city, p.description,
               COALESCE(e.explicit_capabilities, ARRAY()) AS explicit_capabilities,
               COALESCE(p.procedure_list, ARRAY()) AS procedure_list,
               COALESCE(p.specialties, ARRAY()) AS specialties,
               g.embedding AS embedding
        FROM sanjeevani.silver.facilities_parsed p
        JOIN sanjeevani.gold.facility_embeddings g USING (facility_id)
        LEFT JOIN sanjeevani.silver.facilities_extracted e USING (facility_id)
        WHERE g.embedding IS NOT NULL
    """)
    records: list[FacilityRecord] = []
    for r in rows:
        emb = r.get("embedding")
        if emb is None or len(emb) == 0:
            continue
        raw_caps = r.get("explicit_capabilities")
        caps = list(raw_caps) if raw_caps is not None else []
        raw_procs = r.get("procedure_list")
        procs = list(raw_procs) if raw_procs is not None else []
        raw_specs = r.get("specialties")
        specs = list(raw_specs) if raw_specs is not None else []
        bm25_text = " ".join([
            r.get("name") or "",
            r.get("description") or "",
            " ".join(caps),
            " ".join(procs),
            " ".join(specs),
        ])
        records.append(FacilityRecord(
            facility_id=r["facility_id"],
            name=r.get("name") or "",
            state=r.get("state"),
            city=r.get("city"),
            description=r.get("description"),
            explicit_capabilities=caps,
            embedding=np.asarray(list(emb), dtype=np.float32),
            bm25_text=bm25_text,
        ))
    _INDEX = FacilityIndex(records)
    print(f"[index] loaded {len(records)} enriched facilities")
    return _INDEX


def get_index() -> FacilityIndex:
    if _INDEX is None:
        raise RuntimeError("Index not loaded. Did lifespan run?")
    return _INDEX
