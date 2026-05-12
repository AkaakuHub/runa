import type { Message } from "discord.js";
import { logError, logInfo } from "./logger";
import { classifyMentionIntent } from "./mentionIntentClassifier";
import { editAndSendLongMessage, replyOrSendLongMessage } from "./messageUtils";
import { handleReminderMentionAction } from "./reminderMessageHandler";

export async function handleMentionMessage(message: Message): Promise<boolean> {
	const botUser = message.client.user;
	if (!botUser || !isMentionedToBot(message, botUser.id)) {
		return false;
	}

	const contentWithoutMention = removeBotMention(message.content, botUser.id);

	const stopTyping = startTyping(message);
	const startedAt = Date.now();
	logInfo(
		`Mention handling started: guild=${message.guildId ?? "dm"} channel=${message.channelId} author=${message.author.id}`,
	);

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
		logInfo(
			`Mention intent classified: type=${intent.type} elapsed=${Date.now() - startedAt}ms`,
		);
		if (intent.type === "reminder") {
			await handleReminderMentionAction(message, intent.action, reply);
			logInfo(`Mention reminder handled: elapsed=${Date.now() - startedAt}ms`);
			return true;
		}

		await reply(intent.response);
		logInfo(`Mention general replied: elapsed=${Date.now() - startedAt}ms`);
		return true;
	} catch (error) {
		logError(`Error handling mention message: ${error}`);
		try {
			await reply("反応はできていますが、返答生成で失敗しました。");
		} catch (replyError) {
			logError(`Failed to send mention error response: ${replyError}`);
		}
		return true;
	} finally {
		stopTyping();
	}
}

function isMentionedToBot(message: Message, botUserId: string): boolean {
	return (
		message.mentions.users.has(botUserId) ||
		message.mentions.repliedUser?.id === botUserId ||
		createBotMentionPattern(botUserId).test(message.content)
	);
}

function removeBotMention(content: string, botUserId: string): string {
	return content.replace(createBotMentionPattern(botUserId), "").trim();
}

function createBotMentionPattern(botUserId: string): RegExp {
	return new RegExp(`<@!?${botUserId}>`, "g");
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
