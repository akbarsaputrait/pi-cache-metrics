/**
 * Cache Metrics — live prompt-cache visibility in the footer.
 *
 * Tracks cache hit/miss rates, cache token usage, and estimated cost savings
 * across the active session. State is persisted as branch-safe custom entries
 * so it survives reload/fork and reconstructs on session_start.
 *
 * Data source: `message_end` -> `event.message.usage`. Pi normalizes
 * per-provider cache tokens into a single `Usage.cacheRead` / `cacheWrite`
 * pair (Anthropic `usage.cache_read_input_tokens`, OpenAI cache usage, etc.).
 * This is more robust than parsing provider-specific response headers, which
 * the docs note are not uniformly exposed across providers/transports. The
 * semantics mirror the headers exactly: cacheRead > 0 is a hit, cacheWrite > 0
 * with cacheRead === 0 is a miss that populated the cache, both zero is no-cache.
 */

import * as assert from "node:assert";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

const WIDGET = "cache-metrics";

export type CacheKind = "hit" | "miss" | "none";

export interface CacheRecord {
	/** "hit" = cacheRead > 0; "miss" = cacheWrite > 0 && cacheRead === 0; "none" = neither. */
	kind: CacheKind;
	cacheRead: number;
	cacheWrite: number;
	/** Estimated USD saved vs. paying input rate for the same tokens. */
	saved: number;
	model: string;
}

export interface Totals {
	requests: number;
	hits: number;
	misses: number;
	noCache: number;
	cacheRead: number;
	cacheWrite: number;
	saved: number;
	lastModel: string;
}

export interface Settings {
	showFooter: boolean;
	footerFormat: "compact" | "detailed";
	costPrecision: number;
	hitRateAlert: number | null;
	trackModels: string[] | "all";
	colorTheme: "auto" | "mono" | "color";
}

const DEFAULT_SETTINGS: Settings = {
	showFooter: true,
	footerFormat: "compact",
	costPrecision: 4,
	hitRateAlert: 50,
	trackModels: "all",
	colorTheme: "auto",
};

let settings: Settings = { ...DEFAULT_SETTINGS };

export function classify(cacheRead: number, cacheWrite: number): CacheKind {
	if (cacheRead > 0) return "hit";
	if (cacheWrite > 0) return "miss";
	return "none";
}

export function estimateSaved(
	cacheRead: number,
	cacheWrite: number,
	costCacheRead: number,
	costCacheWrite: number,
	inputRate: number,
): number {
	const wouldBeInput = (cacheRead + cacheWrite) * inputRate / 1e6;
	return wouldBeInput - (costCacheRead + costCacheWrite);
}

export function mergeTotals(totals: Totals, rec: CacheRecord): void {
	totals.requests += 1;
	totals.cacheRead += rec.cacheRead;
	totals.cacheWrite += rec.cacheWrite;
	totals.saved += rec.saved;
	totals.lastModel = rec.model;
	if (rec.kind === "hit") totals.hits += 1;
	else if (rec.kind === "miss") totals.misses += 1;
	else totals.noCache += 1;
}

export function hitRate(totals: Totals): number {
	const eligible = totals.hits + totals.misses;
	return eligible === 0 ? 0 : (totals.hits / eligible) * 100;
}

function fmt(n: number): string {
	if (n >= 1000) {
		const k = (n / 1000).toFixed(1).replace(/\.0$/, "");
		return `${k}k`;
	}
	return String(n);
}

function colorize(ctx: ExtensionContext, text: string, kind: "hit" | "miss" | "neutral" | "accent"): string {
	if (settings.colorTheme === "mono") return text;
	const theme = ctx.ui.theme;
	switch (kind) {
		case "hit": return theme.fg("success", text);
		case "miss": return theme.fg("warning", text);
		case "accent": return theme.fg("accent", text);
		default: return theme.fg("dim", text);
	}
}

function footerCompact(ctx: ExtensionContext, totals: Totals): string {
	const rate = hitRate(totals);
	const eligible = totals.hits + totals.misses;
	if (eligible === 0) return colorize(ctx, "💾 cache —", "neutral");

	const rateStr = `${rate.toFixed(0)}%`;
	const hitStr = `${totals.hits}H`;
	const missStr = `${totals.misses}M`;
	const crStr = `cr${fmt(totals.cacheRead)}`;
	const cwStr = `cw${fmt(totals.cacheWrite)}`;
	const saveStr = `$${totals.saved.toFixed(settings.costPrecision)}`;

	return (
		colorize(ctx, "💾 cache ", "accent") +
		colorize(ctx, rateStr, rate >= 70 ? "hit" : rate >= 40 ? "miss" : "neutral") + " " +
		colorize(ctx, `(${hitStr}/${missStr})`, "neutral") + " · " +
		colorize(ctx, crStr, "hit") + "/" +
		colorize(ctx, cwStr, "miss") + " · " +
		colorize(ctx, `-${saveStr}`, "hit")
	);
}

