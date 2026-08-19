/**
 * Standalone self-test for cache-insight pure logic (no framework, no keys).
 * Run: bun run ~/.pi/agent/cache-insight.test.ts
 * Kept OUTSIDE ~/.pi/agent/extensions/ so it is not auto-loaded as an extension.
 */
import * as assert from "node:assert";
import type { Totals, Settings } from "./extensions/cache-insight.ts";
import { classify, estimateSaved, mergeTotals, hitRate } from "./extensions/cache-insight.ts";

const t: Totals = {
	requests: 0, hits: 0, misses: 0, noCache: 0,
	cacheRead: 0, cacheWrite: 0, saved: 0, lastModel: "",
};

assert.strictEqual(classify(100, 0), "hit");
assert.strictEqual(classify(0, 50), "miss");
assert.strictEqual(classify(0, 0), "none");
assert.strictEqual(classify(100, 50), "hit"); // partial hit counts as hit

// (1000+0)*3/1e6 - 0.000075 = 0.002925
const saved = estimateSaved(1000, 0, 0.000075, 0, 3);
assert.ok(Math.abs(saved - 0.002925) < 1e-9, `estimateSaved ${saved}`);

mergeTotals(t, { kind: "hit", cacheRead: 1000, cacheWrite: 0, saved: 0.01, model: "anthropic/claude" });
mergeTotals(t, { kind: "miss", cacheRead: 0, cacheWrite: 500, saved: 0.005, model: "anthropic/claude" });

assert.strictEqual(t.requests, 2);
assert.strictEqual(t.hits, 1);
assert.strictEqual(t.misses, 1);
assert.strictEqual(t.cacheRead, 1000);
assert.strictEqual(t.cacheWrite, 500);
assert.ok(Math.abs(hitRate(t) - 50) < 1e-9);

console.log("[cache-insight] selfTest: 9 assertions passed");