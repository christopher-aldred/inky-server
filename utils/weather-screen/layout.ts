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
	dots: "#000000",
	/** Second, offset layer of night dots for the darkest hours. */
	deepNightDots: "#000000",
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
	/** The first graph point is this many hours before the current hour. */
	pastHours: 3,
	/** x of the first and last forecast points. */
	firstX: FIRST_X,
	lastX: SCREEN.width - FIRST_X,
	step: (SCREEN.width - 2 * FIRST_X) / (POINT_COUNT - 1),
	axisY: AXIS_Y,
	/** Night shading starts just below the detail rows. */
	shadeTop: 184,
	/** Rule along the top of the graph area, just above the shading. */
	topRuleY: 180,
	/** Band the temperature line stays inside. Top leaves room for the
	 * high/low label above it; bottom keeps the line (8px wide) 14px clear of
	 * the icon row. */
	lineTop: 226,
	lineBottom: AXIS_Y - SMALL_ICON - 10 - 14 - 4,
	lineWidth: 8,
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
	/** Night-shading dot lattice spacing; dot columns land on firstX/lastX. */
	dotSpacing: 6,
	/** Night dots fade in over this long after sunset and out before sunrise. */
	nightFadeHours: 3.5,
	/** A second layer of black dots, offset half a cell from the black ones,
	 * darkens the middle of the night. It builds up over this long after
	 * sunset and thins out before sunrise, so it's densest around the middle
	 * and barely shows on short summer nights. */
	deepNightFadeHours: 6,
	dotSize: 2,
	/** Red dot on the temperature line at the current time. */
	nowDotRadius: 6,
	/** Little white stars in the darkest part of each night. */
	stars: {
		/** Arm length from the centre, in px. */
		radius: 15,
		/** Half-width of the arms where they meet in the middle, in px. */
		waist: 4,
		/** Roughly one star per this many px of full-darkness night. */
		every: 52,
		/** Extra stars per night on top of that. */
		extra: 2,
		/** Stars stay at least this far apart, centre to centre. */
		minGap: 39,
		/** Only where the deep-night dots are at least this dense. */
		minDensity: 0.5,
		/** Keep this far from the temperature line and labels. */
		clearance: 14,
	},
} as const;
