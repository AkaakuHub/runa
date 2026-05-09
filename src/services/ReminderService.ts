import { randomUUID } from "node:crypto";
import path from "node:path";
import { readJsonFileSync, writeJsonFile } from "../utils/jsonFile";
import { logError } from "../utils/logger";

type ReminderSource = "slash" | "mention";

export interface Reminder {
	id: string;
	guildId: string | null;
	channelId: string;
	userId: string;
	remindAt: string;
	message: string;
	source: ReminderSource;
	createdAt: string;
	deliveredAt?: string;
	canceledAt?: string;
}

interface CreateReminderParams {
	guildId: string | null;
	channelId: string;
	userId: string;
	remindAt: Date;
	message: string;
	source: ReminderSource;
}

class ReminderService {
	private readonly filePath = path.join(
		process.cwd(),
		"data",
		"reminders.json",
	);
	private reminders: Reminder[];
	private saveQueue: Promise<void> = Promise.resolve();

	constructor() {
		this.reminders = readJsonFileSync<Reminder[]>(this.filePath, []);
	}

	create(params: CreateReminderParams): Promise<Reminder> {
		const reminder: Reminder = {
			id: randomUUID(),
			guildId: params.guildId,
			channelId: params.channelId,
			userId: params.userId,
			remindAt: params.remindAt.toISOString(),
			message: params.message,
			source: params.source,
			createdAt: new Date().toISOString(),
		};

		this.reminders.push(reminder);
		return this.save().then(() => reminder);
	}

	getDueReminders(now: Date = new Date()): Reminder[] {
		const nowTime = now.getTime();
		return this.reminders.filter((reminder) => {
			if (reminder.deliveredAt) return false;
			if (reminder.canceledAt) return false;
			return new Date(reminder.remindAt).getTime() <= nowTime;
		});
	}

	listPendingForUser(userId: string, guildId: string | null): Reminder[] {
		return this.reminders
			.filter((reminder) => {
				if (reminder.userId !== userId) return false;
				if (reminder.guildId !== guildId) return false;
				if (reminder.deliveredAt || reminder.canceledAt) return false;
				return true;
			})
			.sort(
				(a, b) =>
					new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime(),
			);
	}

	async cancelPendingForUser(
		idPrefix: string,
		userId: string,
		guildId: string | null,
		canceledAt: Date = new Date(),
	): Promise<"canceled" | "not_found" | "ambiguous"> {
		const normalizedPrefix = idPrefix.trim().toLowerCase();
		if (!normalizedPrefix) return "not_found";

		const matches = this.listPendingForUser(userId, guildId).filter(
			(reminder) => reminder.id.toLowerCase().startsWith(normalizedPrefix),
		);

		if (matches.length === 0) return "not_found";
		if (matches.length > 1) return "ambiguous";

		matches[0].canceledAt = canceledAt.toISOString();
		await this.save();
		return "canceled";
	}

	async markDelivered(
		id: string,
		deliveredAt: Date = new Date(),
	): Promise<void> {
		const reminder = this.reminders.find((item) => item.id === id);
		if (!reminder) return;

		reminder.deliveredAt = deliveredAt.toISOString();
		await this.save();
	}

	private async save(): Promise<void> {
		this.saveQueue = this.saveQueue
			.then(() => writeJsonFile(this.filePath, this.reminders))
			.catch((error) => {
				logError(`Failed to save reminders: ${error}`);
			});

		return this.saveQueue;
	}
}

export const reminderService = new ReminderService();
