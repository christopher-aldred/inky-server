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
 * Text is centred on the measured ink of the message (not the font's em box,
 * which Mania pads unevenly), so it sits in the middle of the bar.
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

	ctx.font = "42px Mania";
	ctx.textBaseline = "alphabetic";

	const m = ctx.measureText(message);
	const baseline = Math.round(
		(height + m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
	);

	ctx.fillText(message, padding, baseline);
	const tempWidth = ctx.measureText(currentTemp).width;
	ctx.fillText(currentTemp, width - padding - tempWidth, baseline);

	ctx.restore();
}
