import type { Message } from "discord.js";
import {
	MAX_PENDING_REMINDERS_PER_USER,
	reminderService,
} from "../services/ReminderService";
import { logError, logInfo } from "./logger";
import type { ReminderMentionAction } from "./mentionIntentClassifier";
import {
	buildReminderCanceledMessage,
	buildReminderEditedMessage,
	buildReminderListMessage,
	buildReminderRegisteredMessage,
} from "./reminderFormatter";
import { parseReminderEditText, parseReminderText } from "./reminderParser";

type MentionReply = (content: string) => Promise<void>;

export async function handleReminderMentionAction(
	message: Message,
	action: ReminderMentionAction,
	reply: MentionReply,
): Promise<void> {
	if (action.type === "list") {
		const reminders = reminderService.listPendingForUser(
			message.author.id,
			message.guildId,
		);
		await reply(buildReminderListMessage(reminders));
		return;
	}

	if (action.type === "cancel") {
		await handleReminderCancel(message, action, reply);
		return;
	}

	if (action.type === "edit") {
		await handleReminderEdit(message, action, reply);
		return;
	}

	await handleReminderCreate(message, action.text, reply);
}

async function handleReminderCancel(
	message: Message,
	action: Extract<ReminderMentionAction, { type: "cancel" }>,
	reply: MentionReply,
): Promise<void> {
	const targetReminder = resolveReminderTarget(
		action,
		message.author.id,
		message.guildId,
	);

	if (targetReminder === "ambiguous") {
		await reply(
			"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
		);
		return;
	}
	if (targetReminder === "not_found") {
		await reply("キャンセルするリマインダーが見つかりませんでした。");
		return;
	}

	const result = await reminderService.cancelPendingForUser(
		targetReminder.id,
		message.author.id,
		message.guildId,
	);

	switch (result) {
		case "canceled":
			await reply(buildReminderCanceledMessage(targetReminder.id));
			logInfo(
				`Reminder canceled by mention from ${message.author.username}: ${targetReminder.id}`,
			);
			return;
		case "ambiguous":
			await reply(
				"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
			);
			return;
		case "not_found":
			await reply("そのIDのリマインダーは見つかりませんでした。");
			return;
	}
}

async function handleReminderEdit(
	message: Message,
	action: Extract<ReminderMentionAction, { type: "edit" }>,
	reply: MentionReply,
): Promise<void> {
	const targetReminder = resolveReminderTarget(
		action,
		message.author.id,
		message.guildId,
	);

	if (targetReminder === "ambiguous") {
		await reply(
			"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
		);
		return;
	}
	if (targetReminder === "not_found") {
		await reply("編集するリマインダーが見つかりませんでした。");
		return;
	}

	if (!action.text.trim()) {
		await reply(
			"変更内容を指定してください。例: `@bot さっきの予約を明日の9時に変更`",
		);
		return;
	}

	try {
		const parsed = await parseReminderEditText(action.text, new Date(), {
			remindAt: new Date(targetReminder.remindAt),
			message: targetReminder.message,
		});
		if (!parsed.ok) {
			await reply(buildParseFailureMessage(parsed.reason, parsed.question));
			return;
		}

		const result = await reminderService.editPendingForUser(
			targetReminder.id,
			message.author.id,
			message.guildId,
			{
				remindAt: parsed.remindAt,
				message: parsed.message,
				repeat: parsed.repeat,
				clearRepeat: parsed.clearRepeat,
			},
		);

		switch (result.status) {
			case "edited":
				await reply(buildReminderEditedMessage(result.reminder));
				logInfo(
					`Reminder edited by mention from ${message.author.username}: ${targetReminder.id}`,
				);
				return;
			case "ambiguous":
				await reply(
					"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
				);
				return;
			case "not_found":
				await reply("そのIDに一致するリマインダーは見つかりませんでした。");
				return;
		}
	} catch (error) {
		logError(`Error editing reminder by mention: ${error}`);
		await reply("リマインダーの編集中にエラーが発生しました。");
	}
}

async function handleReminderCreate(
	message: Message,
	reminderText: string,
	reply: MentionReply,
): Promise<void> {
	if (!reminderText.trim()) {
		await reply(
			"リマインド内容を指定してください。例: `@bot 明日の9時に燃えるゴミをリマインドして`",
		);
		return;
	}

	try {
		const parsed = await parseReminderText(reminderText);
		if (!parsed.ok) {
			await reply(buildParseFailureMessage(parsed.reason, parsed.question));
			return;
		}

		const createResult = await reminderService.create({
			guildId: message.guildId,
			channelId: message.channelId,
			userId: message.author.id,
			remindAt: parsed.remindAt,
			message: parsed.message,
			repeat: parsed.repeat,
			source: "mention",
		});

		if (createResult.status === "limit_exceeded") {
			await reply(
				`未完了のリマインダーは1人${MAX_PENDING_REMINDERS_PER_USER}件までです。不要なリマインダーをキャンセルしてください。`,
			);
			return;
		}

		await reply(
			buildReminderRegisteredMessage(
				parsed.remindAt,
				parsed.message,
				parsed.repeat,
			),
		);
		logInfo(
			`Reminder registered by mention from ${message.author.username}: ${parsed.remindAt.toISOString()} "${parsed.message}"`,
		);
	} catch (error) {
		logError(`Error handling reminder mention: ${error}`);
		await reply("リマインダー登録中にエラーが発生しました。");
	}
}

function resolveReminderTarget(
	action: { id?: string; useLatest?: boolean },
	userId: string,
	guildId: string | null,
) {
	if (action.id) {
		return reminderService.findPendingForUser(action.id, userId, guildId);
	}
	if (action.useLatest) {
		return (
			reminderService.getLatestPendingForUser(userId, guildId) ?? "not_found"
		);
	}
	return "not_found";
}

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
