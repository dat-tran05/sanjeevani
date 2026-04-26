import { describe, it, expect } from "vitest";
import { centroidLngLat, bboxLngLat, gapColor } from "@/lib/maps/geo-utils";

describe("geo-utils", () => {
  it("centroidLngLat averages a single ring", () => {
    const ring: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(centroidLngLat([ring])).toEqual([5, 5]);
  });

  it("bboxLngLat returns extremes", () => {
    const ring: Array<[number, number]> = [[80, 22], [85, 24], [82, 26]];
    expect(bboxLngLat([ring])).toEqual({ mnLng: 80, mxLng: 85, mnLat: 22, mxLat: 26 });
  });

  it("gapColor returns green for low gap, red for high", () => {
    expect(gapColor(0.0)).toMatch(/^#34/);
    expect(gapColor(0.95)).toMatch(/^#C0/);
  });
});
