import type { Message } from "discord.js";
import { getChannelContextScopeId } from "./chatContextScope";
import { generateChatResponse } from "./chatResponse";
import { logError, logInfo } from "./logger";
import { classifyMentionIntent } from "./mentionIntentClassifier";
import { editAndSendLongMessage, replyOrSendLongMessage } from "./messageUtils";
import { handleReminderMentionAction } from "./reminderMessageHandler";

const PROGRESS_MESSAGE_LIMIT = 1800;
const PROGRESS_VISIBLE_ITEMS = 8;

export async function handleMentionMessage(message: Message): Promise<boolean> {
	const botUser = message.client.user;
	if (!botUser || !isMentionedToBot(message, botUser.id)) {
		return false;
	}

	const contentWithoutMention = removeBotMention(message.content, botUser.id);
	const contextScopeId = getChannelContextScopeId(
		message.guildId,
		message.channelId,
	);

	const stopTyping = startTyping(message);
	const startedAt = Date.now();
	logInfo(
		`Mention handling started: guild=${message.guildId ?? "dm"} channel=${message.channelId} author=${message.author.id}`,
	);

	let responseMessage: Message | null = null;
	const progressMessages: string[] = [];
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
	const replyProgress = async (content: string): Promise<void> => {
		progressMessages.push(content);
		const progressContent = buildProgressContent(progressMessages);
		if (!responseMessage) {
			responseMessage = await replyOrSendLongMessage(message, progressContent);
			return;
		}

		try {
			await responseMessage.edit(progressContent);
		} catch (error) {
			logError(`Failed to edit mention progress message: ${error}`);
		}
	};

	try {
		if (!contentWithoutMention) {
			await reply("呼びました？");
			return true;
		}

		await replyProgress("リマインダー操作か確認しています。");
		const intent = await classifyMentionIntent(contentWithoutMention).catch(
			(error) => {
				logError(`Mention intent classification failed: ${error}`);
				return { type: "general" as const, response: "" };
			},
		);
		logInfo(
			`Mention intent classified: type=${intent.type} elapsed=${Date.now() - startedAt}ms`,
		);
		if (intent.type === "reminder") {
			await handleReminderMentionAction(message, intent.action, reply);
			logInfo(`Mention reminder handled: elapsed=${Date.now() - startedAt}ms`);
			return true;
		}

		const response = await generateChatResponse(contentWithoutMention, {
			contextScopeId,
			onProgress: replyProgress,
		});
		await reply(response);
		logInfo(`Mention general replied: elapsed=${Date.now() - startedAt}ms`);
		return true;
	} catch (error) {
		logError(`Error handling mention message: ${error}`);
		try {
			await reply(buildMentionErrorMessage(error));
		} catch (replyError) {
			logError(`Failed to send mention error response: ${replyError}`);
		}
		return true;
	} finally {
		stopTyping();
	}
}

function buildProgressContent(messages: string[]): string {
	const omittedCount = Math.max(0, messages.length - PROGRESS_VISIBLE_ITEMS);
	const visibleMessages = messages.slice(-PROGRESS_VISIBLE_ITEMS);
	const prefix =
		omittedCount > 0 ? [`- 以前の進捗${omittedCount}件を省略しました。`] : [];
	const content = [
		...prefix,
		...visibleMessages.map((item) => `- ${item}`),
	].join("\n");

	if (content.length <= PROGRESS_MESSAGE_LIMIT) {
		return content;
	}

	return `${content.slice(0, PROGRESS_MESSAGE_LIMIT - 20)}\n...省略しました。`;
}

function buildMentionErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (
		message.includes("429") ||
		message.toLowerCase().includes("quota") ||
		message.includes("RESOURCE_EXHAUSTED")
	) {
		return "AIの利用上限に達しているため、いまは返答できません。";
	}
	return "反応はできていますが、返答生成で失敗しました。";
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
