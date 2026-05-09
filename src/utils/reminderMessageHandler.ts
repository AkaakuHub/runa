import type { Message } from "discord.js";
import { reminderService } from "../services/ReminderService";
import { logError, logInfo } from "./logger";
import {
	buildReminderCanceledMessage,
	buildReminderListMessage,
	buildReminderRegisteredMessage,
} from "./reminderFormatter";
import { parseReminderText } from "./reminderParser";

const MENTION_TRIGGER_REGEX =
	/^(?:remind|リマインド|リマインダー)\s*[:：]?\s*/iu;
const ANY_REMINDER_TRIGGER_REGEX = /(?:remind|リマインド|リマインダー)/iu;
const LIST_REGEX =
	/^(?:(?:remind|リマインド|リマインダー)\s*)?(?:list|一覧)$/iu;
const CANCEL_REGEX =
	/^(?:(?:remind|リマインド|リマインダー)\s*)?(?:cancel|キャンセル|削除|取消)\s+`?([0-9a-f-]+)`?$/iu;

export async function handleReminderMention(
	message: Message,
): Promise<boolean> {
	const botUser = message.client.user;
	if (!botUser || !message.mentions.has(botUser)) {
		return false;
	}

	const contentWithoutMention = message.content
		.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "")
		.trim();

	if (!ANY_REMINDER_TRIGGER_REGEX.test(contentWithoutMention)) {
		return false;
	}

	if (LIST_REGEX.test(contentWithoutMention)) {
		const reminders = reminderService.listPendingForUser(
			message.author.id,
			message.guildId,
		);
		await message.reply(buildReminderListMessage(reminders));
		return true;
	}

	const cancelMatch = contentWithoutMention.match(CANCEL_REGEX);
	if (cancelMatch) {
		const id = cancelMatch[1];
		const result = await reminderService.cancelPendingForUser(
			id,
			message.author.id,
			message.guildId,
		);

		switch (result) {
			case "canceled":
				await message.reply(buildReminderCanceledMessage(id));
				logInfo(
					`Reminder canceled by mention from ${message.author.username}: ${id}`,
				);
				return true;
			case "ambiguous":
				await message.reply(
					"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
				);
				return true;
			case "not_found":
				await message.reply("そのIDのリマインダーは見つかりませんでした。");
				return true;
		}
	}

	const reminderText = contentWithoutMention.replace(MENTION_TRIGGER_REGEX, "");
	if (!reminderText.trim()) {
		await message.reply(
			"リマインド内容を指定してください。例: `@bot remind 明日の9時に燃えるゴミ`",
		);
		return true;
	}

	try {
		const parsed = await parseReminderText(reminderText);
		if (!parsed.ok) {
			await message.reply(
				buildParseFailureMessage(parsed.reason, parsed.question),
			);
			return true;
		}

		await reminderService.create({
			guildId: message.guildId,
			channelId: message.channelId,
			userId: message.author.id,
			remindAt: parsed.remindAt,
			message: parsed.message,
			source: "mention",
		});

		await message.reply(
			buildReminderRegisteredMessage(parsed.remindAt, parsed.message),
		);
		logInfo(
			`Reminder registered by mention from ${message.author.username}: ${parsed.remindAt.toISOString()} "${parsed.message}"`,
		);
		return true;
	} catch (error) {
		logError(`Error handling reminder mention: ${error}`);
		await message.reply("リマインダー登録中にエラーが発生しました。");
		return true;
	}
}

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
