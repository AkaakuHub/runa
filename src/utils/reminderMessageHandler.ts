import type { Message } from "discord.js";
import { reminderService } from "../services/ReminderService";
import { logError, logInfo } from "./logger";
import {
	buildReminderCanceledMessage,
	buildReminderListMessage,
	buildReminderRegisteredMessage,
} from "./reminderFormatter";
import { parseReminderText } from "./reminderParser";

const ANY_REMINDER_TRIGGER_REGEX = /(?:remind|リマインド|リマインダー)/iu;
const REMINDER_WORD_REGEX = /(?:remind|リマインド|リマインダー)/giu;
const LIST_WORD_REGEX = /(?:list|リスト|一覧|確認|表示)/iu;
const CANCEL_WORD_REGEX = /(?:cancel|キャンセル|削除|取消|取り消し)/iu;
const ID_REGEX = /`?([0-9a-f]{4,}(?:-[0-9a-f-]+)?)`?/iu;

type ReminderMentionAction =
	| { type: "list" }
	| { type: "cancel"; id: string }
	| { type: "create"; text: string };

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

	const action = detectReminderMentionAction(contentWithoutMention);

	if (action.type === "list") {
		const reminders = reminderService.listPendingForUser(
			message.author.id,
			message.guildId,
		);
		await message.reply(buildReminderListMessage(reminders));
		return true;
	}

	if (action.type === "cancel") {
		const id = action.id;
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

	const reminderText = action.text;
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

function detectReminderMentionAction(content: string): ReminderMentionAction {
	const normalized = content.trim();

	if (LIST_WORD_REGEX.test(normalized)) {
		return { type: "list" };
	}

	if (CANCEL_WORD_REGEX.test(normalized)) {
		const id = normalized.match(ID_REGEX)?.[1];
		if (id) {
			return { type: "cancel", id };
		}
	}

	return {
		type: "create",
		text: normalized.replace(REMINDER_WORD_REGEX, "").trim(),
	};
}

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
