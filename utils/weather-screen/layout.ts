/**
 * Fixed positions for the 800×480 weather screen. All y values are for
 * textBaseline "top" unless noted.
 */

export const SCREEN = { width: 800, height: 480, margin: 20 } as const;

export const COLORS = {
	red: "#FF0000",
	black: "#000000",
	white: "#FFFFFF",
	grey: "#666666",
} as const;

export const HEADER = {
	titleY: 15,
	font: "42px Mania",
} as const;

/** Big current-conditions icon: spans the cap top of the first detail row to
 * the baseline of the third. */
export const BIG_ICON = { x: 684, y: 68, size: 96 } as const;

export const DETAILS = {
	font: "32px Mania",
	rowY: [72, 108, 144],
	leftX: 20,
	rightX: 345,
} as const;

const AXIS_Y = 412;
const SMALL_ICON = 40;
const FIRST_X = 40;
const POINT_COUNT = 8;

export const GRAPH = {
	pointCount: POINT_COUNT,
	stepHours: 3,
	/** The first graph point is this many hours before the current hour (0: the
	 * graph starts at the current hour, per Chris). */
	pastHours: 0,
	/** x of the first and last forecast points. */
	firstX: FIRST_X,
	lastX: SCREEN.width - FIRST_X,
	step: (SCREEN.width - 2 * FIRST_X) / (POINT_COUNT - 1),
	axisY: AXIS_Y,
	/** Night shading starts just below the detail rows. */
	shadeTop: 184,
	/** Rule along the top of the graph area, just above the shading. */
	topRuleY: 180,
	/** Night shading and dashed lines start right under the 2px rule, so no
	 * white gap shows between them (per Chris). */
	nightTop: 181,
	/** Band the temperature line stays inside. Top leaves room for the
	 * high/low label above it; bottom keeps the line (8px wide) 14px clear of
	 * the icon row. */
	lineTop: 226,
	lineBottom: AXIS_Y - SMALL_ICON - 10 - 14 - 4,
	lineWidth: 8,
	/** Thin solid blue humidity line drawn under the temperature line,
	 * 0% at lineBottom to 100% at lineTop. */
	humidity: {
		color: "#0096FF",
		width: 3,
		outline: 3,
		dash: [] as number[],
	},
	/** White edge either side of the temperature line, in px. */
	lineOutline: 3,
	smallIcon: SMALL_ICON,
	/** y (top) of the small icons. */
	iconY: AXIS_Y - SMALL_ICON - 10,
	labelFont: "24px Mania",
	/** High/low temperature labels: black, a step up from the other labels. */
	highLowFont: "28px Mania",
	/** Hour and rain-chance rows: their ink sits with equal 11px gaps between
	 * the axis, the two rows and the bottom of the screen. */
	timeLabelY: AXIS_Y + 14,
	rainLabelY: AXIS_Y + 42,
	/** Label-box lattice spacing (from the old dotted night shading); label
	 * boxes and stars still snap to it. */
	dotSpacing: 6,
	/** Night shading: a 1px dither from white at sunset to `maxDensity`
	 * black, and back before sunrise. The fade follows the real twilight
	 * (sunset to sun 18° down) stretched by `twilightScale`, so ~3h in late
	 * November, ~4h in August, and around midsummer it never gets fully dark.
	 * `fadeHours` is the fallback when no twilight length is known. */
	night: { fadeHours: 3, twilightScale: 1.5, maxDensity: 12 / 16 },
	dotSize: 2,
	/** Corner radius of the white boxes behind graph labels. */
	labelRadius: 8,
	/** White edge around drop/flake icons, in px. */
	iconHalo: 3,
	/** Red dot on the temperature line at the current time. */
	nowDotRadius: 8,
	/** Little white stars in the darkest part of each night. */
	stars: {
		/** Arm length from the centre, in px. */
		radius: 7,
		/** Half-width of the arms where they meet in the middle, in px. */
		waist: 2,
		/** Roughly one star per this many px of full-darkness night. */
		every: 20,
		/** Extra stars per night on top of that. */
		extra: 6,
		/** Stars stay at least this far apart, centre to centre. */
		minGap: 24,
		/** Only where the night shading is at least this far through its fade. */
		minDensity: 0.3,
		/** Keep this far from the temperature line and labels. */
		clearance: 8,
	},
} as const;
