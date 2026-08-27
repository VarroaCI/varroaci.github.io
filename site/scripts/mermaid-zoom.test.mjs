// Unit tests for the mermaid viewer's transform math. The DOM wiring in
// mermaid-zoom.js is exercised in the browser; these cover the parts that
// decide where the diagram actually lands.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  zoomAt,
  fitScale,
  centerAt,
} from "../src/scripts/mermaid-zoom.js";

describe("clampScale", () => {
  test("passes a scale inside the range through untouched", () => {
    assert.equal(clampScale(1), 1);
    assert.equal(clampScale(3.5), 3.5);
  });

  test("clamps past both ends", () => {
    assert.equal(clampScale(0.01), MIN_SCALE);
    assert.equal(clampScale(500), MAX_SCALE);
  });
});

describe("zoomAt", () => {
  test("keeps the point under the cursor fixed on screen", () => {
    const before = { scale: 1, x: 0, y: 0 };
    const px = 300;
    const py = 200;

    // Content coordinate currently under (px, py).
    const cx = (px - before.x) / before.scale;
    const cy = (py - before.y) / before.scale;

    const after = zoomAt(before, 2, px, py);

    // That same content coordinate must still project to (px, py).
    assert.ok(Math.abs(after.x + cx * after.scale - px) < 1e-9);
    assert.ok(Math.abs(after.y + cy * after.scale - py) < 1e-9);
  });

  test("holds the anchor across an off-origin, already-zoomed state", () => {
    const before = { scale: 2.5, x: -140, y: 65 };
    const px = 512;
    const py = 377;
    const cx = (px - before.x) / before.scale;
    const cy = (py - before.y) / before.scale;

    const after = zoomAt(before, 1 / 1.25, px, py);

    assert.ok(Math.abs(after.x + cx * after.scale - px) < 1e-9);
    assert.ok(Math.abs(after.y + cy * after.scale - py) < 1e-9);
  });

  test("does not drift once clamped at the maximum", () => {
    const atMax = { scale: MAX_SCALE, x: 10, y: 20 };
    const after = zoomAt(atMax, 4, 100, 100);
    assert.equal(after.scale, MAX_SCALE);
    assert.equal(after.x, atMax.x);
    assert.equal(after.y, atMax.y);
  });
});

describe("fitScale", () => {
  test("shrinks content that is larger than the stage", () => {
    const s = fitScale(2000, 1000, 800, 600);
    assert.ok(s < 1);
    assert.ok(2000 * s <= 800);
    assert.ok(1000 * s <= 600);
  });

  test("grows a small diagram but not past maxUpscale", () => {
    assert.equal(fitScale(100, 80, 1600, 1200, 1.5), 1.5);
  });

  test("returns 1 rather than NaN for a zero-sized input", () => {
    assert.equal(fitScale(0, 0, 800, 600), 1);
    assert.equal(fitScale(800, 600, 0, 0), 1);
  });
});

describe("centerAt", () => {
  test("centers content within the stage", () => {
    const { x, y, scale } = centerAt(400, 200, 1000, 600, 1);
    assert.equal(scale, 1);
    assert.equal(x, 300);
    assert.equal(y, 200);
    // Content midpoint lands on the stage midpoint.
    assert.equal(x + (400 * scale) / 2, 500);
    assert.equal(y + (200 * scale) / 2, 300);
  });

  test("accounts for scale when centering", () => {
    const { x } = centerAt(400, 200, 1000, 600, 2);
    assert.equal(x, 100);
  });
});
