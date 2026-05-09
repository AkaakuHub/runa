import { randomUUID } from "node:crypto";
import path from "node:path";
import { readJsonFileSync, writeJsonFile } from "../utils/jsonFile";
import { logError } from "../utils/logger";

type ReminderSource = "slash" | "mention";

export const MAX_PENDING_REMINDERS_PER_USER = 50;

export interface Reminder {
	id: string;
	guildId: string | null;
	channelId: string;
	userId: string;
	remindAt: string;
	message: string;
	source: ReminderSource;
	createdAt: string;
	updatedAt?: string;
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

interface EditReminderParams {
	remindAt?: Date;
	message?: string;
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

	create(
		params: CreateReminderParams,
	): Promise<
		{ status: "created"; reminder: Reminder } | { status: "limit_exceeded" }
	> {
		if (
			this.listPendingForUser(params.userId, params.guildId).length >=
			MAX_PENDING_REMINDERS_PER_USER
		) {
			return Promise.resolve({ status: "limit_exceeded" });
		}

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
		return this.save().then(() => ({ status: "created", reminder }));
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

	getLatestPendingForUser(
		userId: string,
		guildId: string | null,
	): Reminder | undefined {
		return this.listPendingForUser(userId, guildId).sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		)[0];
	}

	findPendingForUser(
		idPrefix: string,
		userId: string,
		guildId: string | null,
	): "not_found" | "ambiguous" | Reminder {
		const normalizedPrefix = idPrefix.trim().toLowerCase();
		if (!normalizedPrefix) return "not_found";

		const matches = this.listPendingForUser(userId, guildId).filter(
			(reminder) => reminder.id.toLowerCase().startsWith(normalizedPrefix),
		);

		if (matches.length === 0) return "not_found";
		if (matches.length > 1) return "ambiguous";
		return matches[0];
	}

	async cancelPendingForUser(
		idPrefix: string,
		userId: string,
		guildId: string | null,
		canceledAt: Date = new Date(),
	): Promise<"canceled" | "not_found" | "ambiguous"> {
		const reminder = this.findPendingForUser(idPrefix, userId, guildId);

		if (reminder === "not_found") return "not_found";
		if (reminder === "ambiguous") return "ambiguous";

		reminder.canceledAt = canceledAt.toISOString();
		await this.save();
		return "canceled";
	}

	async editPendingForUser(
		idPrefix: string,
		userId: string,
		guildId: string | null,
		params: EditReminderParams,
		updatedAt: Date = new Date(),
	): Promise<
		| { status: "edited"; reminder: Reminder }
		| { status: "not_found" }
		| { status: "ambiguous" }
	> {
		const reminder = this.findPendingForUser(idPrefix, userId, guildId);

		if (reminder === "not_found") return { status: "not_found" };
		if (reminder === "ambiguous") return { status: "ambiguous" };
		if (params.remindAt) {
			reminder.remindAt = params.remindAt.toISOString();
		}
		if (params.message) {
			reminder.message = params.message;
		}
		reminder.updatedAt = updatedAt.toISOString();
		await this.save();

		return { status: "edited", reminder };
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