function footerDetailed(ctx: ExtensionContext, totals: Totals): string {
	const rate = hitRate(totals);
	const eligible = totals.hits + totals.misses;
	const rateStr = eligible === 0 ? "n/a" : `${rate.toFixed(1)}%`;
	const saveStr = `$${totals.saved.toFixed(settings.costPrecision)}`;

	return (
		colorize(ctx, "💾 Cache Metrics ", "accent") +
		`hit-rate ${colorize(ctx, rateStr, rate >= 70 ? "hit" : rate >= 40 ? "miss" : "neutral")} ` +
		`(${totals.hits}H ${totals.misses}M ${totals.noCache}NC) ` +
		`read ${colorize(ctx, fmt(totals.cacheRead), "hit")} ` +
		`write ${colorize(ctx, fmt(totals.cacheWrite), "miss")} ` +
		`saved ${colorize(ctx, saveStr, "hit")} ` +
		`model ${totals.lastModel || "—"}`
	);
}

function footer(ctx: ExtensionContext, totals: Totals): string {
	if (!settings.showFooter) return "";
	return settings.footerFormat === "detailed" ? footerDetailed(ctx, totals) : footerCompact(ctx, totals);
}

export function report(totals: Totals, modelStats?: Map<string, Totals>): string {
	const eligible = totals.hits + totals.misses;
	const lines = [
		"Cache Metrics — session summary",
		`provider/model: ${totals.lastModel || "(none yet)"}`,
		`requests: ${totals.requests}  hits: ${totals.hits}  misses: ${totals.misses}  no-cache: ${totals.noCache}`,
		`hit rate: ${eligible === 0 ? "n/a" : hitRate(totals).toFixed(1) + "%"}`,
		`cache read tokens: ${totals.cacheRead}`,
		`cache write tokens: ${totals.cacheWrite}`,
		`estimated savings: $${totals.saved.toFixed(settings.costPrecision)}`,
	];

	if (modelStats && modelStats.size > 0) {
		lines.push("", "Per-model:");
		for (const [model, t] of modelStats) {
			const mEligible = t.hits + t.misses;
			const rateStr = mEligible === 0 ? "n/a" : hitRate(t).toFixed(0) + "%";
			lines.push(`  ${model}: ${t.requests} req, ${rateStr} hit, $${t.saved.toFixed(settings.costPrecision)} saved`);
		}
	}

	lines.push("", "Settings:",
		`  footer: ${settings.showFooter ? "on" : "off"} (${settings.footerFormat})`,
		`  cost precision: ${settings.costPrecision}`,
		`  hit-rate alert: ${settings.hitRateAlert !== null ? settings.hitRateAlert + "%" : "off"}`,
		`  track models: ${Array.isArray(settings.trackModels) ? settings.trackModels.join(", ") : "all"}`,
		`  color theme: ${settings.colorTheme}`,
	);
	return lines.join("\n");
}

function newTotals(): Totals {
	return {
		requests: 0,
		hits: 0,
		misses: 0,
		noCache: 0,
		cacheRead: 0,
		cacheWrite: 0,
		saved: 0,
		lastModel: "",
	};
}

const totals: Totals = newTotals();

/** Per-model aggregates (model id -> totals). */
const modelStats: Map<string, Totals> = new Map();

/** Rolling log of recent requests (newest last), capped. */
const history: Array<{ time: string; model: string; kind: CacheKind; cacheRead: number; cacheWrite: number; saved: number }> = [];
const HISTORY_MAX = 50;

function record(rec: CacheRecord): void {
	mergeTotals(totals, rec);
	let ms = modelStats.get(rec.model);
	if (!ms) {
		ms = newTotals();
		modelStats.set(rec.model, ms);
	}
	mergeTotals(ms, rec);
	history.push({
		time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
		model: rec.model,
		kind: rec.kind,
		cacheRead: rec.cacheRead,
		cacheWrite: rec.cacheWrite,
		saved: rec.saved,
	});
	if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
}

type HistoryEntry = { time: string; model: string; kind: CacheKind; cacheRead: number; cacheWrite: number; saved: number };

