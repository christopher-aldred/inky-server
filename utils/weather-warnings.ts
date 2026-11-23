/**
 * Met Office National Severe Weather Warnings, from the free keyless RSS
 * feed for one region (default "se" = London & South East England).
 * https://www.metoffice.gov.uk/weather/guides/rss
 *
 * Only amber and red warnings are shown; yellow ones are ignored.
 * The feed is regional, so a warning for part of the region (e.g. Kent)
 * shows too.
 */

export const DEFAULT_WARNING_REGION = "se";

export function warningsFeedUrl(region = DEFAULT_WARNING_REGION): string {
	return `https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/${region}`;
}

export type WarningLevel = "yellow" | "amber" | "red";

export interface WeatherWarning {
	level: WarningLevel;
	/** e.g. "Wind", "Wind & rain", "Snow & ice" */
	type: string;
}

const LEVEL_RANK: Record<WarningLevel, number> = {
	yellow: 1,
	amber: 2,
	red: 3,
};

function decodeEntities(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'");
}

/** "wind, rain" → "Wind & rain"; "snow, ice" → "Snow & ice". */
export function formatWarningType(raw: string): string {
	const parts = raw
		.split(/\s*(?:,|\band\b)\s*/i)
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean);
	const joined = parts.join(" & ");
	return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Parse item titles like "Amber warning of wind, rain affecting London & South East England". */
export function parseWarningsRss(xml: string): WeatherWarning[] {
	const warnings: WeatherWarning[] = [];
	for (const item of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
		const title = /<title>([\s\S]*?)<\/title>/i.exec(item[0])?.[1];
		if (!title) continue;
		const m =
			/(yellow|amber|red)\s+warning\s+of\s+(.+?)(?:\s+affecting\b|$)/i.exec(
				decodeEntities(title).trim(),
			);
		if (!m) continue;
		warnings.push({
			level: m[1].toLowerCase() as WarningLevel,
			type: formatWarningType(m[2]),
		});
	}
	return warnings;
}

/** The most severe amber/red warning, or null. Yellow is ignored. */
export function pickDisplayWarning(
	warnings: WeatherWarning[],
): WeatherWarning | null {
	let best: WeatherWarning | null = null;
	for (const w of warnings) {
		if (LEVEL_RANK[w.level] < LEVEL_RANK.amber) continue;
		if (!best || LEVEL_RANK[w.level] > LEVEL_RANK[best.level]) best = w;
	}
	return best;
}

/** "RED warning: Wind" / "Amber warning: Rain" (RED in caps to stand out). */
export function formatWarningMessage(w: WeatherWarning): string {
	const label = w.level === "red" ? "RED" : "Amber";
	return `${label} warning: ${w.type}`;
}

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; warning: WeatherWarning | null }>();

/**
 * Most severe current amber/red warning for the region, or null.
 * Never throws: a failed fetch just means no banner.
 */
export async function getWeatherWarning(
	region = DEFAULT_WARNING_REGION,
	now = Date.now(),
): Promise<WeatherWarning | null> {
	const hit = cache.get(region);
	if (hit && now - hit.at < CACHE_MS) return hit.warning;

	try {
		const res = await fetch(warningsFeedUrl(region), {
			signal: AbortSignal.timeout(5000),
			headers: { "User-Agent": "inky-server (e-ink display)" },
		});
		if (!res.ok) throw new Error(`Met Office feed returned ${res.status}`);
		const warning = pickDisplayWarning(parseWarningsRss(await res.text()));
		cache.set(region, { at: now, warning });
		return warning;
	} catch (error) {
		console.warn("Met Office warnings fetch failed:", error);
		return null;
	}
}
