import type { Reminder } from "../services/ReminderService";
import { formatReminderDateTime } from "./reminderParser";

const REMINDER_ID_LENGTH = 8;

function formatReminderId(reminder: Reminder): string {
	return reminder.id.slice(0, REMINDER_ID_LENGTH);
}

export function buildReminderRegisteredMessage(
	remindAt: Date,
	message: string,
): string {
	return `${formatReminderDateTime(remindAt)} に「${message}」をリマインドします！`;
}

export function buildReminderListMessage(reminders: Reminder[]): string {
	if (reminders.length === 0) {
		return "登録中のリマインダーはありません。";
	}

	const lines = reminders.map((reminder) => {
		const remindAt = formatReminderDateTime(new Date(reminder.remindAt));
		return `\`${formatReminderId(reminder)}\` ${remindAt} - ${reminder.message}`;
	});

	return `登録中のリマインダー:\n${lines.join("\n")}`;
}

export function buildReminderCanceledMessage(idPrefix: string): string {
	return `リマインダー \`${idPrefix}\` をキャンセルしました。`;
}

export function buildReminderEditedMessage(reminder: Reminder): string {
	const remindAt = formatReminderDateTime(new Date(reminder.remindAt));
	return `リマインダー \`${formatReminderId(reminder)}\` を更新しました。\n${remindAt} に「${reminder.message}」をリマインドします！`;
}
