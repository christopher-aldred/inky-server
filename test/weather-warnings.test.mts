import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatWarningMessage,
	formatWarningType,
	parseWarningsRss,
	pickDisplayWarning,
} from "../utils/weather-warnings.ts";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Met Office warnings for London &amp; South East England</title>
<item>
  <title>Yellow warning of rain affecting London &amp; South East England</title>
  <description>valid from 0600 Mon 23 Nov to 2100 Mon 23 Nov</description>
</item>
<item>
  <title><![CDATA[Amber warning of wind, rain affecting London & South East England]]></title>
</item>
<item>
  <title>Red warning of snow and ice affecting London &amp; South East England</title>
</item>
</channel></rss>`;

test("parseWarningsRss reads level and type from each item", () => {
	assert.deepEqual(parseWarningsRss(rss), [
		{ level: "yellow", type: "Rain" },
		{ level: "amber", type: "Wind & rain" },
		{ level: "red", type: "Snow & ice" },
	]);
	assert.deepEqual(parseWarningsRss("<rss><channel></channel></rss>"), []);
});

test("pickDisplayWarning ignores yellow and prefers red", () => {
	assert.equal(pickDisplayWarning([{ level: "yellow", type: "Rain" }]), null);
	assert.deepEqual(pickDisplayWarning(parseWarningsRss(rss)), {
		level: "red",
		type: "Snow & ice",
	});
	assert.deepEqual(
		pickDisplayWarning([
			{ level: "amber", type: "Wind" },
			{ level: "amber", type: "Rain" },
		]),
		{ level: "amber", type: "Wind" },
	);
});

test("formatting", () => {
	assert.equal(formatWarningType("extreme heat"), "Extreme heat");
	assert.equal(formatWarningType("Thunderstorm"), "Thunderstorm");
	assert.equal(
		formatWarningMessage({ level: "red", type: "Wind" }),
		"RED warning: Wind",
	);
	assert.equal(
		formatWarningMessage({ level: "amber", type: "Rain" }),
		"Amber warning: Rain",
	);
});
