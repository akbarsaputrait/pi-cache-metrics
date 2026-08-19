/**
 * Standalone self-test for cache-metrics pure logic (no framework, no keys).
 * Run: bun run cache-metrics.test.ts
 * Kept OUTSIDE ~/.pi/agent/extensions/ so it is not auto-loaded as an extension.
 */
import * as assert from "node:assert";
import type { Totals } from "./cache-metrics.ts";
import { classify, estimateSaved, mergeTotals, hitRate, hitRateTrend } from "./cache-metrics.ts";

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

// hitRateTrend: all hits -> all top blocks; no eligible -> dots
const h = { time: "12:00", model: "m", cacheRead: 1, cacheWrite: 0, saved: 0 };
const allHits = Array.from({ length: 48 }, () => ({ ...h, kind: "hit" as const }));
assert.strictEqual(hitRateTrend(allHits, 24).replace(/[█]/g, ""), "");
assert.ok(hitRateTrend(allHits, 24).includes("█"));

const mixed = [...Array.from({ length: 40 }, () => ({ ...h, kind: "hit" as const })),
	...Array.from({ length: 8 }, () => ({ ...h, kind: "miss" as const }))];
const trend = hitRateTrend(mixed, 24);
assert.ok(trend.includes("▁") || trend.includes("▂") || trend.includes("▃"), `expected low blocks in ${trend}`);

const none = Array.from({ length: 10 }, () => ({ ...h, kind: "none" as const }));
assert.ok(hitRateTrend(none, 10).split("").every(c => c === "."), "no-eligible window should be dots");

assert.strictEqual(hitRateTrend([], 10), "(no data)");

console.log("[cache-metrics] selfTest: 13 assertions passed");