import { test } from "node:test";
import assert from "node:assert/strict";
import {
	assessAurora,
	formatKp,
	maxKpInWindow,
	parseAuroraWatchStatus,
	parseKpForecast,
} from "../utils/aurora.ts";

const at = (iso: string) => Date.parse(iso) / 1000;

test("parseAuroraWatchStatus reads the site status", () => {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<current_status api_version="0.2.5">
  <updated><datetime>2026-11-23T10:00:00+0000</datetime></updated>
  <site_status project_id="project:AWN" site_id="site:AWN:SUM" site_url="https://aurorawatch-api.lancs.ac.uk/0.2/project/awn/sum.xml" status_id="amber"/>
</current_status>`;
	assert.equal(parseAuroraWatchStatus(xml), "amber");
	assert.equal(parseAuroraWatchStatus("<nope/>"), null);
	assert.equal(
		parseAuroraWatchStatus('<site_status status_id="purple"/>'),
		null,
	);
});

test("parseKpForecast handles the header-row format", () => {
	const data = [
		["time_tag", "kp", "observed", "noaa_scale"],
		["2026-11-23 00:00:00", "3.33", "observed", null],
		["2026-11-23 03:00:00", "6.67", "predicted", "G2"],
		["bad", "1", "predicted", null],
	];
	assert.deepEqual(parseKpForecast(data), [
		{ time: at("2026-11-23T00:00:00Z"), kp: 3.33 },
		{ time: at("2026-11-23T03:00:00Z"), kp: 6.67 },
	]);
});

test("parseKpForecast handles the object format", () => {
	const data = [
		{ time_tag: "2026-11-23T00:00:00", kp: 4, observed: "observed" },
		{ time_tag: "2026-11-23T03:00:00", kp: 7.33, observed: "predicted" },
	];
	assert.deepEqual(parseKpForecast(data), [
		{ time: at("2026-11-23T00:00:00Z"), kp: 4 },
		{ time: at("2026-11-23T03:00:00Z"), kp: 7.33 },
	]);
	assert.deepEqual(parseKpForecast(null), []);
	assert.deepEqual(parseKpForecast([]), []);
});

test("maxKpInWindow includes the slot in progress and ignores past/far slots", () => {
	const entries = [
		{ time: at("2026-11-23T03:00:00Z"), kp: 8 }, // ended at 06:00
		{ time: at("2026-11-23T09:00:00Z"), kp: 4 }, // in progress at 10:00
		{ time: at("2026-11-23T21:00:00Z"), kp: 6.33 },
		{ time: at("2026-11-24T12:00:00Z"), kp: 9 }, // beyond 24h
	];
	assert.equal(maxKpInWindow(entries, at("2026-11-23T10:00:00Z")), 6.33);
	assert.equal(maxKpInWindow([], at("2026-11-23T10:00:00Z")), null);
});

test("assessAurora only alerts when visible from London", () => {
	assert.equal(assessAurora("green", 3), null);
	assert.equal(assessAurora("yellow", 5.67), null);
	assert.equal(assessAurora(null, null), null);
	assert.equal(assessAurora("amber", null)?.level, "possible");
	assert.equal(assessAurora("green", 6)?.level, "possible");
	assert.equal(assessAurora("red", 2)?.level, "likely");
	assert.equal(assessAurora(null, 7)?.level, "likely");
	assert.equal(assessAurora("amber", 7.33)?.message, "Aurora likely tonight!");
});

test("formatKp", () => {
	assert.equal(formatKp(7), "Kp 7");
	assert.equal(formatKp(6.67), "Kp 6.7");
	assert.equal(formatKp(7.0001), "Kp 7");
});
