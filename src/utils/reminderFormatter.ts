import type { Reminder } from "../services/ReminderService";
import { formatReminderDateTime } from "./reminderParser";
import type { ReminderRepeatRule } from "./reminderRecurrence";

const REMINDER_ID_LENGTH = 8;
const JST_TIME_ZONE = "Asia/Tokyo";

function formatReminderId(reminder: Reminder): string {
	return reminder.id.slice(0, REMINDER_ID_LENGTH);
}

function formatReminderTime(date: Date): string {
	return new Intl.DateTimeFormat("ja-JP", {
		timeZone: JST_TIME_ZONE,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

function formatReminderWeekday(date: Date): string {
	return new Intl.DateTimeFormat("ja-JP", {
		timeZone: JST_TIME_ZONE,
		weekday: "short",
	}).format(date);
}

function formatReminderSchedule(
	remindAt: Date,
	repeat?: ReminderRepeatRule,
): string {
	if (!repeat) return formatReminderDateTime(remindAt);

	switch (repeat.frequency) {
		case "daily":
			return `毎日${formatReminderTime(remindAt)}`;
		case "weekly":
			return `毎週${formatReminderWeekday(remindAt)}${formatReminderTime(remindAt)}`;
		case "interval":
			return `${repeat.intervalMinutes}分ごと（${formatReminderDateTime(remindAt)}から${formatReminderDateTime(new Date(repeat.until))}まで）`;
	}
}

export function buildReminderRegisteredMessage(
	remindAt: Date,
	message: string,
	repeat?: ReminderRepeatRule,
): string {
	return `${formatReminderSchedule(remindAt, repeat)} に「${message}」をリマインドします！`;
}

export function buildReminderListMessage(reminders: Reminder[]): string {
	if (reminders.length === 0) {
		return "登録中のリマインダーはありません。";
	}

	const lines = reminders.map((reminder) => {
		const remindAt = new Date(reminder.remindAt);
		const schedule = formatReminderSchedule(remindAt, reminder.repeat);
		return `\`${formatReminderId(reminder)}\` ${schedule} - ${reminder.message}`;
	});

	return `登録中のリマインダー:\n${lines.join("\n")}`;
}

export function buildReminderCanceledMessage(idPrefix: string): string {
	return `リマインダー \`${idPrefix}\` をキャンセルしました。`;
}

export function buildReminderEditedMessage(reminder: Reminder): string {
	const remindAt = new Date(reminder.remindAt);
	return `リマインダー \`${formatReminderId(reminder)}\` を更新しました。\n${formatReminderSchedule(remindAt, reminder.repeat)} に「${reminder.message}」をリマインドします！`;
}
