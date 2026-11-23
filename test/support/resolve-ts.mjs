export async function resolve(specifier, context, nextResolve) {
	try {
		return await nextResolve(specifier, context);
	} catch (error) {
		const relative = specifier.startsWith("./") || specifier.startsWith("../");
		if (!relative || /\.[cm]?[jt]s$/.test(specifier)) throw error;
		return nextResolve(`${specifier}.ts`, context);
	}
}
