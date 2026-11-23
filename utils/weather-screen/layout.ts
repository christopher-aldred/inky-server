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
	dots: "#444444",
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
	/** x of the first and last forecast points. */
	firstX: FIRST_X,
	lastX: SCREEN.width - FIRST_X,
	step: (SCREEN.width - 2 * FIRST_X) / (POINT_COUNT - 1),
	axisY: AXIS_Y,
	/** Night shading starts just below the detail rows. */
	shadeTop: 184,
	/** Band the temperature line stays inside. Top leaves room for the
	 * high/low label above it; bottom keeps the line (8px wide) 14px clear of
	 * the icon row. */
	lineTop: 220,
	lineBottom: AXIS_Y - SMALL_ICON - 10 - 14 - 4,
	lineWidth: 8,
	smallIcon: SMALL_ICON,
	/** y (top) of the small icons. */
	iconY: AXIS_Y - SMALL_ICON - 10,
	labelFont: "24px Mania",
	/** High/low temperature labels: black, a step up from the other labels. */
	highLowFont: "28px Mania",
	timeLabelY: AXIS_Y + 8,
	rainLabelY: AXIS_Y + 40,
	/** Night-shading dot lattice spacing; dot columns land on firstX/lastX. */
	dotSpacing: 6,
	dotSize: 2,
} as const;
