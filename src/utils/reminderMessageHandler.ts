import type { Message } from "discord.js";
import { reminderService } from "../services/ReminderService";
import { logError, logInfo } from "./logger";
import {
	buildReminderCanceledMessage,
	buildReminderEditedMessage,
	buildReminderListMessage,
	buildReminderRegisteredMessage,
} from "./reminderFormatter";
import { parseReminderEditText, parseReminderText } from "./reminderParser";

const ANY_REMINDER_TRIGGER_REGEX = /(?:remind|リマインド|リマインダー|予約)/iu;
const REMINDER_WORD_REGEX = /(?:remind|リマインド|リマインダー|予約)/giu;
const LIST_WORD_REGEX = /(?:list|リスト|一覧|確認|表示)/iu;
const CANCEL_WORD_REGEX =
	/(?:cancel|キャンセル|削除|取消|取り消し|消して|消す|消したい|解除)/iu;
const EDIT_WORD_REGEX =
	/(?:edit|編集|変更|変えて|修正|じゃなくて|ではなく|にして)/iu;
const LATEST_REFERENCE_REGEX = /(?:さっき|先ほど|さきほど|直近|最後|最新)/iu;
const ID_REGEX = /`?([0-9a-f]{6,}(?:-[0-9a-f-]+)?)`?/iu;

type ReminderMentionAction =
	| { type: "list" }
	| { type: "cancel"; id: string }
	| { type: "edit"; id?: string; useLatest?: boolean; text: string }
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

	if (action.type === "edit") {
		const targetReminder = action.id
			? reminderService.findPendingForUser(
					action.id,
					message.author.id,
					message.guildId,
				)
			: action.useLatest
				? (reminderService.getLatestPendingForUser(
						message.author.id,
						message.guildId,
					) ?? "not_found")
				: "not_found";

		if (targetReminder === "ambiguous") {
			await message.reply(
				"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
			);
			return true;
		}
		if (targetReminder === "not_found") {
			await message.reply("編集するリマインダーが見つかりませんでした。");
			return true;
		}

		if (!action.text.trim()) {
			await message.reply(
				"変更内容を指定してください。例: `@bot リマインド 1234abcd を明日の9時に変更`",
			);
			return true;
		}

		try {
			const parsed = await parseReminderEditText(action.text, new Date(), {
				remindAt: new Date(targetReminder.remindAt),
				message: targetReminder.message,
			});
			if (!parsed.ok) {
				await message.reply(
					buildParseFailureMessage(parsed.reason, parsed.question),
				);
				return true;
			}

			const result = await reminderService.editPendingForUser(
				targetReminder.id,
				message.author.id,
				message.guildId,
				{
					remindAt: parsed.remindAt,
					message: parsed.message,
				},
			);

			switch (result.status) {
				case "edited":
					await message.reply(buildReminderEditedMessage(result.reminder));
					logInfo(
						`Reminder edited by mention from ${message.author.username}: ${targetReminder.id}`,
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
		} catch (error) {
			logError(`Error editing reminder by mention: ${error}`);
			await message.reply("リマインダーの編集中にエラーが発生しました。");
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

	if (EDIT_WORD_REGEX.test(normalized)) {
		const id = normalized.match(ID_REGEX)?.[1];
		if (id) {
			return {
				type: "edit",
				id,
				text: removeReminderControlWords(normalized, id),
			};
		}
		if (LATEST_REFERENCE_REGEX.test(normalized)) {
			return {
				type: "edit",
				useLatest: true,
				text: removeReminderControlWords(normalized),
			};
		}
	}

	return {
		type: "create",
		text: normalized.replace(REMINDER_WORD_REGEX, "").trim(),
	};
}

function removeReminderControlWords(content: string, id?: string): string {
	return content
		.replace(REMINDER_WORD_REGEX, "")
		.replace(LATEST_REFERENCE_REGEX, "")
		.replace(id ?? /^$/u, "")
		.replace(/`/g, "")
		.replace(/^[\sのをに:：、,]+/u, "")
		.replace(/[\sのをに:：、,]+$/u, "")
		.trim();
}

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
