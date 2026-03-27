import ical from "ical";
import { google } from "googleapis";
import { DateTime } from "luxon";
import auth from "./googleCalendarCredentials.json" with { type: "json" };
import icloudURL from "./iCloudCalURL.js";
import outlookURL from "./outlookCalURL.js";
import fs from "fs";

let lastRun = new Date().toISOString();

console.log(`Starting sync run: ${lastRun}`);

try {
	lastRun = fs.readFileSync("./lastRun.txt", "utf8");
} catch (e) {
	if (e.errno === -2) {
		fs.writeFileSync("./lastRun.txt", lastRun);
	} else {
		console.error(e);
	}
}
const diff_minutes = (dt2, dt1) => {
	var diff = (dt2.getTime() - dt1.getTime()) / 1000;
	diff /= 60;
	return Math.abs(Math.round(diff));
};
//if the last run was less than a little under two hours, exit. DO NOT SYNC, last sync was too recent
if (diff_minutes(new Date(), new Date(lastRun)) < 119) {
	console.log(`Last run was ${lastRun} - too recent. Exiting.`);
	process.exit();
}

const SCOPES = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_PRIVATE_KEY = auth.private_key;
const GOOGLE_CLIENT_EMAIL = auth.client_email;
const GOOGLE_PROJECT_NUMBER = auth.project_id;
const GOOGLE_CALENDAR_ID = "max.matthews@wearetuzag.com";

const jwtClient = new google.auth.JWT(
	GOOGLE_CLIENT_EMAIL,
	null,
	GOOGLE_PRIVATE_KEY,
	SCOPES,
);

const calendar = google.calendar({
	version: "v3",
	project: GOOGLE_PROJECT_NUMBER,
	auth: jwtClient,
});

const threeMonthsOut = new Date();
threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);

const fourMonthsOut = new Date();
fourMonthsOut.setMonth(fourMonthsOut.getMonth() + 4);

const googleResponse = await calendar.events.list({
	calendarId: GOOGLE_CALENDAR_ID,
	timeMin: new Date().toISOString(),
	timeMax: fourMonthsOut.toISOString(),
	singleEvents: true,
	orderBy: "startTime",
	maxResults: 2499,
});

const googleEvents = googleResponse.data.items;

//if there are more than 2498, Google will paginate them, meaning we don't know if one exists several months
//out. Abandon sync.
if (!googleEvents || googleEvents.length === 0 || googleEvents.length > 2498) {
	//google events didn't sync. we shouldn't try to create any new items
	console.log("Google events didn't sync. Exiting.");
	process.exit();
}

const windowsToIANA = {
	"Eastern Standard Time": "America/New_York",
	"Central Standard Time": "America/Chicago",
	"Pacific Standard Time": "America/Los_Angeles",
	"Mountain Standard Time": "America/Denver",
	"Atlantic Standard Time": "America/Halifax",
	"US Eastern Standard Time": "America/Indiana/Indianapolis",
	"US Mountain Standard Time": "America/Phoenix",
	UTC: "UTC",
};

//rrule generates dates at a fixed UTC offset, ignoring DST transitions.
//this corrects each occurrence to preserve the original local time.
function fixOccurrenceTime(occDate, eventStart, tz) {
	const ianaZone = windowsToIANA[tz] || tz;
	if (!ianaZone) return occDate;
	const originalLocal = DateTime.fromJSDate(new Date(eventStart), { zone: ianaZone });
	const occInZone = DateTime.fromJSDate(occDate, { zone: ianaZone });
	return occInZone
		.set({ hour: originalLocal.hour, minute: originalLocal.minute, second: 0, millisecond: 0 })
		.toJSDate();
}

//the ical library mishandles DST for Windows timezone names.
//extract raw local times from ICS text to bypass the broken conversion.
function extractLocalTimes(icsText) {
	const map = {};
	icsText = icsText.replace(/\r?\n[ \t]/g, ""); //unfold ICS line continuations
	const blocks = icsText.split("BEGIN:VEVENT");
	for (const block of blocks) {
		const uidMatch = block.match(/^UID:(.+?)\r?$/m);
		const dtstartMatch = block.match(/^DTSTART;TZID=([^:]+):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\r?$/m);
		const dtendMatch = block.match(/^DTEND;TZID=([^:]+):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\r?$/m);
		if (block.match(/^RECURRENCE-ID/m)) continue;
		if (uidMatch && dtstartMatch) {
			const tz = dtstartMatch[1].trim();
			const ianaZone = windowsToIANA[tz] || tz;
			const startHour = parseInt(dtstartMatch[5]);
			const startMinute = parseInt(dtstartMatch[6]);
			let durationMins = 30;
			if (dtendMatch) {
				durationMins = (parseInt(dtendMatch[5]) * 60 + parseInt(dtendMatch[6])) - (startHour * 60 + startMinute);
			}
			map[uidMatch[1].trim()] = { ianaZone, startHour, startMinute, durationMins };
		}
	}
	return map;
}

