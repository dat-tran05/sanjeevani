"""Hybrid retrieval node — BM25 ‖ dense → RRF (in-process)."""
from __future__ import annotations

from collections.abc import Iterator
import time

from app.agents.state import AgentState, QueryIntent, RetrievedFacility
from app.llm.databricks_serving import embed_query
from app.retrieval.index import get_index
from app.streaming.sse import StreamEvent, tool_call


def _rrf_fuse(bm25: list[tuple[str, float]], dense: list[tuple[str, float]],
              k: int = 60, top_n: int = 64) -> list[tuple[str, float, float, float]]:
    """Returns list of (facility_id, rrf_score, bm25_score, dense_score)."""
    bm25_rank = {fid: i for i, (fid, _) in enumerate(bm25)}
    dense_rank = {fid: i for i, (fid, _) in enumerate(dense)}
    bm25_score = {fid: s for fid, s in bm25}
    dense_score = {fid: s for fid, s in dense}
    all_ids = set(bm25_rank) | set(dense_rank)
    scored = []
    for fid in all_ids:
        rrf = 0.0
        if fid in bm25_rank:
            rrf += 1.0 / (k + bm25_rank[fid] + 1)
        if fid in dense_rank:
            rrf += 1.0 / (k + dense_rank[fid] + 1)
        scored.append((fid, rrf, bm25_score.get(fid, 0.0), dense_score.get(fid, 0.0)))
    scored.sort(key=lambda x: -x[1])
    return scored[:top_n]


def hybrid_retrieve_node(intent: QueryIntent, candidate_ids: list[str]
                         ) -> Iterator[StreamEvent | tuple[str, AgentState]]:
    started = time.perf_counter()
    qtext = intent.capability or intent.raw_query
    BM25_K = 32
    DENSE_K = 32
    TOP_N = 64
    idx = get_index()
    # BM25 and dense are both in-process (no I/O), run sequentially
    bm25 = idx.bm25_topk(qtext, candidate_ids, k=BM25_K)
    qvec = embed_query(qtext)
    dense = idx.dense_topk(qvec, candidate_ids, k=DENSE_K)
    fused = _rrf_fuse(bm25, dense, k=60, top_n=TOP_N)
    runtime_ms = int((time.perf_counter() - started) * 1000)

    retrieved: list[RetrievedFacility] = []
    for fid, rrf_s, bm25_s, dense_s in fused:
        pos = idx.position_of(fid)
        if pos is None:
            continue
        rec = idx.records[pos]
        retrieved.append(RetrievedFacility(
            facility_id=rec.facility_id, name=rec.name, state=rec.state, city=rec.city,
            description=rec.description, explicit_capabilities=rec.explicit_capabilities,
            bm25_score=bm25_s, dense_score=dense_s, rrf_score=rrf_s,
        ))

    # Approximate "recall@64" as overlap fraction between BM25 top-K and dense top-K
    bm25_set = {fid for fid, _ in bm25}
    dense_set = {fid for fid, _ in dense}
    overlap = len(bm25_set & dense_set) / max(1, min(len(bm25_set), len(dense_set)))
    yield tool_call(
        name="hybrid_retrieve",
        input={"bm25_top": BM25_K, "dense_top": DENSE_K, "rrf_k": 60},
        output_summary=f"Retrieved {len(retrieved)} candidates",
        runtime_ms=runtime_ms,
        meta={"recall_at_64": round(overlap, 2),
              "bm25_top": BM25_K, "dense_top": DENSE_K, "rrf_k": 60},
    )
    yield ("done", {"retrieved": retrieved})
