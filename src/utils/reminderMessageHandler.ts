import type { Message } from "discord.js";
import { reminderService } from "../services/ReminderService";
import { logError, logInfo } from "./logger";
import { formatReminderDateTime, parseReminderText } from "./reminderParser";

const MENTION_TRIGGER_REGEX =
	/^(?:remind|リマインド|リマインダー)\s*[:：]?\s*/iu;
const ANY_REMINDER_TRIGGER_REGEX = /(?:remind|リマインド|リマインダー)/iu;

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
			buildRegisteredMessage(parsed.remindAt, parsed.message),
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

function buildRegisteredMessage(
	remindAt: Date,
	reminderMessage: string,
): string {
	return `${formatReminderDateTime(remindAt)} に「${reminderMessage}」をリマインドします！`;
}

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
