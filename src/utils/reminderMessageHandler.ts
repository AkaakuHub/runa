import type { Message } from "discord.js";
import {
	MAX_PENDING_REMINDERS_PER_USER,
	reminderService,
} from "../services/ReminderService";
import { logError, logInfo } from "./logger";
import {
	buildReminderCanceledMessage,
	buildReminderEditedMessage,
	buildReminderListMessage,
	buildReminderRegisteredMessage,
} from "./reminderFormatter";
import { parseReminderEditText, parseReminderText } from "./reminderParser";
import { generateAiTextWithUsage } from "./useAI";

type ReminderMentionAction =
	| { type: "none" }
	| { type: "list" }
	| { type: "cancel"; id?: string; useLatest?: boolean }
	| { type: "edit"; id?: string; useLatest?: boolean; text: string }
	| { type: "create"; text: string };

interface AiReminderMentionAction {
	action?: "none" | "list" | "cancel" | "edit" | "create";
	id?: string | null;
	useLatest?: boolean;
	text?: string | null;
	confidence?: number;
}

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

	if (!contentWithoutMention) {
		return false;
	}

	const action = await detectReminderMentionAction(contentWithoutMention);
	if (action.type === "none") {
		return false;
	}

	if (action.type === "list") {
		const reminders = reminderService.listPendingForUser(
			message.author.id,
			message.guildId,
		);
		await message.reply(buildReminderListMessage(reminders));
		return true;
	}

	if (action.type === "cancel") {
		const targetReminder = resolveReminderTarget(
			action,
			message.author.id,
			message.guildId,
		);

		if (targetReminder === "ambiguous") {
			await message.reply(
				"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
			);
			return true;
		}
		if (targetReminder === "not_found") {
			await message.reply("キャンセルするリマインダーが見つかりませんでした。");
			return true;
		}

		const result = await reminderService.cancelPendingForUser(
			targetReminder.id,
			message.author.id,
			message.guildId,
		);

		switch (result) {
			case "canceled":
				await message.reply(buildReminderCanceledMessage(targetReminder.id));
				logInfo(
					`Reminder canceled by mention from ${message.author.username}: ${targetReminder.id}`,
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
		const targetReminder = resolveReminderTarget(
			action,
			message.author.id,
			message.guildId,
		);

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
				"変更内容を指定してください。例: `@bot さっきの予約を明日の9時に変更`",
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
			"リマインド内容を指定してください。例: `@bot 明日の9時に燃えるゴミをリマインドして`",
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

		const createResult = await reminderService.create({
			guildId: message.guildId,
			channelId: message.channelId,
			userId: message.author.id,
			remindAt: parsed.remindAt,
			message: parsed.message,
			source: "mention",
		});

		if (createResult.status === "limit_exceeded") {
			await message.reply(
				`未完了のリマインダーは1人${MAX_PENDING_REMINDERS_PER_USER}件までです。不要なリマインダーをキャンセルしてください。`,
			);
			return true;
		}

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

async function detectReminderMentionAction(
	content: string,
): Promise<ReminderMentionAction> {
	try {
		const aiAction = await classifyReminderMentionAction(content);
		return normalizeReminderMentionAction(aiAction);
	} catch (error) {
		logError(`Reminder mention action classification failed: ${error}`);
		return { type: "none" };
	}
}

async function classifyReminderMentionAction(
	content: string,
): Promise<AiReminderMentionAction> {
	const prompt = `あなたはDiscord botへのメンション文を、リマインダー操作に分類するルーターです。
入力文がリマインダー、予約、予定通知に関する操作なら action を選び、関係なければ none にしてください。

重要:
- 出力はJSONオブジェクトのみ。Markdownや説明文は禁止。
- 実際の登録、編集、削除は行わない。分類だけを行う。
- 「今のリマインドは」「予約どうなってる」「登録中の予定は」など状態確認は list。
- 「消して」「削除」「キャンセル」「取り消して」などは cancel。
- 「変えて」「変更」「編集」「じゃなくて」「にして」などは edit。
- 「さっきの」「先ほどの」「直近の」「最新の」「今の予約」は useLatest true。
- 8文字前後以上の英数字IDがあれば id に入れる。バッククォートは除く。
- create/edit の text は、後段パーサーに渡す自然文として必要な内容だけを残す。
- edit で「9時じゃなくて5時にして」のような比較表現は、text にそのまま残す。
- cancel/list では text は null。

JSONスキーマ:
{
  "action": "none" | "list" | "cancel" | "edit" | "create",
  "id": "ID文字列" | null,
  "useLatest": boolean,
  "text": "作成または編集に必要な自然文" | null,
  "confidence": 0.0-1.0
}

入力:
${JSON.stringify(content)}`;

	const response = await generateAiTextWithUsage(prompt, {
		maxCompletionTokens: 512,
		reasoningEffort: "none",
		temperature: 0,
	});

	return parseJsonObject(response.text);
}

function normalizeReminderMentionAction(
	action: AiReminderMentionAction,
): ReminderMentionAction {
	if ((action.confidence ?? 0) < 0.55) {
		return { type: "none" };
	}

	switch (action.action) {
		case "list":
			return { type: "list" };
		case "cancel":
			return {
				type: "cancel",
				id: normalizeOptionalText(action.id),
				useLatest: Boolean(action.useLatest),
			};
		case "edit":
			return {
				type: "edit",
				id: normalizeOptionalText(action.id),
				useLatest: Boolean(action.useLatest),
				text: normalizeOptionalText(action.text) ?? "",
			};
		case "create":
			return {
				type: "create",
				text: normalizeOptionalText(action.text) ?? "",
			};
		default:
			return { type: "none" };
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

function normalizeOptionalText(
	value: string | null | undefined,
): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function parseJsonObject(text: string): AiReminderMentionAction {
	const trimmed = text.trim();
	const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	const candidate = fencedMatch?.[1] ?? trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");

	if (start === -1 || end === -1 || end <= start) {
		throw new Error("AI response did not contain a JSON object");
	}

	return JSON.parse(candidate.slice(start, end + 1)) as AiReminderMentionAction;
}

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
