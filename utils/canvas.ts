import { GlobalFonts } from "@napi-rs/canvas";
import path from "node:path";

/**
 * Register the Mania font for canvas rendering
 * This should be called once before using the font in canvas operations
 */
export function registerManiaFont(): void {
	const fontPath = path.join(process.cwd(), "public", "fonts", "mania.ttf");
	if (!GlobalFonts.has("Mania")) {
		GlobalFonts.registerFromPath(fontPath, "Mania");
	}
}
