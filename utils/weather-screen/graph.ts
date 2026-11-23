import type { SKRSContext2D } from "@napi-rs/canvas";
import { getCurvePoints, getTemperatureColor } from "../chart";
import { weatherIcons } from "../weather";
import { COLORS, GRAPH, SCREEN } from "./layout";
import { RAIN_CHANCE_WARNING, type ScreenModel } from "./model";

type Graph = ScreenModel["graph"];

/** Maps forecast times and temperatures to canvas coordinates. */
function makeScale(graph: Graph) {
	const t0 = graph.points[0]?.time ?? 0;
	const temps = graph.points.map((p) => p.temp);
	const min = Math.min(...temps);
	const max = Math.max(...temps);
	const range = max - min;
	const { lineTop, lineBottom } = GRAPH;

	return {
		x: (time: number) =>
			GRAPH.firstX + ((time - t0) / (GRAPH.stepHours * 3600)) * GRAPH.step,
		/** Clamped to the line band, so off-window points can't escape it. */
		y: (temp: number) => {
			if (range === 0) return (lineTop + lineBottom) / 2;
			const y = lineTop + (lineBottom - lineTop) * (1 - (temp - min) / range);
			return Math.max(lineTop, Math.min(lineBottom, y));
		},
	};
}

/** The dot lattice: columns at firstX ± k·spacing, rows at axisY − k·spacing. */
const lattice = {
	snapX: (x: number) =>
		GRAPH.firstX +
		Math.ceil((x - GRAPH.firstX) / GRAPH.dotSpacing) * GRAPH.dotSpacing,
	/** Top-left of a clear box of size w×h nearest (cx, cy), with its edges
	 * halfway between dot columns/rows so the gap to the dots is even. */
	boxOrigin: (cx: number, cy: number, w: number, h: number) => {
		const s = GRAPH.dotSpacing;
		const half = GRAPH.dotSize / 2;
		return {
			x:
				GRAPH.firstX +
				Math.round((cx - w / 2 - half - GRAPH.firstX) / s) * s +
				half,
			y:
				GRAPH.axisY +
				Math.round((cy - h / 2 - half - GRAPH.axisY) / s) * s +
				half,
		};
	},
	/** First box edge (just past a dot column) at or right of x. */
	edgeAtOrAfterX: (x: number) => {
		const half = GRAPH.dotSize / 2;
		const s = GRAPH.dotSpacing;
		return GRAPH.firstX + Math.ceil((x - half - GRAPH.firstX) / s) * s + half;
	},
	/** First box edge (just below a dot row) at or below y. */
	edgeAtOrAfterY: (y: number) => {
		const half = GRAPH.dotSize / 2;
		const s = GRAPH.dotSpacing;
		return GRAPH.axisY + Math.ceil((y - half - GRAPH.axisY) / s) * s + half;
	},
	/** Size that fits `len` plus padding and spans whole lattice cells. */
	fit: (len: number, pad: number) =>
		Math.ceil((len + pad * 2 + GRAPH.dotSize) / GRAPH.dotSpacing) *
			GRAPH.dotSpacing -
		GRAPH.dotSize,
};

/** 4×4 ordered-dither thresholds (0–15), so a fade thins dots evenly. */
const BAYER_4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
] as const;

/**
 * How dense the night dots are at `px` (0 = none, 1 = full) inside a night
 * spanning [fromPx, toPx]: they build up over `fadePx` after sunset and thin
 * out over `fadePx` before sunrise. Open ends (±Infinity) don't fade.
 */
export function nightDotDensity(
	px: number,
	fromPx: number,
	toPx: number,
	fadePx: number,
): number {
	if (px < fromPx || px > toPx) return 0;
	if (fadePx <= 0) return 1;
	return Math.min(1, (px - fromPx) / fadePx, (toPx - px) / fadePx);
}

/** Whether the dot at lattice column/row `col`,`row` shows at `density`. */
export function ditherDotOn(col: number, row: number, density: number): boolean {
	const threshold = BAYER_4[((row % 4) + 4) % 4][((col % 4) + 4) % 4];
	return density * 16 > threshold;
}

function drawNightShading(
	ctx: SKRSContext2D,
	graph: Graph,
	x: (t: number) => number,
) {
	const { dotSpacing: s, dotSize, shadeTop, axisY } = GRAPH;
	const fadePx = (GRAPH.nightFadeHours / GRAPH.stepHours) * GRAPH.step;
	ctx.fillStyle = COLORS.dots;
	for (const [start, end] of graph.nights) {
		const nightFrom = x(start);
		const nightTo = x(end);
		const from = Math.max(0, nightFrom);
		const to = Math.min(SCREEN.width, nightTo);
		if (to <= from) continue;
		for (let dx = lattice.snapX(from); dx <= to; dx += s) {
			const density = nightDotDensity(dx, nightFrom, nightTo, fadePx);
			const col = Math.round((dx - GRAPH.firstX) / s);
			for (let dy = axisY - s; dy >= shadeTop; dy -= s) {
				const row = Math.round((axisY - dy) / s);
				if (!ditherDotOn(col, row, density)) continue;
				ctx.fillRect(dx - dotSize / 2, dy - dotSize / 2, dotSize, dotSize);
			}
		}
	}
}