const res = await fetch(icloudURL);
const webcalText = await res.text();

const events = ical.parseICS(webcalText);

async function handleDocAppt(event) {
	await calendar.events.insert({
		calendarId: GOOGLE_CALENDAR_ID,
		resource: {
			summary: "Doctor",
			start: {
				dateTime: event.start.toISOString(),
			},
			end: {
				dateTime: event.end.toISOString(),
			},
		},
	});

	const thirtyBeforeStart = DateTime.fromJSDate(event.start).plus({
		minutes: -30,
	});

	const thirtyAfterEnd = DateTime.fromJSDate(event.end).plus({
		minutes: 30,
	});

	await calendar.events.insert({
		calendarId: GOOGLE_CALENDAR_ID,
		resource: {
			summary: "Travel",
			start: {
				dateTime: thirtyBeforeStart.toISO(),
			},
			end: {
				dateTime: event.start.toISOString(),
			},
		},
	});

	await calendar.events.insert({
		calendarId: GOOGLE_CALENDAR_ID,
		resource: {
			summary: "Travel",
			start: {
				dateTime: event.end.toISOString(),
			},
			end: {
				dateTime: thirtyAfterEnd.toISO(),
			},
		},
	});
}


console.log("Last run: " + new Date().toISOString());
//safety to prevent bot from running more than intended
fs.writeFileSync("./lastRun.txt", new Date().toISOString());

//tracks all start times that should exist on tuzag from synced sources
const expectedStartTimes = new Set();

// //iCloud => tuzag
async function syncIcloudOccurrence(summary, start, end) {
	const startISO = new Date(start).toISOString();
	const endDate = new Date(end);

	if (start < new Date() || start > threeMonthsOut) return;

	//record expected start times for cleanup
	if (summary.includes("Dr") || summary.includes("Doctor")) {
		expectedStartTimes.add(startISO);
		const thirtyBefore = DateTime.fromJSDate(new Date(start)).plus({ minutes: -30 });
		expectedStartTimes.add(thirtyBefore.toJSDate().toISOString());
		expectedStartTimes.add(endDate.toISOString());
	} else {
		expectedStartTimes.add(startISO);
	}

	const eventAlreadyExists = googleEvents.find((googleEvent) => {
		if (!googleEvent.start.dateTime) return false;
		return new Date(googleEvent.start.dateTime).toISOString() === startISO;
	});
	if (eventAlreadyExists) return;

	if (summary.includes("Dr") || summary.includes("Doctor")) {
		await handleDocAppt({ start: new Date(start), end: endDate });
	} else if (summary.includes("Gym") || summary.includes("Elena Gillis")) {
		await calendar.events.insert({
			calendarId: GOOGLE_CALENDAR_ID,
			resource: {
				summary: "Gym",
				start: { dateTime: startISO },
				end: { dateTime: endDate.toISOString() },
			},
		});
	} else if (summary.includes("buffer")) {
		await calendar.events.insert({
			calendarId: GOOGLE_CALENDAR_ID,
			resource: {
				summary: "Travel",
				start: { dateTime: startISO },
				end: { dateTime: endDate.toISOString() },
			},
		});
	} else {
		await calendar.events.insert({
			calendarId: GOOGLE_CALENDAR_ID,
			resource: {
				summary: "Personal",
				start: { dateTime: startISO },
				end: { dateTime: endDate.toISOString() },
			},
		});
	}
}

for (let k in events) {
	if (events.hasOwnProperty(k)) {
		const event = events[k];
		if (event.type !== "VEVENT") continue;
		if (
			typeof event.summary !== "string" ||
			event.summary.includes("Crash") ||
			event?.start?.dateOnly
		) {
			continue;
		}

		if (event.rrule) {
			const duration = event.end.getTime() - event.start.getTime();
			const occurrences = event.rrule.between(new Date(), threeMonthsOut);
			for (const occDate of occurrences) {
				const dateKey = occDate.toISOString().slice(0, 10);
				const modified = event.recurrences?.[dateKey];
				if (modified) {
					await syncIcloudOccurrence(modified.summary || event.summary, modified.start, modified.end);
				} else {
					const occStart = fixOccurrenceTime(occDate, event.start, event.start.tz);
					const occEnd = new Date(occStart.getTime() + duration);
					await syncIcloudOccurrence(event.summary, occStart, occEnd);
				}
			}
		} else {
			await syncIcloudOccurrence(event.summary, event.start, event.end);
		}
	}
}

