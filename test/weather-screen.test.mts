import assert from "node:assert/strict";
import { test } from "node:test";
import { getCurvePoints, getTemperatureColor } from "../utils/chart.ts";
import {
	ditherDotOn,
	insideStar,
	nightDotDensity,
	starPositions,
} from "../utils/weather-screen/graph.ts";
import {
	buildScreenModel,
	compassDirection,
	localMidnights,
	nightRanges,
	pickBanner,
	summariseBlock,
	sunOrUvRow,
} from "../utils/weather-screen/model.ts";
import { renderWeatherScreen } from "../utils/weather-screen/render.ts";
import { londonWeather } from "./fixtures/london-weather.ts";

const at = (iso: string) => Date.parse(iso) / 1000;
const TZ = "Europe/London";

test("compassDirection rounds to 8 points", () => {
	assert.equal(compassDirection(0), "N");
	assert.equal(compassDirection(225), "SW");
	assert.equal(compassDirection(350), "N");
	assert.equal(compassDirection(-45), "NW");
	assert.equal(compassDirection(100), "E");
});

test("pickBanner: weather warning beats aurora; red solid, amber outline", () => {
	const aurora = {
		level: "likely" as const,
		kp: 7,
		message: "Aurora likely tonight!",
	};
	assert.deepEqual(pickBanner(null, aurora), {
		message: "Aurora likely tonight! Kp 7",
		style: "solid",
	});
	assert.deepEqual(pickBanner({ level: "amber", type: "Rain" }, aurora), {
		message: "Amber warning: Rain",
		style: "outline",
	});
	assert.equal(
		pickBanner({ level: "red", type: "Wind" }, null)?.style,
		"solid",
	);
	assert.equal(pickBanner(null, null), null);
});

test("sunOrUvRow: next sunrise/sunset, UV only by day when 3+", () => {
	const days = londonWeather().days;
	assert.deepEqual(sunOrUvRow(at("2026-11-23T05:00:00Z"), days, TZ), {
		label: "Sunrise ",
		value: "07:38",
	});
	assert.deepEqual(sunOrUvRow(at("2026-11-23T11:50:00Z"), days, TZ), {
		label: "Sunset ",
		value: "15:57",
	});
	assert.deepEqual(sunOrUvRow(at("2026-11-23T18:40:00Z"), days, TZ), {
		label: "Sunrise ",
		value: "07:38",
	});
	const sunny = days.map((d) => ({ ...d, uvMax: 5 }));
	assert.deepEqual(sunOrUvRow(at("2026-11-23T11:50:00Z"), sunny, TZ), {
		label: "UV Index ",
		value: "5.0",
	});
	// still shows sunrise at night, even on a high-UV day
	assert.equal(
		sunOrUvRow(at("2026-11-23T20:00:00Z"), sunny, TZ).label,
		"Sunrise ",
	);
});

test("sunOrUvRow uses London time in summer", () => {
	const day = {
		sunrise: at("2026-06-21T03:43:00Z"), // 04:43 BST
		sunset: at("2026-06-21T20:21:00Z"), // 21:21 BST
		uvMax: 1,
	};
	assert.equal(
		sunOrUvRow(at("2026-06-21T12:00:00Z"), [day], TZ).value,
		"21:21",
	);
});

test("nightRanges covers before first sunrise and each sunset→sunrise", () => {
	const days = londonWeather().days;
	const nights = nightRanges(days);
	assert.equal(nights.length, 4);
	assert.deepEqual(nights[0], [-Infinity, days[0].sunrise]);
	assert.deepEqual(nights[1], [days[0].sunset, days[1].sunrise]);
	assert.deepEqual(nights[3], [days[2].sunset, Infinity]);
	assert.deepEqual(nightRanges([]), []);
});

test("localMidnights finds the date change and labels the new day", () => {
	const { hourly } = londonWeather();
	assert.deepEqual(
		localMidnights(
			hourly,
			at("2026-11-23T18:00:00Z"),
			at("2026-11-24T15:00:00Z"),
			TZ,
		),
		[{ time: at("2026-11-24T00:00:00Z"), label: "Tue" }],
	);
	assert.deepEqual(
		localMidnights(
			hourly,
			at("2026-11-23T06:00:00Z"),
			at("2026-11-23T20:00:00Z"),
			TZ,
		),
		[],
	);
});