/**
 * ASCII hit-rate trend chart (oldest → newest). Buckets the history into
 * columns; each column shows the hit rate for that window.
 * Column heights: blocks ▁▂▃▄▅▆▇█ (0-100% hit rate), `.` = no cache-eligible
 * requests in that window.
 */
export function hitRateTrend(hist: HistoryEntry[], cols = 24): string {
	if (hist.length === 0) return "(no data)";
	const n = Math.min(cols, hist.length);
	const size = Math.ceil(hist.length / n);
	const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		const slice = hist.slice(i * size, (i + 1) * size);
		let hits = 0, eligible = 0;
		for (const h of slice) {
			if (h.kind === "hit") { hits++; eligible++; }
			else if (h.kind === "miss") eligible++;
		}
		if (eligible === 0) { out.push("."); continue; }
		const rate = hits / eligible;
		const idx = Math.min(blocks.length - 1, Math.round(rate * (blocks.length - 1)));
		out.push(blocks[idx]);
	}
	return out.join("");
}

function reconstruct(ctx: ExtensionContext): void {
	const branch = ctx.sessionManager.getBranch();
	for (const entry of branch) {
		if (entry.type === "custom") {
			if (entry.customType === "cache-stats") {
				const rec = entry.data as CacheRecord;
				record({
					kind: rec.kind,
					cacheRead: rec.cacheRead,
					cacheWrite: rec.cacheWrite,
					saved: rec.saved,
					model: rec.model,
				});
			} else if (entry.customType === "cache-settings") {
				settings = { ...DEFAULT_SETTINGS, ...(entry.data as Partial<Settings>) };
			}
		}
	}
}

function persistSettings(pi: ExtensionAPI): void {
	pi.appendEntry("cache-settings", settings);
}

function refreshFooter(ctx: ExtensionContext): void {
	if (ctx.mode === "tui") {
		const ft = footer(ctx, totals);
		if (ft) ctx.ui.setStatus(WIDGET, ft);
		else ctx.ui.setStatus(WIDGET, "");
	}
}

function checkHitRateAlert(ctx: ExtensionContext): void {
	if (settings.hitRateAlert === null) return;
	const rate = hitRate(totals);
	const eligible = totals.hits + totals.misses;
	if (eligible >= 5 && rate < settings.hitRateAlert) {
		ctx.ui.notify(`⚠️ Cache hit rate ${rate.toFixed(0)}% below ${settings.hitRateAlert}% threshold`, "warning");
	}
}

function shouldTrack(model: string): boolean {
	if (settings.trackModels === "all") return true;
	return (settings.trackModels as string[]).some(m => model.includes(m));
}

function selfTest(): void {
	assert.strictEqual(classify(100, 0), "hit");
	assert.strictEqual(classify(0, 50), "miss");
	assert.strictEqual(classify(0, 0), "none");
	assert.strictEqual(classify(100, 50), "hit");

	const saved = estimateSaved(1000, 0, 0.000075, 0, 3);
	assert.ok(Math.abs(saved - 0.002925) < 1e-9, `estimateSaved gave ${saved}`);

	const t: Totals = newTotals();
	mergeTotals(t, { kind: "hit", cacheRead: 1000, cacheWrite: 0, saved: 0.01, model: "anthropic/claude" });
	mergeTotals(t, { kind: "miss", cacheRead: 0, cacheWrite: 500, saved: 0.005, model: "anthropic/claude" });
	assert.strictEqual(t.requests, 2);
	assert.strictEqual(t.hits, 1);
	assert.strictEqual(t.misses, 1);
	assert.strictEqual(t.cacheRead, 1000);
	assert.strictEqual(t.cacheWrite, 500);

	if (process.env.CACHE_DEBUG_SELFTEST === "1") {
		console.log("[cache-metrics] selfTest: 9 assertions passed");
	}
}

