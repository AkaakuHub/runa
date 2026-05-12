import {
	type ChatInputCommandInteraction,
	type Message,
	MessageFlags,
} from "discord.js";
import { logError } from "./logger";

/**
 * Discordの2000文字制限を考慮してメッセージを分割するユーティリティ
 */
const DISCORD_CHUNK_LIMIT = 1800;

/**
 * メッセージを指定された最大長に分割する
 * @param message 分割するメッセージ
 * @param maxLength 最大文字数
 * @returns 分割されたメッセージの配列
 */
function splitMessage(message: string, maxLength = 2000): string[] {
	if (message.length <= maxLength) {
		return [message];
	}

	return forceSplitMessage(message, maxLength);
}

/**
 * 強制的にメッセージを分割する（改行を考慮）
 * @param message 分割するメッセージ
 * @param maxLength 最大文字数
 * @returns 分割されたメッセージの配列
 */
function forceSplitMessage(message: string, maxLength: number): string[] {
	const chunks: string[] = [];
	let currentPos = 0;

	while (currentPos < message.length) {
		let chunkEnd = Math.min(currentPos + maxLength, message.length);

		// 改行で分割できる場合はそこで分割
		if (chunkEnd < message.length) {
			const lastNewline = message.lastIndexOf("\n", chunkEnd);
			if (lastNewline > currentPos) {
				chunkEnd = lastNewline;
			}
		}

		const chunk = message.substring(currentPos, chunkEnd);
		chunks.push(chunk);
		currentPos = chunkEnd;

		// 改行文字をスキップ
		if (currentPos < message.length && message[currentPos] === "\n") {
			currentPos++;
		}
	}

	// 空のチャンクがある場合は元のメッセージの先頭2000文字を返す
	if (chunks.length === 0) {
		chunks.push(message.substring(0, maxLength));
	}

	return chunks;
}

/**
 * インタラクションに長いメッセージを返信する（2000文字制限を自動処理）
 * @param interaction Discordインタラクション
 * @param content 返信するメッセージ内容
 * @returns Promise<void>
 */
export async function replyLongMessage(
	interaction: ChatInputCommandInteraction,
	content: string,
	isEphemeral = false,
): Promise<void> {
	const chunks = splitMessage(content, DISCORD_CHUNK_LIMIT);

	// チャンクをfollowUpで送信（失敗は呼び出し元へ伝搬）
	for (let i = 0; i < chunks.length; i++) {
		await interaction.followUp({
			content: chunks[i],
			flags: isEphemeral ? MessageFlags.Ephemeral : undefined,
		});
	}
}

/**
 * インタラクションにeditReplyで最初のチャンクを送信し、残りをfollowUpで送信する
 * @param interaction Discordインタラクション
 * @param content 返信するメッセージ内容
 * @returns Promise<void>
 */
export async function editAndFollowUpLongMessage(
	interaction: ChatInputCommandInteraction,
	content: string,
	isEphemeral = false,
): Promise<void> {
	const chunks = splitMessage(content, DISCORD_CHUNK_LIMIT);

	if (chunks.length === 0) return;

	// 最初のチャンクをeditReplyで送信
	await interaction.editReply({
		content: chunks[0],
	});

	// 残りのチャンクをfollowUpで送信
	for (let i = 1; i < chunks.length; i++) {
		await interaction.followUp({
			content: chunks[i],
			flags: isEphemeral ? MessageFlags.Ephemeral : undefined,
		});
	}
}

/**
 * メッセージを編集して最初のチャンクを送信し、残りを同じチャンネルに送信する
 * @param message 編集対象のメッセージ
 * @param content 送信するメッセージ内容
 * @returns Promise<void>
 */
export async function editAndSendLongMessage(
	message: Message,
	content: string,
): Promise<void> {
	const chunks = splitMessage(content, DISCORD_CHUNK_LIMIT);

	if (chunks.length === 0) return;

	await message.edit(chunks[0]);

	for (let i = 1; i < chunks.length; i++) {
		if ("send" in message.channel) {
			await message.channel.send(chunks[i]);
		}
	}
}

/**
 * 元メッセージに返信し、返信元が消えている場合は同じチャンネルに送信する
 * @param message 返信元メッセージ
 * @param content 送信するメッセージ内容
 * @returns 最初に送信したメッセージ
 */
export async function replyOrSendLongMessage(
	message: Message,
	content: string,
): Promise<Message> {
	const chunks = splitMessage(
		content || "うまく言葉が出ませんでした。",
		DISCORD_CHUNK_LIMIT,
	);

	let sentMessage: Message;
	try {
		sentMessage = await message.reply(chunks[0]);
	} catch (replyError) {
		logError(`Failed to reply to message, sending to channel: ${replyError}`);
		if (!("send" in message.channel)) {
			throw new Error("Channel does not support sending messages");
		}
		try {
			sentMessage = await message.channel.send(chunks[0]);
		} catch (sendError) {
			logError(`Failed to send message to channel: ${sendError}`);
			throw sendError;
		}
	}

	for (let i = 1; i < chunks.length; i++) {
		if ("send" in message.channel) {
			await message.channel.send(chunks[i]);
		}
	}

	return sentMessage;
}
