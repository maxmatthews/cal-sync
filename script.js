import ical from "ical";
import { google } from "googleapis";
import { DateTime } from "luxon";
import auth from "./googleCalendarCredentials.json" assert { type: "json" };
import icloudURL from "./iCloudCalURL.js";

const SCOPES = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_PRIVATE_KEY = auth.private_key;
const GOOGLE_CLIENT_EMAIL = auth.client_email;
const GOOGLE_PROJECT_NUMBER = auth.project_id;
const GOOGLE_CALENDAR_ID = "max.matthews@wearetuzag.com";

const jwtClient = new google.auth.JWT(
	GOOGLE_CLIENT_EMAIL,
	null,
	GOOGLE_PRIVATE_KEY,
	SCOPES
);

const calendar = google.calendar({
	version: "v3",
	project: GOOGLE_PROJECT_NUMBER,
	auth: jwtClient,
});

const googleResponse = await calendar.events.list({
	calendarId: GOOGLE_CALENDAR_ID,
	timeMin: new Date().toISOString(),
	singleEvents: true,
	orderBy: "startTime",
});

const googleEvents = googleResponse.data.items;

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

async function handleGymAppt(event) {
	await calendar.events.insert({
		calendarId: GOOGLE_CALENDAR_ID,
		resource: {
			summary: event.summary,
			start: {
				dateTime: event.start.toISOString(),
			},
			end: {
				dateTime: event.end.toISOString(),
			},
		},
	});

	const fifteenBeforeStart = DateTime.fromJSDate(event.start).plus({
		minutes: -15,
	});

	const fifteenAfterEnd = DateTime.fromJSDate(event.end).plus({
		minutes: 15,
	});

	await calendar.events.insert({
		calendarId: GOOGLE_CALENDAR_ID,
		resource: {
			summary: "Travel",
			start: {
				dateTime: fifteenBeforeStart.toISO(),
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
				dateTime: fifteenAfterEnd.toISO(),
			},
		},
	});
}

// //iCloud => tuzag
for (let k in events) {
	if (events.hasOwnProperty(k)) {
		const event = events[k];
		if (events[k].type === "VEVENT") {
			const eventAlreadyExists = googleEvents.find((googleEvent) => {
				if (!googleEvent.start.dateTime) {
					//filter out all day events
					return false;
				}
				return (
					new Date(googleEvent.start.dateTime).toISOString() ===
					new Date(event.start).toISOString()
				);
			});

			if (
				event.start < new Date() || //date in past
				event?.start?.dateOnly || //all day event
				eventAlreadyExists //already synced this event
			) {
				continue;
			} else if (
				event.summary.includes("Dr") ||
				event.summary.includes("Doctor")
			) {
				await handleDocAppt(event);
			} else if (event.summary === "Gym") {
				await handleGymAppt(event);
			} else {
				await calendar.events.insert({
					calendarId: GOOGLE_CALENDAR_ID,
					resource: {
						summary: "Personal",
						start: {
							dateTime: event.start.toISOString(),
						},
						end: {
							dateTime: event.end.toISOString(),
						},
					},
				});
			}
		}
	}
}

const googleHUResponse = await calendar.events.list({
	calendarId: "maxm@hackupstate.com",
	timeMin: new Date().toISOString(),
	singleEvents: true,
	orderBy: "startTime",
});

const huEvents = googleHUResponse.data.items;

for (const event of huEvents) {
	const eventAlreadyExists = googleEvents.find((googleEvent) => {
		if (!googleEvent.start.dateTime || !event.start.dateTime) {
			//filter out all day events
			return false;
		}
		return (
			new Date(googleEvent.start.dateTime).toISOString() ===
			new Date(event.start.dateTime).toISOString()
		);
	});

	const monthsAway = DateTime.fromISO(event.start.dateTime)
		.diff(DateTime.now(), "months")
		.toObject().months;

	if (
		event.start < new Date() || //date in past
		(event?.start.date && !event?.start.dateTime) || //all day event
		monthsAway > 3 ||
		eventAlreadyExists //already synced this event
	) {
		continue;
	} else {
		await calendar.events.insert({
			calendarId: GOOGLE_CALENDAR_ID,
			resource: {
				summary: "CiC",
				start: event.start,
				end: event.end,
			},
		});
	}
}
