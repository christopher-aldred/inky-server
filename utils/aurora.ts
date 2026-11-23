import { fetchWithTimeout } from "./http";

/**
 * Aurora alert for the UK (tuned for London, ~51.5°N).
 *
 * Two free, keyless sources:
 * - AuroraWatch UK (Lancaster University): current UK-wide status,
 *   green / yellow / amber / red. https://aurorawatch.lancs.ac.uk/
 * - NOAA SWPC planetary Kp forecast: 3-hourly Kp for the next ~3 days.
 *   https://www.swpc.noaa.gov/products/planetary-k-index
 *
 * At London's latitude aurora is only realistically visible when
 * AuroraWatch reaches amber/red or Kp reaches about 6+, so anything
 * lower produces no alert at all.
 */

export const AURORAWATCH_URL =
	"https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml";
export const NOAA_KP_FORECAST_URL =
	"https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";

export type AuroraWatchStatus = "green" | "yellow" | "amber" | "red";
export type AuroraLevel = "possible" | "likely";

export interface KpEntry {
	/** Start of the 3-hour slot, unix seconds (UTC). */
	time: number;
	kp: number;
}

export interface AuroraAlert {
	level: AuroraLevel;
	/** Highest Kp expected in the window, when the forecast was available. */
	kp: number | null;
	/** Text for the display, e.g. "Aurora likely tonight!" */
	message: string;
}

const STATUSES: AuroraWatchStatus[] = ["green", "yellow", "amber", "red"];

/** Read the site_status status_id out of AuroraWatch UK's current-status XML. */
export function parseAuroraWatchStatus(xml: string): AuroraWatchStatus | null {
	const match = /<site_status\b[^>]*\bstatus_id="([a-z]+)"/i.exec(xml);
	const id = match?.[1]?.toLowerCase();
	return STATUSES.includes(id as AuroraWatchStatus)
		? (id as AuroraWatchStatus)
		: null;
}

/** SWPC time tags look like "2026-11-23 00:00:00" or "2026-11-23T00:00:00", all UTC. */
function parseSwpcTime(tag: unknown): number | null {
	if (typeof tag !== "string") return null;
	const iso = tag.trim().replace(" ", "T");
	const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
	return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Parse NOAA's Kp forecast. SWPC has served it both as an array of rows with a
 * header row (["time_tag","kp","observed","noaa_scale"], ...) and as an array
 * of objects ({ time_tag, kp, ... }), so accept either.
 */
export function parseKpForecast(data: unknown): KpEntry[] {
	if (!Array.isArray(data) || data.length === 0) return [];

	let rows: Array<{ time_tag: unknown; kp: unknown }>;
	if (Array.isArray(data[0])) {
		const header = (data[0] as unknown[]).map((h) => String(h).toLowerCase());
		const timeIdx = header.indexOf("time_tag");
		const kpIdx = header.indexOf("kp");
		if (timeIdx < 0 || kpIdx < 0) return [];
		rows = (data.slice(1) as unknown[][]).map((r) => ({
			time_tag: r[timeIdx],
			kp: r[kpIdx],
		}));
	} else {
		rows = data as Array<{ time_tag: unknown; kp: unknown }>;
	}

	const entries: KpEntry[] = [];
	for (const row of rows) {
		const time = parseSwpcTime(row?.time_tag);
		const kp = Number(row?.kp);
		if (time !== null && Number.isFinite(kp)) entries.push({ time, kp });
	}
	return entries;
}

/**
 * Highest Kp in any 3-hour slot overlapping [now, now + hours].
 * The slot already in progress counts, so "now" is never missed.
 */
export function maxKpInWindow(
	entries: KpEntry[],
	nowSec: number,
	hours = 24,
): number | null {
	const end = nowSec + hours * 3600;
	let max: number | null = null;
	for (const { time, kp } of entries) {
		const slotEnd = time + 3 * 3600;
		if (slotEnd > nowSec && time < end && (max === null || kp > max)) {
			max = kp;
		}
	}
	return max;
}

/** Kp at which aurora is plausible / likely from southern England. */
export const KP_POSSIBLE = 6;
export const KP_LIKELY = 7;

export function assessAurora(
	status: AuroraWatchStatus | null,
	kp: number | null,
): AuroraAlert | null {
	const likely = status === "red" || (kp !== null && kp >= KP_LIKELY);
	const possible =
		likely || status === "amber" || (kp !== null && kp >= KP_POSSIBLE);
	if (!possible) return null;

	const level: AuroraLevel = likely ? "likely" : "possible";
	return {
		level,
		kp,
		message: `Aurora ${level} tonight!`,
	};
}

/** "Kp 7" or "Kp 6.7" (NOAA forecasts use thirds, e.g. 6.67). */
export function formatKp(kp: number): string {
	const rounded = Math.round(kp * 10) / 10;
	return `Kp ${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}`;
}

const CACHE_MS = 15 * 60 * 1000;
let cache: { at: number; alert: AuroraAlert | null } | null = null;

/**
 * Current aurora alert, or null when there's nothing worth showing.
 * Never throws: if both sources fail the display just shows no alert.
 * Cached for 15 minutes per server instance, as AuroraWatch UK asks
 * clients not to poll more often than needed.
 */
export async function getAuroraAlert(
	now = new Date(),
): Promise<AuroraAlert | null> {
	if (cache && now.getTime() - cache.at < CACHE_MS) return cache.alert;

	const [statusResult, kpResult] = await Promise.allSettled([
		fetchWithTimeout(AURORAWATCH_URL, 5000).then(async (r) =>
			parseAuroraWatchStatus(await r.text()),
		),
		fetchWithTimeout(NOAA_KP_FORECAST_URL, 5000).then(async (r) =>
			maxKpInWindow(
				parseKpForecast(await r.json()),
				Math.floor(now.getTime() / 1000),
			),
		),
	]);

	if (statusResult.status === "rejected") {
		console.warn("AuroraWatch UK fetch failed:", statusResult.reason);
	}
	if (kpResult.status === "rejected") {
		console.warn("NOAA Kp forecast fetch failed:", kpResult.reason);
	}

	const status =
		statusResult.status === "fulfilled" ? statusResult.value : null;
	const kp = kpResult.status === "fulfilled" ? kpResult.value : null;
	const alert = assessAurora(status, kp);

	// Don't cache a total failure, so the next refresh tries again.
	if (statusResult.status === "fulfilled" || kpResult.status === "fulfilled") {
		cache = { at: now.getTime(), alert };
	}
	return alert;
}
