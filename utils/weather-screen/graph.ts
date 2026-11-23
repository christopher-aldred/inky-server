import { type Canvas, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { getCurvePoints, getTemperatureColor } from "../chart";
import { type IconImage, weatherIcons } from "../weather";
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
	/** Left edge for a label just right of a 2px line at x, leaving a dot
	 * column between them so the box's rounded corners show. */
	edgeRightOfLine: (x: number) => lattice.edgeAtOrAfterX(x + 1 + GRAPH.dotSize),
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
export function ditherDotOn(
	col: number,
	row: number,
	density: number,
): boolean {
	const threshold = BAYER_4[((row % 4) + 4) % 4][((col % 4) + 4) % 4];
	return density * 16 > threshold;
}

/**
 * Dot layer for the nights: `fadeHours` sets how long the dots take to build
 * up after sunset and thin out before sunrise; `offset` shifts the whole
 * layer (used to slot the deep-night layer between the black dots).
 */
function drawNightDots(
	ctx: SKRSContext2D,
	graph: Graph,
	x: (t: number) => number,
	color: string,
	fadeHours: number,
	offset: number,
	skip: (x: number, y: number) => boolean,
) {
	const { dotSpacing: s, dotSize, shadeTop, axisY } = GRAPH;
	const fadePx = (fadeHours / GRAPH.stepHours) * GRAPH.step;
	ctx.fillStyle = color;
	for (const [start, end] of graph.nights) {
		const nightFrom = x(start);
		const nightTo = x(end);
		const from = Math.max(0, nightFrom);
		const to = Math.min(SCREEN.width, nightTo);
		if (to <= from) continue;
		for (let dx = lattice.snapX(from) + offset; dx <= to; dx += s) {
			const density = nightDotDensity(dx, nightFrom, nightTo, fadePx);
			const col = Math.round((dx - offset - GRAPH.firstX) / s);
			// Lowest row that clears the axis line: the offset layer has one
			// between the black layer's last row and the axis.
			const firstY = offset > 0 ? axisY - offset : axisY - s;
			for (let dy = firstY; dy >= shadeTop; dy -= s) {
				const row = Math.round((axisY - offset - dy) / s);
				if (!ditherDotOn(col, row, density) || skip(dx, dy)) continue;
				ctx.fillRect(dx - dotSize / 2, dy - dotSize / 2, dotSize, dotSize);
			}
		}
	}
}

/**
 * Black dots for the whole night, plus a second black layer filling in the
 * middle. Dots inside a star are left out, so each star is a gap in the dots.
 */
function drawNightShading(
	ctx: SKRSContext2D,
	graph: Graph,
	x: (t: number) => number,
	stars: { x: number; y: number }[],
) {
	const skip = (px: number, py: number) =>
		stars.some((st) => insideStar(px - st.x, py - st.y));
	drawNightDots(ctx, graph, x, COLORS.dots, GRAPH.nightFadeHours, 0, skip);
	drawNightDots(
		ctx,
		graph,
		x,
		COLORS.deepNightDots,
		GRAPH.deepNightFadeHours,
		GRAPH.dotSpacing / 2,
		skip,
	);
}

/**
 * Whether offset (dx, dy) from a star's centre falls inside it: two thin
 * diamonds crossed, so a four-point twinkle whose arms taper from `waist`
 * wide at the middle to a point at `radius`. Dots inside are left out.
 */
export function insideStar(dx: number, dy: number): boolean {
	const { radius: r, waist: w } = GRAPH.stars;
	const ax = Math.abs(dx);
	const ay = Math.abs(dy);
	return ax <= w * (1 - ay / r) || ay <= w * (1 - ax / r);
}

function drawMidnightDividers(
	ctx: SKRSContext2D,
	graph: Graph,
	x: (t: number) => number,
) {
	const iconXs = graph.points.map((p) => x(p.time));
	for (const { time, label } of graph.midnights) {
		const mx = x(time);
		if (mx < 0 || mx > SCREEN.width) continue;

		// Run to the bottom of the shading, unless an icon sits in the way
		const hitsIcon = iconXs.some(
			(ix) => Math.abs(ix - mx) < GRAPH.smallIcon / 2 + 4,
		);
		const bottom = hitsIcon ? GRAPH.iconY - 4 : GRAPH.axisY;

		ctx.strokeStyle = COLORS.black;
		ctx.lineWidth = 2;
		ctx.setLineDash([6, 6]);
		ctx.beginPath();
		ctx.moveTo(mx, GRAPH.shadeTop);
		ctx.lineTo(mx, bottom);
		ctx.stroke();
		ctx.setLineDash([]);

		// Day label just right of the divider, at the top of the shading
		drawLatticeLabel(ctx, label, COLORS.black, () => ({
			x: lattice.edgeRightOfLine(mx),
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

/** The smoothed temperature line as [x, y, temp] points, edge to edge. */
function temperatureCurve(graph: Graph, scale: ReturnType<typeof makeScale>) {
	const { points } = graph;
	const first = points[0];
	const last = points[points.length - 1];
	const stepSeconds = GRAPH.stepHours * 3600;
	// Real forecast beyond each end where we have it, otherwise flat.
	const before = graph.before ?? {
		time: first.time - stepSeconds,
		temp: first.temp,
		humidity: first.humidity,
	};
	const after = graph.after ?? {
		time: last.time + stepSeconds,
		temp: last.temp,
		humidity: last.humidity,
	};

	const nodes = [before, ...points, after].map(
		(p) =>
			[scale.x(p.time), scale.y(p.temp), p.temp] as [number, number, number],
	);
	return getCurvePoints(nodes).map(
		([x, y, t]) =>
			[x, Math.max(GRAPH.lineTop, Math.min(GRAPH.lineBottom, y)), t] as const,
	);
}

/** Smoothed temperature line, coloured by temperature band, edge to edge. */
function drawTemperatureLine(
	ctx: SKRSContext2D,
	graph: Graph,
	scale: ReturnType<typeof makeScale>,
) {
	const curve = temperatureCurve(graph, scale);

	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, SCREEN.width, SCREEN.height);
	ctx.clip();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	// White outline first, so the line stands out on the dark night dots
	ctx.lineWidth = GRAPH.lineWidth + 2 * GRAPH.lineOutline;
	ctx.strokeStyle = COLORS.white;
	ctx.beginPath();
	curve.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
	ctx.stroke();
	ctx.lineWidth = GRAPH.lineWidth;
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

/** Humidity as a thin line: 0% at the bottom of the line area, 100% at the top. */
function drawHumidityLine(
	ctx: SKRSContext2D,
	graph: Graph,
	scale: ReturnType<typeof makeScale>,
) {
	const style = GRAPH.humidity;
	const first = graph.points[0];
	const last = graph.points[graph.points.length - 1];
	const step = GRAPH.stepHours * 3600;
	const before = graph.before ?? { time: first.time - step, humidity: first.humidity };
	const after = graph.after ?? { time: last.time + step, humidity: last.humidity };
	const y = (h: number) =>
		GRAPH.lineBottom - (h / 100) * (GRAPH.lineBottom - GRAPH.lineTop);
	const nodes = [before, ...graph.points, after].map(
		(p) => [scale.x(p.time), y(p.humidity), p.humidity] as [number, number, number],
	);
	const curve = getCurvePoints(nodes);
	const path = () => {
		ctx.beginPath();
		curve.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
	};

	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, SCREEN.width, SCREEN.height);
	ctx.clip();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.setLineDash(style.dash);
	ctx.lineWidth = style.width + 2 * style.outline;
	ctx.strokeStyle = COLORS.white;
	path();
	ctx.stroke();
	ctx.lineWidth = style.width;
	ctx.strokeStyle = style.color;
	path();
	ctx.stroke();
	ctx.restore();

	// Label the line at its right-hand end
	const lx = SCREEN.width - 8;
	const ly = y(last.humidity);
	drawLatticeLabel(ctx, style.label, style.color, (w, h) =>
		lattice.boxOrigin(lx - w / 2, ly - h / 2 - 22, w, h),
	);
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
	ctx.beginPath();
	ctx.roundRect(box.x, box.y, w, h, GRAPH.labelRadius);
	ctx.fill();
	ctx.fillStyle = color;
	ctx.fillText(
		text,
		Math.round(box.x + (w - inkW) / 2 + m.actualBoundingBoxLeft),
		Math.round(box.y + (h - inkH) / 2 + m.actualBoundingBoxAscent),
	);
}

/** Every graph icon gets a white edge, so it stands out from the night
 * dots. */
const halos = new Map<string, Canvas>();

/** White silhouette of an icon, grown by GRAPH.iconHalo px all round. */
function iconHalo(name: string, icon: IconImage, size: number): Canvas {
	const key = `${name}@${size}`;
	const cached = halos.get(key);
	if (cached) return cached;
	const pad = GRAPH.iconHalo;
	const canvas = createCanvas(size + pad * 2, size + pad * 2);
	const hctx = canvas.getContext("2d");
	for (let dx = -pad; dx <= pad; dx++) {
		for (let dy = -pad; dy <= pad; dy++) {
			if (dx * dx + dy * dy > pad * pad) continue;
			hctx.drawImage(icon, pad + dx, pad + dy, size, size);
		}
	}
	hctx.globalCompositeOperation = "source-in";
	hctx.fillStyle = COLORS.white;
	hctx.fillRect(0, 0, canvas.width, canvas.height);
	halos.set(key, canvas);
	return canvas;
}

function drawPointLabels(
	ctx: SKRSContext2D,
	graph: Graph,
	scale: ReturnType<typeof makeScale>,
) {
	// Centre on the ink, not the advance width, so labels line up with icons
	const centred = (text: string, x: number, y: number) => {
		const m = ctx.measureText(text);
		const inkLeft = -m.actualBoundingBoxLeft;
		const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
		ctx.fillText(text, Math.round(x - inkW / 2 - inkLeft), y);
	};

	graph.points.forEach((point, i) => {
		const x = scale.x(point.time);

		const icon = weatherIcons[point.icon];
		if (icon) {
			const size = GRAPH.smallIcon;
			const halo = iconHalo(point.icon, icon, size);
			const pad = GRAPH.iconHalo;
			ctx.drawImage(halo, x - size / 2 - pad, GRAPH.iconY - pad);
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

type Rect = { x: number; y: number; w: number; h: number };

/** Small deterministic hash → [0, 1), so stars don't move between refreshes. */
function hash01(n: number): number {
	let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 2 ** 32;
}

/**
 * Where the night stars go: spread through the darkest part of each night
 * (where the deep-night dots are dense), kept clear of the temperature line
 * and of `avoid` boxes such as labels. Positions only depend on the night and
 * the line, so they stay put between refreshes.
 */
export function starPositions(
	nights: [number, number][],
	lineY: (x: number) => number,
	avoid: Rect[],
): { x: number; y: number }[] {
	const { every, extra, minGap, minDensity, clearance, radius } = GRAPH.stars;
	const deepFadePx = (GRAPH.deepNightFadeHours / GRAPH.stepHours) * GRAPH.step;
	const top = GRAPH.shadeTop + radius + 6;
	const bottom = GRAPH.iconY - radius - 6;
	const clear = (x: number, y: number) =>
		Math.abs(lineY(x) - y) > clearance + GRAPH.lineWidth / 2 + radius &&
		avoid.every(
			(r) =>
				x < r.x - clearance ||
				x > r.x + r.w + clearance ||
				y < r.y - clearance ||
				y > r.y + r.h + clearance,
		);

	const stars: { x: number; y: number }[] = [];
	for (const [nightFrom, nightTo] of nights) {
		const from = Math.max(radius + 4, nightFrom + minDensity * deepFadePx);
		const to = Math.min(
			SCREEN.width - radius - 4,
			nightTo - minDensity * deepFadePx,
		);
		if (to - from < every / 2) continue;
		const count = Math.max(1, Math.round((to - from) / every));
		const slot = (to - from) / count;
		for (let i = 0; i < count; i++) {
			// Seed from the slot's place on screen so the pattern is stable
			const seed = Math.round(from / slot) + i;
			const x = Math.round(from + slot * (i + 0.3 + 0.4 * hash01(seed)));
			// Try a few heights; take the first clear one
			for (let k = 0; k < 6; k++) {
				const y = Math.round(top + (bottom - top) * hash01(seed * 7 + k + 1));
				const crowded = stars.some(
					(st) => Math.hypot(st.x - x, st.y - y) < minGap,
				);
				if (clear(x, y) && !crowded) {
					stars.push({ x, y });
					break;
				}
			}
		}
		// A few extra stars anywhere in the dark part that has room
		const seed0 = Math.round(from / slot) * 131;
		for (let added = 0, k = 0; added < extra && k < 60; k++) {
			const x = Math.round(from + (to - from) * hash01(seed0 + 2 * k));
			const y = Math.round(top + (bottom - top) * hash01(seed0 + 2 * k + 1));
			const crowded = stars.some(
				(st) => Math.hypot(st.x - x, st.y - y) < minGap,
			);
			if (clear(x, y) && !crowded) {
				stars.push({ x, y });
				added++;
			}
		}
	}
	return stars;
}

function nightStars(graph: Graph, scale: ReturnType<typeof makeScale>) {
	const curve = temperatureCurve(graph, scale);
	const lineY = (x: number) => {
		let best = curve[0];
		for (const p of curve)
			if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
		return best[1];
	};
	const avoid: Rect[] = labelBoxes(graph, scale);
	for (const { time } of graph.midnights) {
		avoid.push({
			x: scale.x(time) - 1,
			y: GRAPH.shadeTop,
			w: 2,
			h: GRAPH.axisY,
		});
	}
	// The now line and its label, whichever side that lands
	const nx = scale.x(graph.now);
	avoid.push({ x: nx - 60, y: GRAPH.shadeTop, w: 120, h: 60 });
	avoid.push({ x: nx - 2, y: GRAPH.shadeTop, w: 4, h: GRAPH.axisY });
	const nights = graph.nights.map(
		([a, b]) => [scale.x(a), scale.x(b)] as [number, number],
	);
	// Centre each star on a dot so its arms run along a dot row and column
	const s = GRAPH.dotSpacing;
	return starPositions(nights, lineY, avoid).map(({ x, y }) => ({
		x: GRAPH.firstX + Math.round((x - GRAPH.firstX) / s) * s,
		y: GRAPH.axisY - Math.round((GRAPH.axisY - y) / s) * s,
	}));
}

/** Boxes that the "Now" label and stars keep clear of: each midnight's
 * divider and weekday label, and the high/low labels. */
function labelBoxes(graph: Graph, scale: ReturnType<typeof makeScale>): Rect[] {
	const boxes: Rect[] = [];
	for (const { time } of graph.midnights) {
		const mx = scale.x(time);
		boxes.push({ x: mx - 2, y: GRAPH.shadeTop, w: 62, h: 30 });
	}
	graph.points.forEach((p, i) => {
		if (i !== graph.highIndex && i !== graph.lowIndex) return;
		const cy = scale.y(p.temp) - 26;
		boxes.push({ x: scale.x(p.time) - 36, y: cy - 18, w: 72, h: 36 });
	});
	return boxes;
}

const overlaps = (a: Rect, b: Rect) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Line at the current time, styled like the midnight divider and stopping
 * short of any icon in the same way. Its "Now" label sits to the right like
 * the weekday labels; if that would hit a weekday label, a high/low label or
 * the screen edge it goes left, then a row lower.
 */
function drawNowLine(
	ctx: SKRSContext2D,
	graph: Graph,
	scale: ReturnType<typeof makeScale>,
) {
	const nx = Math.round(scale.x(graph.now));
	if (nx < 0 || nx > SCREEN.width) return;
	const hitsIcon = graph.points.some(
		(p) => Math.abs(scale.x(p.time) - nx) < GRAPH.smallIcon / 2 + 4,
	);
	const bottom = hitsIcon ? GRAPH.iconY - 4 : GRAPH.axisY;
	// Same look as the midnight divider: dashed black line, black label
	const top = GRAPH.shadeTop;
	ctx.strokeStyle = COLORS.black;
	ctx.lineWidth = 2;
	ctx.setLineDash([6, 6]);
	ctx.beginPath();
	ctx.moveTo(nx, top);
	ctx.lineTo(nx, bottom);
	ctx.stroke();
	ctx.setLineDash([]);

	const avoid = labelBoxes(graph, scale);
	drawLatticeLabel(ctx, "Now", COLORS.black, (bw, bh) => {
		let leftX = lattice.edgeAtOrAfterX(nx - 2 - bw - GRAPH.dotSpacing);
		while (leftX + bw > nx - 1 - GRAPH.dotSize) leftX -= GRAPH.dotSpacing;
		const rightX = lattice.edgeRightOfLine(nx);
		const y1 = lattice.edgeAtOrAfterY(top);
		// A row lower, for when a weekday label is right beside the line
		const y2 = lattice.edgeAtOrAfterY(y1 + bh + 2);
		const candidates = [
			{ x: rightX, y: y1 },
			{ x: leftX, y: y1 },
			{ x: rightX, y: y2 },
			{ x: leftX, y: y2 },
		].map((c) => ({ ...c, w: bw, h: bh }));
		const fits = (r: Rect) =>
			r.x >= 0 &&
			r.x + r.w <= SCREEN.width &&
			!avoid.some((a) => overlaps(r, a));
		return candidates.find(fits) ?? candidates[0];
	});
}

/** Red dot on the temperature line at the current time. */
function drawNowDot(
	ctx: SKRSContext2D,
	graph: Graph,
	scale: ReturnType<typeof makeScale>,
) {
	const nx = scale.x(graph.now);
	if (nx < 0 || nx > SCREEN.width) return;
	const curve = temperatureCurve(graph, scale);
	let best = curve[0];
	for (const p of curve)
		if (Math.abs(p[0] - nx) < Math.abs(best[0] - nx)) best = p;
	const r = GRAPH.nowDotRadius;
	ctx.beginPath();
	ctx.arc(nx, best[1], r + 3, 0, Math.PI * 2);
	ctx.fillStyle = COLORS.white;
	ctx.fill();
	ctx.beginPath();
	ctx.arc(nx, best[1], r, 0, Math.PI * 2);
	ctx.fillStyle = COLORS.red;
	ctx.fill();
}

/** Bottom half: night shading, day divider, temperature line, icons, labels. */
export function drawGraph(ctx: SKRSContext2D, graph: Graph) {
	if (graph.points.length === 0) return;
	const scale = makeScale(graph);
	drawNightShading(ctx, graph, scale.x, nightStars(graph, scale));
	drawMidnightDividers(ctx, graph, scale.x);
	drawNowLine(ctx, graph, scale);
	drawRule(ctx, GRAPH.axisY);
	if (GRAPH.humidity.show) drawHumidityLine(ctx, graph, scale);
	drawTemperatureLine(ctx, graph, scale);
	drawNowDot(ctx, graph, scale);
	drawPointLabels(ctx, graph, scale);
	// Last, so no label box can cover it
	drawRule(ctx, GRAPH.topRuleY);
}
