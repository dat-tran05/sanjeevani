/* eslint-disable @typescript-eslint/no-require-imports */
// Build-time dump of /facilities/all → frontend/public/facilities.min.json.
//
// IDs match the Databricks SHA256 facility_id, so AtlasMap clicks resolve
// against /facilities/{id} on the backend.
//
// Usage:   node scripts/build-facilities-json.cjs
// Env:     API_URL=http://localhost:8000  (default)

const fs = require("node:fs");
const path = require("node:path");

const API_URL = process.env.API_URL || "http://localhost:8000";
const OUT_PATH = path.resolve(__dirname, "..", "public", "facilities.min.json");

function inIndiaBbox(lat, lng) {
  return lat >= 6 && lat <= 37 && lng >= 68 && lng <= 97;
}

function normalizeType(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "farmacy") return "pharmacy";
  if (!s) return "other";
  return s;
}

async function main() {
  const url = `${API_URL}/facilities/all`;
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Backend returned ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const { facilities: rows } = await res.json();
  console.log(`  ${rows.length} facilities returned`);

  const facilities = [];
  let dropped = 0;
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndiaBbox(lat, lng)) {
      dropped += 1;
      continue;
    }
    facilities.push({
      id: r.id,
      name: (r.name || "").trim(),
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      state: (r.state || "").trim(),
      city: (r.city || "").trim(),
      type: normalizeType(r.type),
      verified: Boolean(r.verified),
    });
  }

  console.log(`  kept ${facilities.length}, dropped ${dropped} (out-of-bbox or missing coords)`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(facilities));
  const size = fs.statSync(OUT_PATH).size;
  console.log(`Wrote ${OUT_PATH} (${(size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
