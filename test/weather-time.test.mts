import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findCurrentHourIndex,
	findSunTimesForDay,
	formatLocalHour,
	localDateKey,
	selectGraphHours,
	sumOverWindow,
} from "../utils/weather-time.ts";

const TZ = "Europe/London";
const at = (iso: string) => Date.parse(iso) / 1000;

/** Hourly slots as Open-Meteo returns them: evenly spaced real UTC times. */
function hourly(startIso: string, count: number) {
	const start = at(startIso);
	return Array.from({ length: count }, (_, i) => ({ dt: start + i * 3600 }));
}

test("labels use London time in summer, not server UTC", () => {
	// 14:00 UTC in July is 15:00 BST
	assert.equal(formatLocalHour(at("2026-07-01T14:00:00Z"), TZ), "15");
	// 23:00 UTC is midnight BST and must read "00", not "24"
	assert.equal(formatLocalHour(at("2026-07-01T23:00:00Z"), TZ), "00");
});

test("labels in winter match UTC", () => {
	assert.equal(formatLocalHour(at("2026-11-23T06:00:00Z"), TZ), "06");
});

test("spring forward: 01:00 local never appears, points stay evenly spaced", () => {
	// 29 Mar 2026: clocks go 01:00 GMT -> 02:00 BST. Local midnight = 00:00Z.
	const day = hourly("2026-03-29T00:00:00Z", 48);
	const labels = day.slice(0, 4).map((e) => formatLocalHour(e.dt, TZ));
	assert.deepEqual(labels, ["00", "02", "03", "04"]);

	const points = selectGraphHours(day, at("2026-03-29T00:30:00Z"), 4, 2);
	assert.deepEqual(
		points.map((p) => formatLocalHour(p.dt, TZ)),
		["00", "03", "05", "07"],
	);
	// 2 real hours between every point
	for (let i = 1; i < points.length; i++) {
		assert.equal(points[i].dt - points[i - 1].dt, 7200);
	}
});

test("fall back: 01:00 local appears twice and the right one is chosen", () => {
	// 25 Oct 2026: clocks go 02:00 BST -> 01:00 GMT. Local midnight = 23:00Z prev day.
	const day = hourly("2026-10-24T23:00:00Z", 48);
	const labels = day.slice(0, 4).map((e) => formatLocalHour(e.dt, TZ));
	assert.deepEqual(labels, ["00", "01", "01", "02"]);

	// Now is 01:30 GMT, the second 01:00 hour (index 2), not the first.
	const now = at("2026-10-25T01:30:00Z");
	assert.equal(findCurrentHourIndex(day, now), 2);
	const points = selectGraphHours(day, now, 3, 2);
	assert.equal(points[0].dt, at("2026-10-25T01:00:00Z"));
	assert.deepEqual(
		points.map((p) => formatLocalHour(p.dt, TZ)),
		["01", "03", "05"],
	);
});

test("graph starts at the current hour just after BST midnight", () => {
	// 00:20 BST on 2 Jul = 23:20Z on 1 Jul. Data starts at local midnight.
	const day = hourly("2026-07-01T23:00:00Z", 48);
	const points = selectGraphHours(day, at("2026-07-01T23:20:00Z"), 8, 2);
	assert.equal(points.length, 8);
	assert.equal(formatLocalHour(points[0].dt, TZ), "00");
	assert.equal(formatLocalHour(points[7].dt, TZ), "14");
});

test("graph still has 8 points late in the evening", () => {
	const day = hourly("2026-11-23T00:00:00Z", 48);
	const points = selectGraphHours(day, at("2026-11-23T23:59:00Z"), 8, 2);
	assert.equal(points.length, 8);
	assert.equal(formatLocalHour(points[0].dt, TZ), "23");
});

test("local date keys follow London, not UTC", () => {
	assert.equal(localDateKey(at("2026-07-01T23:30:00Z"), TZ), "2026-07-02");
	assert.equal(localDateKey(at("2026-12-31T23:30:00Z"), TZ), "2026-12-31");
});

test("sun times are matched by local day across a 25-hour day", () => {
	const days = [
		{ sunrise: at("2026-10-24T06:50:00Z"), sunset: at("2026-10-24T16:55:00Z") },
		{ sunrise: at("2026-10-25T06:52:00Z"), sunset: at("2026-10-25T16:53:00Z") },
		{ sunrise: at("2026-10-26T06:54:00Z"), sunset: at("2026-10-26T16:51:00Z") },
	];
	// 23:30 GMT on the 25th is still the 25th locally: 24h after the 25th's
	// local midnight (23:00Z on the 24th) but within that 25-hour day.
	assert.equal(
		findSunTimesForDay(days, at("2026-10-25T23:30:00Z"), TZ),
		days[1],
	);
	// 23:30Z in summer is the next local day
	const summer = [
		{ sunrise: at("2026-07-01T03:45:00Z"), sunset: at("2026-07-01T20:20:00Z") },
		{ sunrise: at("2026-07-02T03:46:00Z"), sunset: at("2026-07-02T20:20:00Z") },
	];
	assert.equal(
		findSunTimesForDay(summer, at("2026-07-01T23:30:00Z"), TZ),
		summer[1],
	);
});

test("precipitation window covers exactly 24 hours from the current hour", () => {
	const day = hourly("2026-11-23T00:00:00Z", 48).map((e) => ({ ...e, mm: 1 }));
	const from = at("2026-11-23T06:00:00Z");
	assert.equal(
		sumOverWindow(day, from, 24, (e) => e.mm),
		24,
	);
});

test("3-hour graph (the default) still has 8 points at 23:00", () => {
	const day = hourly("2026-11-23T00:00:00Z", 48);
	const points = selectGraphHours(day, at("2026-11-23T23:10:00Z"));
	assert.equal(points.length, 8);
	assert.deepEqual(
		points.map((p) => formatLocalHour(p.dt, TZ)),
		["23", "02", "05", "08", "11", "14", "17", "20"],
	);
});
