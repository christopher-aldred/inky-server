import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { registerManiaFont } from "../canvas";
import { loadWeatherIcons, NIGHT_ICON_TYPES, weatherIcons } from "../weather";
import { drawAlertBanner } from "./alert-banner";
import { drawGraph } from "./graph";
import { BIG_ICON, COLORS, DETAILS, HEADER, SCREEN } from "./layout";
import type { DetailRow, ScreenModel } from "./model";

/** Title (or alert banner) with the current temperature, plus the big icon. */
function drawHeader(ctx: SKRSContext2D, model: ScreenModel) {
	if (model.banner) {
		drawAlertBanner(
			ctx,
			model.banner.message,
			model.banner.style,
			model.currentTemp,
			SCREEN.width,
			SCREEN.margin,
		);
	} else {
		ctx.font = HEADER.font;
		ctx.textBaseline = "top";
		ctx.fillStyle = COLORS.black;
		ctx.fillText(model.title, SCREEN.margin, HEADER.titleY);
		ctx.fillStyle = COLORS.black;
		const w = ctx.measureText(model.currentTemp).width;
		ctx.fillText(
			model.currentTemp,
			SCREEN.width - SCREEN.margin - w,
			HEADER.titleY,
		);
	}

	const icon = weatherIcons[model.bigIcon];
	if (icon) {
		ctx.drawImage(icon, BIG_ICON.x, BIG_ICON.y, BIG_ICON.size, BIG_ICON.size);
	}
}

/** Two columns of "Label: value" rows. */
function drawDetails(ctx: SKRSContext2D, model: ScreenModel) {
	ctx.font = DETAILS.font;
	ctx.textBaseline = "top";
	const column = (rows: DetailRow[], x: number) => {
		rows.forEach((row, i) => {
			const y = DETAILS.rowY[i];
			ctx.fillStyle = COLORS.grey;
			ctx.fillText(row.label, x, y);
			ctx.fillStyle = row.highlight ? COLORS.red : COLORS.black;
			ctx.fillText(row.value, x + ctx.measureText(row.label).width, y);
		});
	};
	column(model.details.left, DETAILS.leftX);
	column(model.details.right, DETAILS.rightX);
}

/** Render the whole weather screen to a JPEG buffer. */
export async function renderWeatherScreen(model: ScreenModel): Promise<Buffer> {
	registerManiaFont();
	await loadWeatherIcons(NIGHT_ICON_TYPES);

	const canvas = createCanvas(SCREEN.width, SCREEN.height);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = COLORS.white;
	ctx.fillRect(0, 0, SCREEN.width, SCREEN.height);

	// Graph first: its night shading sits behind everything else
	drawGraph(ctx, model.graph);
	drawHeader(ctx, model);
	drawDetails(ctx, model);

	return canvas.toBuffer("image/jpeg");
}
