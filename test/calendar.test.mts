import { test } from "node:test";
import assert from "node:assert/strict";
import IcalExpander from "ical-expander";
import {
	addDaysToKey,
	buildCalendarData,
	dateKeyIn,
	startOfDayInstant,
	timeIn,
	wallTimeToInstant,
} from "../utils/calendar-events.ts";
import {
	formatDate,
	groupEventsByDateFourColumn,
	processCalendarData,
} from "../utils/calendar-processing.ts";
import { describeFeedUrl, normalizeFeedUrl } from "../utils/feed-url.ts";
import { firstQueryValue, queryValues } from "../utils/query.ts";

const TZ = "Europe/London";

function calendar(...events: string[]): IcalExpander {
	const body = events
		.map((e) => `BEGIN:VEVENT\r\n${e.trim().split(/\s*\n\s*/).join("\r\n")}\r\nEND:VEVENT`)
		.join("\r\n");
	return new IcalExpander({
		ics: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${body}\r\nEND:VCALENDAR`,
		maxIterations: 5000,
	});
}

const build = (now: string, ...events: string[]) =>
	buildCalendarData([calendar(...events)], new Date(now), TZ, 1);

test("timed events show London time in summer, not server UTC", () => {
	const data = build(
		"2026-07-01T08:00:00Z",
		`UID:1
		DTSTART;TZID=Europe/London:20260701T093000
		DTEND;TZID=Europe/London:20260701T103000
		SUMMARY:Dentist`,
	);
	assert.deepEqual(data, { "2026-07-01": { "09:30": ["Dentist"] } });
});

test("UTC (Z) event times are converted to BST", () => {
	const data = build(
		"2026-07-01T08:00:00Z",
		`UID:1
		DTSTART:20260701T140000Z
		DTEND:20260701T150000Z
		SUMMARY:Call`,
	);
	assert.deepEqual(data, { "2026-07-01": { "15:00": ["Call"] } });
});

test("a late-evening BST event lands on its London day", () => {
	// 00:30 BST on 2 July is 23:30 UTC on 1 July
	const data = build(
		"2026-07-01T08:00:00Z",
		`UID:1
		DTSTART:20260701T233000Z
		DTEND:20260702T003000Z
		SUMMARY:Night train`,
	);
	assert.deepEqual(data, { "2026-07-02": { "00:30": ["Night train"] } });
});

test("floating times are read as London wall-clock time", () => {
	const data = build(
		"2026-07-01T08:00:00Z",
		`UID:1
		DTSTART:20260701T093000
		DTEND:20260701T103000
		SUMMARY:Floating`,
	);
	assert.deepEqual(data, { "2026-07-01": { "09:30": ["Floating"] } });
});

test("between 00:00 and 01:00 BST, yesterday's events are gone", () => {
	// 00:30 BST on 2 July = 23:30 UTC on 1 July. The old code took today as the
	// UTC date (1 July) and still showed 1 July's events.
	const data = build(
		"2026-07-01T23:30:00Z",
		`UID:1
		DTSTART;VALUE=DATE:20260701
		DTEND;VALUE=DATE:20260702
		SUMMARY:Yesterday`,
		`UID:2
		DTSTART;VALUE=DATE:20260702
		DTEND;VALUE=DATE:20260703
		SUMMARY:Today`,
	);
	assert.deepEqual(data, { "2026-07-02": { allday: ["Today"] } });
});

test("all-day events: exclusive end date, multi-day spans, missing DTEND", () => {
	const data = build(
		"2026-07-01T08:00:00Z",
		`UID:1
		DTSTART;VALUE=DATE:20260701
		DTEND;VALUE=DATE:20260704
		SUMMARY:Holiday`,
		`UID:2
		DTSTART;VALUE=DATE:20260705
		SUMMARY:Birthday`,
	);
	assert.deepEqual(data, {
		"2026-07-01": { allday: ["Holiday"] },
		"2026-07-02": { allday: ["Holiday"] },
		"2026-07-03": { allday: ["Holiday"] },
		"2026-07-05": { allday: ["Birthday"] },
	});
});

test("an all-day event that started earlier still shows from today", () => {
	const data = build(
		"2026-07-03T08:00:00Z",
		`UID:1
		DTSTART;VALUE=DATE:20260701
		DTEND;VALUE=DATE:20260705
		SUMMARY:Festival`,
	);
	assert.deepEqual(Object.keys(data), ["2026-07-03", "2026-07-04"]);
});

test("multi-day timed event covers its last day even if it ends earlier in the day", () => {
	// The old loop stepped 24h from the start time, so it stopped at Tue 10:00
	// and dropped Wednesday, when the event ends at 09:00.
	const data = build(
		"2026-07-06T08:00:00Z",
		`UID:1
		DTSTART;TZID=Europe/London:20260706T100000
		DTEND;TZID=Europe/London:20260708T090000
		SUMMARY:Conference`,
	);
	assert.deepEqual(data, {
		"2026-07-06": { "10:00": ["Conference"] },
		"2026-07-07": { allday: ["Conference"] },
		"2026-07-08": { allday: ["Conference"] },
	});
});

test("an event ending exactly at midnight doesn't spill into the next day", () => {
	const data = build(
		"2026-07-06T08:00:00Z",
		`UID:1
		DTSTART;TZID=Europe/London:20260706T220000
		DTEND;TZID=Europe/London:20260707T000000
		SUMMARY:Late show`,
	);
	assert.deepEqual(data, { "2026-07-06": { "22:00": ["Late show"] } });
});

test("weekly event keeps its local time across the October clock change", () => {
	const data = buildCalendarData(
		[
			calendar(`UID:1
			DTSTART;TZID=Europe/London:20261018T090000
			DTEND;TZID=Europe/London:20261018T100000
			RRULE:FREQ=WEEKLY;COUNT=3
			SUMMARY:Parkrun`),
		],
		new Date("2026-10-17T12:00:00Z"),
		TZ,
		3,
	);
	assert.deepEqual(data, {
		"2026-10-18": { "09:00": ["Parkrun"] },
		"2026-10-25": { "09:00": ["Parkrun"] },
		"2026-11-01": { "09:00": ["Parkrun"] },
	});
});

test("cancelled events are skipped", () => {
	const data = build(
		"2026-07-01T08:00:00Z",
		`UID:1
		DTSTART;TZID=Europe/London:20260701T093000
		DTEND;TZID=Europe/London:20260701T103000
		STATUS:CANCELLED
		SUMMARY:Called off`,
	);
	assert.deepEqual(data, {});
});

test("the results don't depend on the server's timezone", () => {
	// Run the same check as the BST test using only the helpers' maths.
	const instant = wallTimeToInstant(
		{ year: 2026, month: 7, day: 1, hour: 9, minute: 30 },
		TZ,
	);
	assert.equal(new Date(instant).toISOString(), "2026-07-01T08:30:00.000Z");
	assert.equal(timeIn(instant, TZ), "09:30");
	assert.equal(dateKeyIn(Date.parse("2026-07-01T23:30:00Z"), TZ), "2026-07-02");
	// Local midnight on clock-change days
	assert.equal(
		new Date(startOfDayInstant("2026-03-29", TZ)).toISOString(),
		"2026-03-29T00:00:00.000Z",
	);
	assert.equal(
		new Date(startOfDayInstant("2026-10-25", TZ)).toISOString(),
		"2026-10-24T23:00:00.000Z",
	);
	assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01");
});

test("column headers name the right day whatever the server zone", () => {
	assert.equal(formatDate("2026-11-23"), "Mon 23");
});

test("four-column view starts from the London date, not the UTC date", () => {
	const events = processCalendarData({
		"2026-07-01": { allday: ["Yesterday"] },
		"2026-07-02": { "09:00": ["Today"] },
	});
	const grouped = groupEventsByDateFourColumn(events, "2026-07-02");
	assert.deepEqual([...grouped.keys()], ["Thu 2"]);
});

test("feed URLs: webcal becomes https, private and odd schemes are refused", () => {
	assert.equal(
		normalizeFeedUrl("webcal://p01-caldav.icloud.com/published/2/abc"),
		"https://p01-caldav.icloud.com/published/2/abc",
	);
	assert.equal(
		normalizeFeedUrl(" https://calendar.google.com/x.ics "),
		"https://calendar.google.com/x.ics",
	);
	for (const bad of [
		"file:///etc/passwd",
		"data:text/calendar,BEGIN",
		"http://169.254.169.254/latest/meta-data",
		"http://localhost:3000/",
		"http://10.0.0.5/cal.ics",
		"http://[::1]/",
		"not a url",
	]) {
		assert.throws(() => normalizeFeedUrl(bad), bad);
	}
	assert.equal(
		describeFeedUrl("https://calendar.google.com/private-secret/basic.ics"),
		"calendar.google.com",
	);
});

test("query helpers handle repeated, empty and missing params", () => {
	assert.equal(firstQueryValue(["London,UK", "Paris"]), "London,UK");
	assert.equal(firstQueryValue(""), undefined);
	assert.equal(firstQueryValue(undefined), undefined);
	assert.deepEqual(queryValues(["a", " ", "b"]), ["a", "b"]);
});
