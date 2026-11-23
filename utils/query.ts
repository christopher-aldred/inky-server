/** Helpers for Next.js query values, which can be a string, an array or absent. */

/** First non-empty value of a query parameter, or undefined. */
export function firstQueryValue(
	value: string | string[] | undefined,
): string | undefined {
	return queryValues(value)[0];
}

/** All non-empty values of a query parameter. */
export function queryValues(value: string | string[] | undefined): string[] {
	const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
	return list.map((v) => v.trim()).filter((v) => v.length > 0);
}
