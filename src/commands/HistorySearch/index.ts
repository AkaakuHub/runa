import {
	type ChatInputCommandInteraction,
	ChannelType,
	type TextChannel,
	type Message,
	type Collection,
} from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { getJSTDateRangeFromDaysBack, formatToJapaneseDate, formatToJapaneseTime, getDaysDifference, getTimestamp } from "../../utils/dateUtils";
import { replyLongMessage } from "../../utils/messageUtils";

export const HistorySearchCommand: CommandDefinition = {
	name: "history-search",
	description: "チャンネルの履歴を柔軟に検索します",
	options: [
		{
			name: "query",
			description: "検索したい内容や質問",
			type: "STRING",
			required: true,
		},
		{
			name: "days",
			description: "何日前まで遡るか（デフォルト: 7日）",
			type: "INTEGER",
			required: false,
			min_value: 1,
			max_value: 30,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
			});

			const query = interaction.options.getString("query", true);
			const daysBack = interaction.options.getInteger("days") || 7;

			const searchResult = await performHistorySearch(
				interaction,
				query,
				daysBack,
			);

			// 少し遅延を入れて進捗表示が確実に更新されるようにする
	await new Promise(resolve => setTimeout(resolve, 500));
	await replyLongMessage(interaction, searchResult);

			logInfo(
				`History search command executed by ${interaction.user.username}, query: "${query}", days: ${daysBack}`,
			);
		} catch (error) {
			logError(`Error executing history search command: ${error}`);
			try {
				await interaction.editReply({
					content: "履歴検索中にエラーが発生しました。",
				});
			} catch (replyError) {
				logError(`Failed to send error message: ${replyError}`);
			}
		}
	},
};

async function performHistorySearch(
	interaction: ChatInputCommandInteraction,
	query: string,
	daysBack: number,
): Promise<string> {
	try {
		const guild = interaction.guild;
		const currentChannel = interaction.channel;

		if (!guild || !currentChannel) {
			throw new Error("Guild or channel not found");
		}

		if (currentChannel.type !== ChannelType.GuildText) {
			return "このコマンドはテキストチャンネルでのみ使用できます。";
		}

		const textChannel = currentChannel as TextChannel;

		// 検索範囲の日付を計算
		const { start: startDate, end: endDate } = getJSTDateRangeFromDaysBack(daysBack);

		// メッセージを取得（進捗表示付き）
		const messages = await fetchMessagesInDateRange(
			textChannel,
			startDate,
			endDate,
			interaction,
			daysBack,
		);

		if (messages.length === 0) {
			return `過去${daysBack}日間にメッセージが見つかりませんでした。`;
		}

		// Google API キーを確認
		const googleApiKey = process.env.GOOGLE_API_KEY;
		if (!googleApiKey) {
			throw new Error("Google API key not found");
		}

		const genAI = new GoogleGenerativeAI(googleApiKey);
		
		// リトライ機能付きでモデル取得・実行
		const generateWithRetry = async (prompt: string, maxRetries = 3, fallbackModel = "gemini-1.5-flash"): Promise<string> => {
			let lastError: unknown;
			
			// まず優先モデルで試行
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
					const result = await model.generateContent(prompt);
					return result.response.text();
				} catch (error: unknown) {
					lastError = error;
					logError(`Attempt ${attempt} with gemini-2.0-flash failed: ${error}`);
					
					// 503エラー（overloaded）の場合は指数バックオフで待機
					if (error instanceof Error && (error.message?.includes('503') || error.message?.includes('overloaded'))) {
						if (attempt < maxRetries) {
							const waitTime = Math.min(1000 * (2 ** (attempt - 1)), 8000); // 1s, 2s, 4s, max 8s
							logInfo(`Waiting ${waitTime}ms before retry...`);
							await new Promise(resolve => setTimeout(resolve, waitTime));
						}
					} else {
						// 503以外のエラーは即座にフォールバックへ
						break;
					}
				}
			}
			
			// フォールバックモデルで試行
			try {
				logInfo(`Falling back to ${fallbackModel} model`);
				const fallbackModelInstance = genAI.getGenerativeModel({ model: fallbackModel });
				const result = await fallbackModelInstance.generateContent(prompt);
				return result.response.text();
			} catch (fallbackError) {
				logError(`Fallback model ${fallbackModel} also failed: ${fallbackError}`);
				throw lastError; // 元のエラーを投げる
			}
		};

		// メッセージを整形
		const messagesText = messages
			.map(
				(msg) =>
					`[${formatToJapaneseDate(msg.timestamp)} ${formatToJapaneseTime(msg.timestamp)}] ${msg.author}: ${msg.content}`,
			)
			.join("\n");

		// ハルシネーション防止のためのプロンプト
		const prompt = `あなたはDiscordチャンネルの履歴検索アシスタントです。以下のメッセージ履歴から、ユーザーの質問に関連する情報を正確に抽出して回答してください。

重要な制約:
1. 提供されたメッセージ履歴にない情報は絶対に追加しないでください
2. 推測や想像で情報を補完しないでください
3. 関連するメッセージが見つからない場合は、素直に「見つかりませんでした」と回答してください
4. 引用する際は、できるだけ正確に元のメッセージを引用してください
5. 日時と発言者を明確に示してください

ユーザーの質問: ${query}

メッセージ履歴（過去${daysBack}日間、${messages.length}件のメッセージ）:
${messagesText}

回答形式:
🔍 **検索結果**

関連するメッセージが見つかった場合:
📝 **要約**
[質問に対する簡潔な回答]

💬 **関連メッセージ**
[関連するメッセージを時系列順に引用、発言者と日時付き]

関連するメッセージが見つからなかった場合:
❌ 申し訳ございませんが、「${query}」に関連するメッセージは過去${daysBack}日間の履歴から見つかりませんでした。`;

		const searchResult = await generateWithRetry(prompt);

		return searchResult;
	} catch (error) {
		logError(`Error performing history search: ${error}`);
		throw error;
	}
}

