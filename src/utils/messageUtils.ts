import type {
	TextChannel,
	ChatInputCommandInteraction,
	Message,
} from "discord.js";

/**
 * Discordの2000文字制限を考慮してメッセージを分割するユーティリティ
 */

/**
 * メッセージを指定された最大長に分割する
 * @param message 分割するメッセージ
 * @param maxLength 最大文字数
 * @returns 分割されたメッセージの配列
 */
export function splitMessage(message: string, maxLength = 2000): string[] {
	const chunks: string[] = [];

	if (message.length <= maxLength) {
		return [message];
	}

	// トピック単位で分割を試みる
	const topicSeparator = /🔸 \*\*/g;
	const topics = message.split(topicSeparator);

	let currentChunk = topics[0]; // ヘッダー部分

	for (let i = 1; i < topics.length; i++) {
		const topicContent = `🔸 **${topics[i]}`;

		if ((currentChunk + topicContent).length <= maxLength) {
			currentChunk += topicContent;
		} else {
			// 現在のチャンクを保存し、新しいチャンクを開始
			if (currentChunk.trim()) {
				chunks.push(currentChunk.trim());
			}
			currentChunk = topicContent;

			// 単一トピックが最大長を超える場合は強制分割
			if (currentChunk.length > maxLength) {
				const forceSplit = forceSplitMessage(currentChunk, maxLength);
				chunks.push(...forceSplit.slice(0, -1));
				currentChunk = forceSplit[forceSplit.length - 1];
			}
		}
	}

	// 最後のチャンクを追加
	if (currentChunk.trim()) {
		chunks.push(currentChunk.trim());
	}

	return chunks.length > 0 ? chunks : [message.substring(0, maxLength)];
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

		chunks.push(message.substring(currentPos, chunkEnd));
		currentPos = chunkEnd;

		// 改行文字をスキップ
		if (currentPos < message.length && message[currentPos] === "\n") {
			currentPos++;
		}
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
	const chunks = splitMessage(content, 2000);
	const sentMessages: Message[] = [];

	// 安全対策：すべてのチャンクが2000文字以内であることを確認
	const safeChunks = chunks.map((chunk) => {
		if (chunk.length > 2000) {
			console.log(
				`[WARNING] Chunk exceeds 2000 characters (${chunk.length}), force splitting`,
			);
			return chunk.substring(0, 2000);
		}
		return chunk;
	});

	for (const chunk of safeChunks) {
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
): Promise<void> {
	const chunks = splitMessage(content, 2000);

	// デバッグ用：各チャンクの長さをログ（console.logを使用）
	console.log(`[DEBUG] Splitting message into ${chunks.length} chunks`);
	chunks.forEach((chunk, index) => {
		console.log(`[DEBUG] Chunk ${index + 1}: ${chunk.length} characters`);
	});

	// 安全対策：すべてのチャンクが2000文字以内であることを確認
	const safeChunks = chunks.map((chunk) => {
		if (chunk.length > 2000) {
			console.log(
				`[WARNING] Chunk exceeds 2000 characters (${chunk.length}), force splitting`,
			);
			return chunk.substring(0, 2000);
		}
		return chunk;
	});

	try {
		// 最初のチャンクをeditReplyで送信（進捗表示を上書き）
		await interaction.editReply({
			content: safeChunks[0],
		});

		// 残りのチャンクをfollowUpで送信
		for (let i = 1; i < safeChunks.length; i++) {
			await interaction.followUp({
				content: safeChunks[i],
			});
		}
	} catch (error) {
		console.error(`[ERROR] Failed to send long message: ${error}`);
		// フォールバック：最初のチャンクのみ送信を試みる
		try {
			await interaction.editReply({
				content: safeChunks[0].substring(0, 2000),
			});
		} catch (fallbackError) {
			console.error(`[ERROR] Fallback also failed: ${fallbackError}`);
		}
	}
}
