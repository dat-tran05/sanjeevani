#!/bin/bash
# Phase B2 integration check — runs all 3 hero queries against a running backend.
# Usage:
#   1. Start backend: cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
#   2. Run this script: bash scripts/integration_check.sh
#
# Use `curl -o` (NOT `curl > file`) to avoid stdout truncation issues with
# large SSE streams.

set -euo pipefail

OUT=/tmp/sanjeevani_test
mkdir -p "$OUT"

BASE_URL="${BASE_URL:-http://localhost:8000}"

echo "=== checking server ==="
curl -sf "$BASE_URL/health" || { echo "backend not running on $BASE_URL"; exit 1; }
echo

echo "=== q1: Bihar appendectomy ==="
curl -sN -m 300 -X POST -o "$OUT/q1.sse" \
  -H 'Content-Type: application/json' \
  -d '{"query":"Find the nearest facility in rural Bihar that can perform an emergency appendectomy and typically leverages part-time doctors."}' \
  "$BASE_URL/query"

echo "=== q2: Mumbai oncology ==="
curl -sN -m 300 -X POST -o "$OUT/q2.sse" \
  -H 'Content-Type: application/json' \
  -d '{"query":"Which hospitals in Mumbai should I trust for radiation oncology? A lot of listings claim it but I only want ones where the equipment and specialist roster actually back the claim up."}' \
  "$BASE_URL/query"

echo "=== q3: PICU desert (crisis-map endpoint) ==="
curl -s -o "$OUT/q3.json" \
  "$BASE_URL/crisis-map?capability=picu&state=Tamil%20Nadu"

echo
echo "=== summary ==="
python3 - <<'PY'
import os, json
for label, f in [("q1", "/tmp/sanjeevani_test/q1.sse"),
                 ("q2", "/tmp/sanjeevani_test/q2.sse")]:
    sz = os.path.getsize(f)
    with open(f, "rb") as fh: data = fh.read()
    counts = {}
    for typ in ["thinking_delta","agent_step_start","agent_step_end","tool_call",
                "model_proposal","jury_verdict","tiebreaker_resolved",
                "validator_check","ranked_card","citation","text_delta",
                "exclusion","stream_complete","error"]:
        counts[typ] = data.count(typ.encode())
    err = "FAIL" if counts["error"] > 0 else "ok" if counts["stream_complete"] >= 1 else "INCOMPLETE"
    print(f"{label}: {sz} bytes, {err}")
    for k, v in counts.items():
        print(f"  {k}: {v}")

f = "/tmp/sanjeevani_test/q3.json"
with open(f) as fh: q3 = json.load(fh)
print(f"q3: {len(q3.get('districts', []))} districts returned for {q3.get('capability')}/{q3.get('state')}")
PY
