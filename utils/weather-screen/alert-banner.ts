import type { SKRSContext2D } from "@napi-rs/canvas";

export const ALERT_BANNER_HEIGHT = 62;

/**
 * "solid": red bar, white text (red weather warning, aurora alert).
 * "outline": white bar with a thick red border, red text (amber warning).
 * The display is red/black/white only, so amber can't be shown as amber.
 */
export type AlertBannerStyle = "solid" | "outline";

/**
 * Header bar drawn in place of the weather title row while an alert is
 * active: message on the left, current temperature on the right.
 *
 * Text is placed so the capital letters are exactly centred in the bar
 * (measured ink of "H", not the font's em box, which Mania pads unevenly).
 * Descenders (y, g) hang below; Chris picked this over centring the full ink.
 */
export function drawAlertBanner(
	ctx: SKRSContext2D,
	message: string,
	style: AlertBannerStyle,
	currentTemp: string,
	width: number,
	padding = 20,
): void {
	const height = ALERT_BANNER_HEIGHT;
	const border = 5;
	ctx.save();

	if (style === "solid") {
		ctx.fillStyle = "#FF0000";
		ctx.fillRect(0, 0, width, height);
		ctx.fillStyle = "#FFFFFF";
	} else {
		ctx.fillStyle = "#FF0000";
		ctx.fillRect(0, 0, width, height);
		ctx.fillStyle = "#FFFFFF";
		ctx.fillRect(border, border, width - border * 2, height - border * 2);
		ctx.fillStyle = "#FF0000";
	}

	ctx.textBaseline = "alphabetic";

	// Shrink long messages so they never run into the temperature.
	ctx.font = "42px Mania";
	const tempWidth = ctx.measureText(currentTemp).width;
	const maxMessageWidth = width - tempWidth - padding * 3;
	let fontSize = 42;
	ctx.font = `${fontSize}px Mania`;
	while (fontSize > 24 && ctx.measureText(message).width > maxMessageWidth) {
		fontSize -= 2;
		ctx.font = `${fontSize}px Mania`;
	}

	const capHeight = ctx.measureText("H").actualBoundingBoxAscent;
	const baseline = Math.round((height + capHeight) / 2);

	ctx.fillText(message, padding, baseline);
	if (fontSize !== 42) ctx.font = "42px Mania";
	const tempBaseline = Math.round(
		(height + ctx.measureText("H").actualBoundingBoxAscent) / 2,
	);
	ctx.fillText(currentTemp, width - padding - tempWidth, tempBaseline);

	ctx.restore();
}