// Outlook Outlook => tuzag
const outlookRes = await fetch(outlookURL);
const outlookText = await outlookRes.text();
const outlookEvents = ical.parseICS(outlookText);
const outlookLocalTimes = extractLocalTimes(outlookText);

async function syncOutlookOccurrence(start, end) {
	const startISO = new Date(start).toISOString();

	if (start < new Date() || start > threeMonthsOut) {
		return;
	}

	expectedStartTimes.add(startISO);

	const eventAlreadyExists = googleEvents.find((googleEvent) => {
		if (!googleEvent.start.dateTime) {
			return false;
		}
		return (
			new Date(googleEvent.start.dateTime).toISOString() === startISO
		);
	});

	if (eventAlreadyExists) return;

	await calendar.events.insert({
		calendarId: GOOGLE_CALENDAR_ID,
		resource: {
			summary: "Block",
			start: { dateTime: startISO },
			end: { dateTime: new Date(end).toISOString() },
		},
	});
}

//correct an outlook event's start/end using raw ICS local times
function correctOutlookTime(event) {
	const localInfo = outlookLocalTimes[event.uid];
	if (!localInfo) return { start: event.start, end: event.end };
	const startLocal = DateTime.fromJSDate(new Date(event.start), { zone: "UTC" });
	const correctedStart = DateTime.fromObject(
		{ year: startLocal.year, month: startLocal.month, day: startLocal.day,
		  hour: localInfo.startHour, minute: localInfo.startMinute, second: 0 },
		{ zone: localInfo.ianaZone },
	);
	if (!correctedStart.isValid) return { start: event.start, end: event.end };
	const correctedEnd = correctedStart.plus({ minutes: localInfo.durationMins });
	return { start: correctedStart.toJSDate(), end: correctedEnd.toJSDate() };
}

for (let k in outlookEvents) {
	if (outlookEvents.hasOwnProperty(k)) {
		const event = outlookEvents[k];
		if (
			event.type !== "VEVENT" ||
			typeof event.summary !== "string" ||
			event.summary.includes("Gym")
		) {
			continue;
		}

		if (event.rrule) {
			const localInfo = outlookLocalTimes[event.uid];
			const duration = event.end.getTime() - event.start.getTime();
			const occurrences = event.rrule.between(new Date(), threeMonthsOut);
			for (const occDate of occurrences) {
				const dateKey = occDate.toISOString().slice(0, 10);
				const modified = event.recurrences?.[dateKey];
				if (modified) {
					const corrected = correctOutlookTime(modified);
					await syncOutlookOccurrence(corrected.start, corrected.end);
				} else if (localInfo) {
					//use raw local time from ICS with correct IANA timezone
					const occUTC = DateTime.fromJSDate(occDate, { zone: "UTC" });
					const correctedStart = DateTime.fromObject(
						{ year: occUTC.year, month: occUTC.month, day: occUTC.day,
						  hour: localInfo.startHour, minute: localInfo.startMinute, second: 0 },
						{ zone: localInfo.ianaZone },
					);
					const correctedEnd = correctedStart.plus({ minutes: localInfo.durationMins });
					await syncOutlookOccurrence(correctedStart.toJSDate(), correctedEnd.toJSDate());
				} else {
					const occStart = fixOccurrenceTime(occDate, event.start, event.start.tz);
					const occEnd = new Date(occStart.getTime() + duration);
					await syncOutlookOccurrence(occStart, occEnd);
				}
			}
		} else if (!event?.start?.dateOnly) {
			const corrected = correctOutlookTime(event);
			await syncOutlookOccurrence(corrected.start, corrected.end);
		}
	}
}

//delete tuzag events that no longer have a matching source event
const syncedSummaries = new Set(["Block", "Personal", "Doctor", "Gym", "Travel"]);
for (const ge of googleEvents) {
	if (syncedSummaries.has(ge.summary) && ge.start.dateTime) {
		const startISO = new Date(ge.start.dateTime).toISOString();
		if (!expectedStartTimes.has(startISO)) {
			console.log(`Deleting orphaned: ${ge.summary} @ ${ge.start.dateTime}`);
			await calendar.events.delete({
				calendarId: GOOGLE_CALENDAR_ID,
				eventId: ge.id,
			});
		}
	}
}

console.log("Done syncing: " + new Date().toISOString());

//handle crash as a graceful shutdown so pm2 will continue running the cron job
process.on("SIGINT", (signal) => {
	console.error(signal);
	console.log("SIGINT");
	process.exit();
});
