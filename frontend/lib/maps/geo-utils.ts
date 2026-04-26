// Pure geometry helpers for the Atlas map.
// Ported from project/india-geo.js (centroidLngLat, bboxLngLat) and
// project/components-atlas.jsx lines 44-50 (gapColor).
// Coordinates use [lng, lat] order (GeoJSON convention).

type Ring = Array<[number, number]>;

export function centroidLngLat(rings: Ring[]): [number, number] {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      sumX += x;
      sumY += y;
      count += 1;
    }
  }
  return [sumX / count, sumY / count];
}

export function bboxLngLat(rings: Ring[]): {
  mnLng: number;
  mxLng: number;
  mnLat: number;
  mxLat: number;
} {
  let mnLng = Infinity;
  let mxLng = -Infinity;
  let mnLat = Infinity;
  let mxLat = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < mnLng) mnLng = x;
      if (x > mxLng) mxLng = x;
      if (y < mnLat) mnLat = y;
      if (y > mxLat) mxLat = y;
    }
  }
  return { mnLng, mxLng, mnLat, mxLat };
}

/** Maps gap (0=well-served, 1=severe) to a green→red palette. */
export function gapColor(g: number): string {
  if (g < 0.3) return "#34C58A";
  if (g < 0.5) return "#7DB87A";
  if (g < 0.65) return "#BFA46A";
  if (g < 0.8) return "#C07D4A";
  return "#C04A3F";
}
