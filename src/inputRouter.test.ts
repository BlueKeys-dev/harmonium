import { test } from "node:test";
import assert from "node:assert/strict";
import { InputRouter } from "./inputRouter";

test("InputRouter suppresses repeats and releases the exact source", () => {
  const starts: number[] = [];
  const stops: number[] = [];
  const downs: number[] = [];
  const router = new InputRouter({
    startNote: (key) => { starts.push(key); return true; },
    stopNote: (key) => stops.push(key),
    noteDown: ({ key }) => downs.push(key),
  });
  assert.equal(router.press("keyboard:KeyA", 12, "computer", 10), true);
  assert.equal(router.press("keyboard:KeyA", 12, "computer", 11), false);
  router.release("keyboard:KeyA");
  assert.deepEqual(starts, [12]);
  assert.deepEqual(downs, [12]);
  assert.deepEqual(stops, [12]);
});

test("InputRouter keeps a reed held until its final owner releases", () => {
  const stops: number[] = [];
  const downs: number[] = [];
  const router = new InputRouter({
    startNote: () => true,
    stopNote: (key) => stops.push(key),
    noteDown: ({ key }) => downs.push(key),
  });
  router.press("keyboard:KeyA", 12, "computer", 10);
  router.press("pointer:4", 12, "onscreen", 11);
  router.release("keyboard:KeyA");
  assert.deepEqual(stops, []);
  router.release("pointer:4");
  assert.deepEqual(stops, [12]);
  assert.deepEqual(downs, [12]);
});

test("InputRouter replaces a source hold and releaseAll clears everything", () => {
  const stops: number[] = [];
  const router = new InputRouter({
    startNote: () => true,
    stopNote: (key) => stops.push(key),
    noteDown: () => {},
  });
  router.press("pointer:1", 12, "onscreen", 10);
  router.press("pointer:1", 14, "onscreen", 20);
  router.press("keyboard:KeyS", 16, "computer", 30);
  assert.deepEqual(stops, [12]);
  router.releaseAll();
  assert.equal(router.heldCount(), 0);
  assert.deepEqual(stops, [12, 14, 16]);
});

test("InputRouter does not retain or grade a note when audio cannot start", () => {
  let graded = false;
  const router = new InputRouter({
    startNote: () => false,
    stopNote: () => {},
    noteDown: () => { graded = true; },
  });
  assert.equal(router.press("keyboard:KeyA", 12, "computer", 10), false);
  assert.equal(router.heldCount(), 0);
  assert.equal(graded, false);
});