function drawMidnightDividers(
	ctx: SKRSContext2D,
	graph: Graph,
	x: (t: number) => number,
) {
	for (const { time, label } of graph.midnights) {
		const mx = x(time);
		if (mx < 0 || mx > SCREEN.width) continue;

		ctx.strokeStyle = COLORS.black;
		ctx.lineWidth = 2;
		ctx.setLineDash([6, 6]);
		ctx.beginPath();
		ctx.moveTo(mx, GRAPH.shadeTop);
		ctx.lineTo(mx, GRAPH.iconY - 4); // stop above the icons
		ctx.stroke();
		ctx.setLineDash([]);

		// Day label just right of the divider, at the top of the shading
		drawLatticeLabel(ctx, label, COLORS.black, () => ({
			x: lattice.edgeAtOrAfterX(mx + 2),
			y: lattice.edgeAtOrAfterY(GRAPH.shadeTop),
		}));
	}
}

/** Full-width rule at `y`, e.g. the x axis or the top edge of the graph. */
function drawRule(ctx: SKRSContext2D, y: number) {
	ctx.strokeStyle = COLORS.black;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(0, y);
	ctx.lineTo(SCREEN.width, y);
	ctx.stroke();
}

/** Smoothed temperature line, coloured by temperature band, edge to edge. */
function drawTemperatureLine(
	ctx: SKRSContext2D,
	graph: Graph,
	scale: ReturnType<typeof makeScale>,
) {
	const { points } = graph;
	const first = points[0];
	const last = points[points.length - 1];
	const stepSeconds = GRAPH.stepHours * 3600;
	// Real forecast beyond each end where we have it, otherwise flat.
	const before = graph.before ?? {
		time: first.time - stepSeconds,
		temp: first.temp,
	};
	const after = graph.after ?? {
		time: last.time + stepSeconds,
		temp: last.temp,
	};

	const nodes = [before, ...points, after].map(
		(p) =>
			[scale.x(p.time), scale.y(p.temp), p.temp] as [number, number, number],
	);
	const curve = getCurvePoints(nodes).map(
		([x, y, t]) =>
			[x, Math.max(GRAPH.lineTop, Math.min(GRAPH.lineBottom, y)), t] as const,
	);

	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, SCREEN.width, SCREEN.height);
	ctx.clip();
	ctx.lineWidth = GRAPH.lineWidth;
	ctx.lineCap = "round";
	for (let i = 0; i < curve.length - 1; i++) {
		const [x0, y0, t] = curve[i];
		const [x1, y1] = curve[i + 1];
		ctx.strokeStyle = getTemperatureColor(t);
		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.lineTo(x1, y1);
		ctx.stroke();
	}
	ctx.restore();
}

/**
 * Text on a white box whose edges sit halfway between dot columns/rows, so
 * the gap from the text to the surrounding dots is even on every side.
 * `place` picks the box's top-left from its size.
 */
function drawLatticeLabel(
	ctx: SKRSContext2D,
	text: string,
	color: string,
	place: (w: number, h: number) => { x: number; y: number },
	font: string = GRAPH.labelFont,
) {
	ctx.font = font;
	ctx.textBaseline = "alphabetic";
	const m = ctx.measureText(text);
	const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
	const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
	const w = lattice.fit(inkW, 4);
	const h = lattice.fit(inkH, 4);
	const box = place(w, h);

	ctx.fillStyle = COLORS.white;
	ctx.fillRect(box.x, box.y, w, h);
	ctx.fillStyle = color;
	ctx.fillText(
		text,
		Math.round(box.x + (w - inkW) / 2 + m.actualBoundingBoxLeft),
		Math.round(box.y + (h - inkH) / 2 + m.actualBoundingBoxAscent),
	);
}

function drawPointLabels(
	ctx: SKRSContext2D,
	graph: Graph,
	scale: ReturnType<typeof makeScale>,
) {
	const centred = (text: string, x: number, y: number) =>
		ctx.fillText(text, x - ctx.measureText(text).width / 2, y);

	graph.points.forEach((point, i) => {
		const x = scale.x(point.time);

		const icon = weatherIcons[point.icon];
		if (icon) {
			const size = GRAPH.smallIcon;
			ctx.drawImage(icon, x - size / 2, GRAPH.iconY, size, size);
		}

		ctx.font = GRAPH.labelFont;
		ctx.textBaseline = "top";
		ctx.fillStyle = COLORS.black;
		centred(point.hourLabel, x, GRAPH.timeLabelY);

		ctx.fillStyle =
			point.rainChance >= RAIN_CHANCE_WARNING ? COLORS.red : COLORS.grey;
		centred(`${point.rainChance}%`, x, GRAPH.rainLabelY);

		if (i === graph.highIndex || i === graph.lowIndex) {
			const cy = scale.y(point.temp) - 26;
			drawLatticeLabel(
				ctx,
				`${Math.round(point.temp)}°C`,
				COLORS.black,
				(w, h) => lattice.boxOrigin(x, cy, w, h),
				GRAPH.highLowFont,
			);
		}
	});
}

/** Bottom half: night shading, day divider, temperature line, icons, labels. */
export function drawGraph(ctx: SKRSContext2D, graph: Graph) {
	if (graph.points.length === 0) return;
	const scale = makeScale(graph);
	drawNightShading(ctx, graph, scale.x);
	drawMidnightDividers(ctx, graph, scale.x);
	drawRule(ctx, GRAPH.axisY);
	drawTemperatureLine(ctx, graph, scale);
	drawPointLabels(ctx, graph, scale);
	// Last, so no label box can cover it
	drawRule(ctx, GRAPH.topRuleY);
}
