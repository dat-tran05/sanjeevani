/* eslint-disable @typescript-eslint/no-require-imports */
// Build-time CSV → JSON for the Atlas map.
// Reads ../data/india_healthcare_facilities.csv (10,053 rows), keeps only the
// columns the map needs (id, name, lat, lng, state, city, pincode, type),
// validates coordinates are inside the India bounding box, and writes
// frontend/public/facilities.min.json.
//
// Run via:  node scripts/build-facilities-json.cjs
// Re-run whenever the source CSV changes.

const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("csv-parse/sync");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CSV_PATH = path.join(REPO_ROOT, "data", "india_healthcare_facilities.csv");
const OUT_PATH = path.resolve(__dirname, "..", "public", "facilities.min.json");

// facilityTypeId is a string label in the source CSV. Normalize the typo
// "farmacy" → "pharmacy" and pass everything else through.
function normalizeType(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "farmacy") return "pharmacy";
  if (!s) return "other";
  return s;
}

function inIndiaBbox(lat, lng) {
  return lat >= 6 && lat <= 37 && lng >= 68 && lng <= 97;
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }

  console.log(`Reading ${CSV_PATH}...`);
  const csv = fs.readFileSync(CSV_PATH, "utf8");

  console.log("Parsing CSV...");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  console.log(`  ${rows.length} rows`);

  const facilities = [];
  let dropped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndiaBbox(lat, lng)) {
      dropped += 1;
      continue;
    }
    const type = normalizeType(r.facilityTypeId);
    facilities.push({
      id: `F${String(i).padStart(5, "0")}`,
      name: (r.name || "").trim(),
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      state: (r.address_stateOrRegion || "").trim(),
      city: (r.address_city || "").trim(),
      pincode: (r.address_zipOrPostcode || "").trim(),
      type,
    });
  }

  console.log(`  kept ${facilities.length}, dropped ${dropped} (out-of-bbox or missing coords)`);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(facilities));
  const size = fs.statSync(OUT_PATH).size;
  console.log(`Wrote ${OUT_PATH} (${(size / 1024).toFixed(0)} KB)`);
}

main();
