import type { Message } from "discord.js";
import { logError } from "./logger";
import { classifyMentionIntent } from "./mentionIntentClassifier";
import { editAndSendLongMessage, replyOrSendLongMessage } from "./messageUtils";
import { handleReminderMentionAction } from "./reminderMessageHandler";

export async function handleMentionMessage(message: Message): Promise<boolean> {
	const botUser = message.client.user;
	if (!botUser || !message.mentions.has(botUser)) {
		return false;
	}

	const contentWithoutMention = message.content
		.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "")
		.trim();

	const stopTyping = startTyping(message);

	let responseMessage: Message | null = null;
	const reply = async (content: string): Promise<void> => {
		if (!responseMessage) {
			responseMessage = await replyOrSendLongMessage(message, content);
			return;
		}
		try {
			await editAndSendLongMessage(responseMessage, content);
		} catch (error) {
			logError(`Failed to edit mention response message: ${error}`);
			responseMessage = await replyOrSendLongMessage(message, content);
		}
	};

	try {
		if (!contentWithoutMention) {
			await reply("呼びました？");
			return true;
		}

		const intent = await classifyMentionIntent(contentWithoutMention);
		if (intent.type === "reminder") {
			await handleReminderMentionAction(message, intent.action, reply);
			return true;
		}

		await reply(intent.response);
		return true;
	} catch (error) {
		logError(`Error handling mention message: ${error}`);
		await reply("反応はできていますが、返答生成で失敗しました。");
		return true;
	} finally {
		stopTyping();
	}
}

function startTyping(message: Message): () => void {
	const { channel } = message;
	if (!("sendTyping" in channel)) {
		return () => {};
	}

	const sendTyping = () => {
		channel
			.sendTyping()
			.catch((error) => logError(`Failed to send typing indicator: ${error}`));
	};

	sendTyping();
	const interval = setInterval(sendTyping, 8000);
	return () => clearInterval(interval);
}