export default function (pi: ExtensionAPI) {
	if (process.env.CACHE_DEBUG_SELFTEST === "1") selfTest();

	pi.on("session_start", async (_event, ctx) => {
		totals.requests = 0;
		totals.hits = 0;
		totals.misses = 0;
		totals.noCache = 0;
		totals.cacheRead = 0;
		totals.cacheWrite = 0;
		totals.saved = 0;
		totals.lastModel = "";
		settings = { ...DEFAULT_SETTINGS };
		reconstruct(ctx);
		refreshFooter(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		if (!shouldTrack(message.model)) return;
		const usage = message.usage;
		if (!usage) return;

		// Get input rate (per million tokens) from active model or registry lookup
		let inputRate = ctx.model?.cost?.input;
		if (inputRate === undefined) {
			// Try to parse provider/model from message.model and lookup in registry
			const modelId = message.model;
			const [provider, ...rest] = modelId.split("/");
			const modelName = rest.join("/") || modelId;
			const model = ctx.modelRegistry?.find(provider, modelName);
			inputRate = model?.cost?.input;
		}
		// Fallback: infer from usage if there are non-cached input tokens
		if (inputRate === undefined && usage.input > 0 && usage.cost.input > 0) {
			inputRate = (usage.cost.input / usage.input) * 1e6;
		}

		const saved =
			inputRate !== undefined
				? estimateSaved(
						usage.cacheRead,
						usage.cacheWrite,
						usage.cost.cacheRead,
						usage.cost.cacheWrite,
						inputRate,
					)
				: 0;

		const rec: CacheRecord = {
			kind: classify(usage.cacheRead, usage.cacheWrite),
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			saved,
			model: message.model,
		};
		record(rec);

		pi.appendEntry("cache-stats", rec);
		refreshFooter(ctx);
		checkHitRateAlert(ctx);
	});

	pi.registerCommand("cache", {
		description: "Show prompt-cache statistics for this session",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(report(totals, modelStats), "info");
			else console.log(report(totals, modelStats));
		},
	});

	pi.registerCommand("cache-log", {
		description: "Show recent cache requests (last 50) with hit-rate chart",
		handler: async (_args, ctx) => {
			if (history.length === 0) {
				if (ctx.hasUI) ctx.ui.notify("Cache Metrics: no requests logged yet", "info");
				else console.log("Cache Metrics: no requests logged yet");
				return;
			}
			const lines = history.map(h =>
				`${h.time}  ${h.model}  ${h.kind.padEnd(4)}  read ${h.cacheRead}  write ${h.cacheWrite}  $${h.saved.toFixed(settings.costPrecision)}`,
			);
			const out = [
				"Cache Metrics — recent requests",
				"",
				`hit-rate trend (oldest → newest):`,
				`${hitRateTrend(history)}`,
				"",
				...lines,
			].join("\n");
			if (ctx.hasUI) ctx.ui.notify(out, "info");
			else console.log(out);
		},
	});

	pi.registerCommand("cache-settings", {
		description: "Interactive TUI settings for Cache Metrics",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/cache-settings requires TUI mode", "error");
				return;
			}

			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const items: SettingItem[] = [
					{
						id: "showFooter",
						label: "Show Footer",
						currentValue: settings.showFooter ? "on" : "off",
						values: ["on", "off"],
					},
					{
						id: "footerFormat",
						label: "Footer Format",
						currentValue: settings.footerFormat,
						values: ["compact", "detailed"],
					},
					{
						id: "costPrecision",
						label: "Cost Precision (decimals)",
						currentValue: String(settings.costPrecision),
						values: ["0", "1", "2", "3", "4", "5", "6"],
					},
					{
						id: "hitRateAlert",
						label: "Hit-Rate Alert Threshold (%)",
						currentValue: settings.hitRateAlert !== null ? String(settings.hitRateAlert) : "off",
						values: ["off", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"],
					},
					{
						id: "colorTheme",
						label: "Color Theme",
						currentValue: settings.colorTheme,
						values: ["auto", "mono", "color"],
					},
				];

				const container = new Container();
				// Help text explaining cache metrics
				container.addChild(new (class {
					render(width: number) {
						const lines = [
							theme.fg("accent", theme.bold("Cache Metrics Settings")),
							theme.fg("dim", "Prompt caching reuses your context prefix (system prompt + tools + history)"),
							theme.fg("dim", "across requests. High hit-rate = faster responses, lower cost."),
							"",
						];
						return lines.map((l, i) => l.padEnd(width)).slice(0, width);
					}
					invalidate() {}
				})());

				const settingsList = new SettingsList(
					items,
					items.length + 2,
					getSettingsListTheme(),
					(id, newValue) => {
						switch (id) {
							case "showFooter":
								settings.showFooter = newValue === "on";
								break;
							case "footerFormat":
								settings.footerFormat = newValue as "compact" | "detailed";
								break;
							case "costPrecision":
								settings.costPrecision = Number(newValue);
								break;
							case "hitRateAlert":
								settings.hitRateAlert = newValue === "off" ? null : Number(newValue);
								break;
							case "colorTheme":
								settings.colorTheme = newValue as "auto" | "mono" | "color";
								break;
						}
						persistSettings(pi);
						refreshFooter(ctx);
					},
					() => {
						done(undefined);
					},
				);

				container.addChild(settingsList);

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						settingsList.handleInput?.(data);
					},
				};
			});
		},
	});
}