test("buildScreenModel: 8 points every 3h from the current hour, edges, highlights", () => {
	const weather = londonWeather("2026-11-23T18:40:00Z");
	const model = buildScreenModel(weather, {
		location: "London,UK",
		now: at("2026-11-23T18:40:00Z"),
	});
	const { graph, details } = model;

	assert.equal(model.title, "Weather London, Mon 18:40");
	assert.equal(model.currentTemp, "6°C");
	assert.equal(model.bigIcon, "moon");
	assert.equal(model.banner, null);

	assert.deepEqual(
		graph.points.map((p) => p.hourLabel),
		// now is 18:40, so the graph starts at 18:00
		["18", "21", "00", "03", "06", "09", "12", "15"],
	);
	assert.equal(graph.before?.time, at("2026-11-23T15:00:00Z"));
	assert.equal(graph.after?.time, at("2026-11-24T18:00:00Z"));
	assert.equal(graph.now, at("2026-11-23T18:40:00Z"));
	assert.equal(graph.points[graph.lowIndex].temp, -1);
	assert.equal(graph.points[graph.highIndex].temp, 12);
	assert.deepEqual(
		graph.midnights.map((m) => m.label),
		["Tue"],
	);

	// icons agree with the night shading: moon only between sunset and sunrise
	assert.equal(graph.points[2].icon, "moon"); // 00:00, clear
	assert.equal(graph.points[5].icon, "clear"); // 09:00, after sunrise

	assert.deepEqual(details.left[0], { label: "Wind ", value: "14 km/h SW" });
	assert.deepEqual(details.left[1], {
		label: "Gusts ",
		value: "63 km/h",
		highlight: true,
	});
	assert.deepEqual(details.right[2], { label: "Sunrise ", value: "07:38" });
});

test("buildScreenModel: no 'before' edge when the data starts at now", () => {
	const model = buildScreenModel(londonWeather(), {
		location: "London,UK",
		now: at("2026-11-23T00:10:00Z"),
	});
	assert.equal(model.graph.before, null);
	assert.ok(model.graph.after);
	// Can't go 3h back before midnight, so it starts at the first hour
	assert.equal(model.graph.points[0].hourLabel, "00");
});

test("buildScreenModel: early morning starts at the current hour", () => {
	const model = buildScreenModel(londonWeather(), {
		location: "London,UK",
		now: at("2026-11-23T02:30:00Z"),
	});
	assert.equal(model.graph.points[0].hourLabel, "02");
	assert.equal(model.graph.points.length, 8);
});

test("getTemperatureColor uses solid bands, no blending", () => {
	assert.equal(getTemperatureColor(-10), "#0096FF");
	assert.equal(getTemperatureColor(0), "#0096FF");
	assert.equal(getTemperatureColor(0.5), "#AAFF00");
	assert.equal(getTemperatureColor(10), "#AAFF00");
	assert.equal(getTemperatureColor(15), "#FFA500");
	assert.equal(getTemperatureColor(20), "#FFA500");
	assert.equal(getTemperatureColor(40), "#E74C3C");
});

test("getCurvePoints passes through nodes and interpolates extra values", () => {
	const curve = getCurvePoints<[number, number, number]>(
		[
			[0, 0, 0],
			[10, 10, 5],
			[20, 0, 10],
		],
		10,
	);
	assert.deepEqual(curve[0], [0, 0, 0]);
	assert.deepEqual(curve[10], [10, 10, 5]);
	assert.deepEqual(curve[curve.length - 1], [20, 0, 10]);
});

test("renderWeatherScreen produces a JPEG, with and without a banner", async () => {
	const weather = londonWeather();
	for (const warning of [null, { level: "red" as const, type: "Wind" }]) {
		const image = await renderWeatherScreen(
			buildScreenModel(weather, {
				location: "London,UK",
				now: weather.current.time,
				warning,
			}),
		);
		assert.equal(image[0], 0xff);
		assert.equal(image[1], 0xd8);
		assert.ok(image.length > 10_000);
	}
});

