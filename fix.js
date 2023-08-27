import auth from "./googleCalendarCredentials.json" assert { type: "json" };
import { google } from "googleapis";
import { Queue, Worker, QueueEvents } from "bullmq";

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

const queue = new Queue("google-calendar-sync");

try {
	await queue.obliterate();
} catch (e) {}

const getEvents = async () => {
	console.log("Starting to get events");
	const googleResponse = await calendar.events.list({
		calendarId: GOOGLE_CALENDAR_ID,
		timeMin: new Date().toISOString(),
		singleEvents: true,
		orderBy: "startTime",
	});
	console.log("Events retrieved");

	return googleResponse.data.items;
};

const keysToDelete = ["Personal", "Gym", "Travel", "Doctor", "CiC"];

let lastJob;
const processEvents = async (googleEvents) => {
	console.log("Events queueing");
	for (const event of googleEvents) {
		if (keysToDelete.includes(event.summary)) {
			lastJob = await queue.add("google-calendar-sync", event);
		}
	}
	console.log("Events queued");
};

const worker = new Worker(
	"google-calendar-sync",
	async (job) => {
		const event = job.data;
		console.log(event.id, event?.start);
		const response = await calendar.events.delete({
			calendarId: GOOGLE_CALENDAR_ID,
			eventId: event.id,
		});
	},
	{
		limiter: {
			max: 4,
			duration: 1000,
		},
	}
);

worker.on("completed", async (job) => {
	if (job.id === lastJob?.id) {
		console.log("Last job completed");
		const eventsRound2 = await getEvents();
		const toDelete = eventsRound2.filter((event) => {
			return keysToDelete.includes(event.summary);
		});

		if (toDelete.length !== 0) {
			await processEvents(toDelete);
		} else {
			process.exit();
		}
	}
});

processEvents(await getEvents());
