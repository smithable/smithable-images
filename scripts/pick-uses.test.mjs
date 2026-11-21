import assert from "node:assert/strict";
import test from "node:test";
import { COLS, ROWS, judge } from "./pick-uses.mjs";

const grid = (f) => Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => f(x, y)));

test("a calm left side makes a landscape picture a hero and a filler", () => {
  const r = judge(grid((x) => (x < 5 ? 1 : 20)), "landscape");
  assert.equal(r.calmSide, "left");
  assert.deepEqual(r.uses, ["hero", "filler"]);
});

test("detail everywhere: a filler, not a hero", () => {
  assert.deepEqual(judge(grid(() => 15), "landscape").uses, ["filler"]);
});

test("a small subject in the middle of an empty picture is neither", () => {
  const r = judge(grid((x, y) => (x >= 4 && x < 8 && y >= 2 && y < 6 ? 30 : 0.5)), "landscape");
  assert.ok(r.centre > 0.5);
  assert.deepEqual(r.uses, []);
});

test("a portrait picture is never a hero or a filler", () => {
  assert.deepEqual(judge(grid((x) => (x < 5 ? 1 : 20)), "portrait").uses, []);
});
