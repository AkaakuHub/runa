import {
	type TextChannel,
	type ChatInputCommandInteraction,
	type Message,
	MessageFlags,
} from "discord.js";

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
export function splitMessage(message: string, maxLength = 2000): string[] {
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
 * チャンネルにメッセージを送信する（2000文字制限を自動処理）
 * @param channel 送信先チャンネル
 * @param content 送信するメッセージ内容
 * @returns 送信されたメッセージの配列
 */
export async function sendLongMessage(
	channel: TextChannel,
	content: string,
): Promise<Message[]> {
	const chunks = splitMessage(content, DISCORD_CHUNK_LIMIT);
	const sentMessages: Message[] = [];

	for (const chunk of chunks) {
		const message = await channel.send(chunk);
		sentMessages.push(message);
	}

	return sentMessages;
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
