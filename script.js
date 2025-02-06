import ical from "ical";
import {google} from "googleapis";
import {DateTime} from "luxon";
import auth from "./googleCalendarCredentials.json" assert {type: "json"};
import icloudURL from "./iCloudCalURL.js";
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
			summary: "Gym",
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

console.log("Last run: " + new Date().toISOString());
//safety to prevent bot from running more than intended
fs.writeFileSync("./lastRun.txt", new Date().toISOString());
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
				event.start > threeMonthsOut || //event more than 90 days out
				eventAlreadyExists //already synced this event
			) {
				// continue;
			} else if (
				event.summary.includes("Dr") ||
				event.summary.includes("Doctor")
			) {
				await handleDocAppt(event);
			} else if (
				event.summary.includes("Gym") ||
				event.summary.includes("Elena Gillis")
			) {
				await handleGymAppt(event);
			} else if (event.summary.includes("Crash")) {
				//ignore
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
	timeMax: threeMonthsOut.toISOString(),
	singleEvents: true,
	orderBy: "startTime",
	maxResults: 2499,
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
		// continue;
	} else if (
		event.summary === "Gym" ||
		event.summary.includes("Elena Gillis")
	) {
		await handleGymAppt({
			start: new Date(event.start.dateTime),
			end: new Date(event.end.dateTime),
		});
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

console.log("Done syncing: " + new Date().toISOString());

//handle crash as a graceful shutdown so pm2 will continue running the cron job
process.on("SIGINT", (signal) => {
	console.error(signal);
	console.log("SIGINT");
	process.exit();
});
