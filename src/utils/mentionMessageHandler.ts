import type { Message } from "discord.js";
import { CHAT_PROGRESS_MESSAGE, generateChatResponse } from "./chatResponse";
import { logError } from "./logger";
import { classifyMentionIntent } from "./mentionIntentClassifier";
import { editAndSendLongMessage } from "./messageUtils";
import { handleReminderMentionAction } from "./reminderMessageHandler";

const GENERAL_MENTION_SYSTEM_PROMPT =
	"あなたはDiscord botです。メンションされたユーザーに、日本語で自然に短く返答してください。リマインダー登録の完了を装わないでください。必要なら1〜3文で答えてください。";

export async function handleMentionMessage(message: Message): Promise<boolean> {
	const botUser = message.client.user;
	if (!botUser || !message.mentions.has(botUser)) {
		return false;
	}

	const contentWithoutMention = message.content
		.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "")
		.trim();

	const responseMessage = await message.reply(CHAT_PROGRESS_MESSAGE);
	const reply = async (content: string): Promise<void> => {
		await editAndSendLongMessage(responseMessage, content);
	};

	if (!contentWithoutMention) {
		await reply("呼びました？");
		return true;
	}

	try {
		const intent = await classifyMentionIntent(contentWithoutMention);
		if (intent.type === "reminder") {
			await handleReminderMentionAction(message, intent.action, reply);
			return true;
		}

		const response = await generateChatResponse(contentWithoutMention, {
			systemPrompt: GENERAL_MENTION_SYSTEM_PROMPT,
			onProgress: reply,
		});
		await reply(response.trim() || "うまく言葉が出ませんでした。");
		return true;
	} catch (error) {
		logError(`Error handling mention message: ${error}`);
		await reply("反応はできていますが、返答生成で失敗しました。");
		return true;
	}
}
