/** GET a URL with a timeout and a generic User-Agent; throws on non-2xx. */
export async function fetchWithTimeout(
	url: string,
	timeoutMs = 5000,
): Promise<Response> {
	const res = await fetch(url, {
		signal: AbortSignal.timeout(timeoutMs),
		headers: { "User-Agent": "inky-server (e-ink display)" },
	});
	if (!res.ok) throw new Error(`${url} returned ${res.status}`);
	return res;
}
