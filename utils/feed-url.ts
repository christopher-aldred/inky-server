/**
 * Validation for calendar feed URLs passed in the query string.
 *
 * The API fetches whatever URL it is given, so only allow public http(s)
 * feeds. `webcal://` (what iCloud and Outlook hand out) is the same feed over
 * https.
 *
 * No runtime imports, so it can be unit tested with plain Node.
 */

function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host === "::1" || host === "::" || host.startsWith("fe80:")) return true;
	if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // IPv6 unique local

	const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!v4) return false;
	const [a, b] = [Number(v4[1]), Number(v4[2])];
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168)
	);
}

/** Returns a fetchable https/http URL, or throws if the URL isn't allowed. */
export function normalizeFeedUrl(raw: string): string {
	const trimmed = raw.trim().replace(/^webcals?:\/\//i, "https://");
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error("Calendar URL is not a valid URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`Calendar URL scheme ${url.protocol} is not allowed`);
	}
	if (isPrivateHost(url.hostname)) {
		throw new Error("Calendar URL points at a private address");
	}
	return url.toString();
}

/** Host only, for logs: feed paths often contain a private access token. */
export function describeFeedUrl(raw: string): string {
	try {
		const url = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
		return url.host || url.protocol;
	} catch {
		return "(invalid URL)";
	}
}