async function fetchMessagesInDateRange(
	channel: TextChannel,
	startDate: Date,
	endDate: Date,
	interaction: ChatInputCommandInteraction,
	totalDays: number,
): Promise<
	Array<{
		author: string;
		content: string;
		timestamp: Date;
	}>
> {
	const messages: Array<{
		author: string;
		content: string;
		timestamp: Date;
	}> = [];

	let lastMessageId: string | undefined;
	let hasMoreMessages = true;
	let currentDay = 0;
	let lastProgressDate: string | null = null;

	// 初期進捗表示
	await interaction.editReply({
		content: `🔍 履歴を検索中... (過去${totalDays}日間)\n📅 メッセージを取得中...`,
	});

	while (hasMoreMessages) {
		const options: { limit: number; before?: string } = { limit: 100 };
		if (lastMessageId) {
			options.before = lastMessageId;
		}

		const fetchedMessages: Collection<string, Message> =
			await channel.messages.fetch(options);

		if (fetchedMessages.size === 0) {
			hasMoreMessages = false;
			break;
		}

		const messagesArray = Array.from(fetchedMessages.values());
		let foundOldMessage = false;

		for (const message of messagesArray) {
			// 範囲外の古いメッセージが見つかったら停止
			if (message.createdAt < startDate) {
				foundOldMessage = true;
				break;
			}

			// 進捗表示の更新
			const messageDate = formatToJapaneseDate(message.createdAt);
			if (lastProgressDate !== messageDate) {
				lastProgressDate = messageDate;
				const daysAgo = getDaysDifference(endDate, message.createdAt);
				
				// 進捗表示を更新（あまり頻繁にならないよう調整）
				if (daysAgo !== currentDay) {
					currentDay = daysAgo;
					await interaction.editReply({
						content: `🔍 履歴を検索中... (過去${totalDays}日間)\n📅 ${messageDate} (${daysAgo}日前) を確認中... (${messages.length}件取得済み)`,
					});
				}
			}

			// 範囲内のメッセージのみを追加
			if (
				message.createdAt >= startDate &&
				message.createdAt <= endDate &&
				!message.author.bot &&
				message.content &&
				message.content.length > 0
			) {
				messages.push({
					author: message.author.displayName || message.author.username,
					content: message.content,
					timestamp: message.createdAt,
				});
			}
		}

		if (foundOldMessage) {
			hasMoreMessages = false;
		} else {
			lastMessageId = messagesArray[messagesArray.length - 1]?.id;
			if (fetchedMessages.size < 100) {
				hasMoreMessages = false;
			}
		}
	}

	// 最終進捗表示
	await interaction.editReply({
		content: `🔍 履歴検索完了！\n📊 ${messages.length}件のメッセージを取得しました\n🤖 AIで検索中...`,
	});

	// 時系列順にソート
	messages.sort((a, b) => getTimestamp(a.timestamp) - getTimestamp(b.timestamp));

	return messages;
}