test("night dots fade in after sunset and out before sunrise", () => {
	// Night from x=100 to x=500, fading over 50px at each end
	assert.equal(nightDotDensity(90, 100, 500, 50), 0);
	assert.equal(nightDotDensity(100, 100, 500, 50), 0);
	assert.equal(nightDotDensity(125, 100, 500, 50), 0.5);
	assert.equal(nightDotDensity(300, 100, 500, 50), 1);
	assert.equal(nightDotDensity(475, 100, 500, 50), 0.5);
	// Open-ended nights (before the first sunrise) don't fade at the open end
	assert.equal(nightDotDensity(0, -Infinity, 500, 50), 1);
	assert.equal(nightDotDensity(700, 100, Infinity, 50), 1);
});

test("dither shows the right share of dots for a density", () => {
	const share = (density: number) => {
		let on = 0;
		for (let col = 0; col < 4; col++)
			for (let row = 0; row < 4; row++)
				if (ditherDotOn(col, row, density)) on++;
		return on / 16;
	};
	assert.equal(share(0), 0);
	assert.equal(share(0.25), 0.25);
	assert.equal(share(0.5), 0.5);
	assert.equal(share(1), 1);
	assert.equal(ditherDotOn(-3, -7, 1), true); // negative indices are safe
});

test("night stars stay in the dark middle, clear of the line and labels", () => {
	const lineY = () => 300;
	const label = { x: 380, y: 190, w: 60, h: 30 };
	const stars = starPositions([[100, 700]], lineY, [label]);
	assert.ok(stars.length >= 3);
	for (const s of stars) {
		assert.ok(s.x > 100 && s.x < 700);
		assert.ok(Math.abs(s.y - 300) > 20);
		const inLabel =
			s.x > label.x - 10 &&
			s.x < label.x + label.w + 10 &&
			s.y > label.y - 10 &&
			s.y < label.y + label.h + 10;
		assert.ok(!inLabel);
	}
	// Same inputs, same stars (no flicker between refreshes)
	assert.deepEqual(starPositions([[100, 700]], lineY, [label]), stars);
	// A short night has no dark middle, so no stars
	assert.deepEqual(starPositions([[100, 200]], lineY, []), []);
});

test("stars are gaps shaped like a four-point twinkle", () => {
	assert.ok(insideStar(0, 0));
	assert.ok(insideStar(0, 14)); // along an arm
	assert.ok(insideStar(-14, 0));
	assert.ok(!insideStar(10, 10)); // between the arms
	assert.ok(!insideStar(0, 30)); // past the tip
});

test("each graph column sums up the hour before to the hour after", () => {
	const hour = (weatherMain: string, precipitationProbability: number) => ({
		dt: 0,
		temp: 5,
		weatherMain,
		precipitation: 0,
		precipitationProbability,
		humidity: 80,
	});
	const hourly = [
		hour("clear", 10),
		hour("rain", 70), // between columns
		hour("clouds", 20), // the column's own hour
		hour("clear", 5),
		hour("snow", 90), // outside the block
	];
	assert.deepEqual(summariseBlock(hourly, 2), {
		weatherMain: "rain",
		rainChance: 70,
	});
	// No wet weather nearby: the hour's own weather shows
	assert.deepEqual(summariseBlock(hourly.slice(2, 4), 0), {
		weatherMain: "clouds",
		rainChance: 20,
	});
	// Thunder beats snow beats rain
	assert.equal(
		summariseBlock(
			[hour("rain", 50), hour("thunderstorm", 40), hour("snow", 30)],
			1,
		).weatherMain,
		"thunderstorm",
	);
});

test("graph points carry the hour's humidity for the humidity line", () => {
	const weather = londonWeather();
	const model = buildScreenModel(weather, {
		location: "London,UK",
		now: weather.current.time,
		warning: null,
	});
	for (const point of model.graph.points) {
		const hour = weather.hourly.find((h) => h.dt === point.time);
		assert.equal(point.humidity, hour?.humidity);
	}
	assert.ok(model.graph.after && model.graph.after.humidity > 0);
});
