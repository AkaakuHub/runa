import {
	type ChatInputCommandInteraction,
	ChannelType,
	type TextChannel,
	type Message,
	type Collection,
} from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CommandDefinition, MessageData } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { dailyChannelService } from "../../services/DailyChannelService";
import { HareKeService } from "../../services/HareKeService";
import { 
	parseJSTDateRange, 
	getCurrentJSTDateRange, 
	getJSTDateForJudgment,
	getCurrentTimestamp,
	formatToDetailedJapaneseDate,
	getTimestamp
} from "../../utils/dateUtils";

// メッセージ分割関数
export function splitMessage(message: string, maxLength: number): string[] {
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

// 強制分割関数（改行を考慮）
function forceSplitMessage(message: string, maxLength: number): string[] {
	const chunks: string[] = [];
	let currentPos = 0;
	
	while (currentPos < message.length) {
		let chunkEnd = Math.min(currentPos + maxLength, message.length);
		
		// 改行で分割できる場合はそこで分割
		if (chunkEnd < message.length) {
			const lastNewline = message.lastIndexOf('\n', chunkEnd);
			if (lastNewline > currentPos) {
				chunkEnd = lastNewline;
			}
		}
		
		chunks.push(message.substring(currentPos, chunkEnd));
		currentPos = chunkEnd;
		
		// 改行文字をスキップ
		if (currentPos < message.length && message[currentPos] === '\n') {
			currentPos++;
		}
	}
	
	return chunks;
}

// Twitter/X URL検出とコンテンツ取得のヘルパー関数
function extractTwitterUrls(content: string): string[] {
	const twitterUrlRegex =
		/https?:\/\/(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)\/\w+\/status\/\d+/g;
	return content.match(twitterUrlRegex) || [];
}

function convertToFxTwitterUrl(twitterUrl: string): string {
	return twitterUrl.replace(
		/https?:\/\/(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)/,
		"https://api.fxtwitter.com",
	);
}

async function fetchTweetContent(twitterUrl: string): Promise<string | null> {
	try {
		const fxTwitterUrl = convertToFxTwitterUrl(twitterUrl);
		const response = await fetch(fxTwitterUrl);

		if (!response.ok) {
			logError(
				`Failed to fetch tweet: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		const data = await response.json();

		if (data.code === 200 && data.tweet) {
			const tweet = data.tweet;
			const author = tweet.author;
			return `【ツイート】@${author.screen_name}(${author.name}): ${tweet.text}`;
		}

		return null;
	} catch (error) {
		logError(`Error fetching tweet content: ${error}`);
		return null;
	}
}

export const DailySummaryCommand: CommandDefinition = {
	name: "daily-summary",
	description: "今日のチャンネルの出来事をニュース風にまとめます。",
	options: [
		{
			name: "highlight",
			description: "特に注目してほしい出来事やキーワード（イチオシニュース）",
			type: "STRING",
			required: false,
		},
		{
			name: "date",
			description: "サマリー対象日付（JST、例：2025-06-30）",
			type: "STRING",
			required: false,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		const startTime = getCurrentTimestamp();
		
		try {
			await interaction.deferReply();

			const highlight = interaction.options.getString("highlight");
			const dateString = interaction.options.getString("date");

			if (!interaction.guild) {
				await interaction.editReply({
					content: "このコマンドはサーバー内でのみ使用できます。",
				});
				return;
			}

			const summaryChannelId = dailyChannelService.getSummaryChannel(interaction.guild.id);
			
			// サマリー生成が時間がかかる場合があるのでタイムアウト対策
			let summary: string;
			try {
				// 14分でタイムアウト（Discord の15分制限より少し短く）
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(() => reject(new Error('Generation timeout')), 14 * 60 * 1000);
				});
				
				summary = await Promise.race([
					generateDailySummary(
						interaction,
						undefined,
						highlight,
						dateString,
					),
					timeoutPromise
				]);
			} catch (error) {
				const elapsed = getCurrentTimestamp() - startTime;
				logError(`Summary generation failed after ${elapsed}ms: ${error}`);
				
				if (!interaction.replied && !interaction.deferred) {
					return; // インタラクションが既に無効
				}
				
				let errorMessage = "サマリーの生成中にエラーが発生しました。";
				
				// エラー種別に応じたメッセージを生成
				if (error instanceof Error) {
					if (error.message.includes('503') || error.message.includes('overloaded')) {
						errorMessage = "🔄 Google AIのサーバーが混雑しています。しばらく時間をおいて再度お試しください。";
					} else if (error.message.includes('timeout')) {
						errorMessage = "⏱️ サマリー生成がタイムアウトしました。時間をおいて再度お試しください。";
					} else if (error.message.includes('API key')) {
						errorMessage = "🔑 API設定に問題があります。管理者にお問い合わせください。";
					} else {
						errorMessage = "❌ サマリーの生成中にエラーが発生しました。時間をおいて再度お試しください。";
					}
				}
				
				try {
					await interaction.editReply({
						content: errorMessage,
					});
				} catch (replyError) {
					logError(`Failed to send error message: ${replyError}`);
				}
				return;
			}

			// 投稿用チャンネルが設定されている場合はそこに投稿
			if (summaryChannelId) {
				const summaryChannel = interaction.guild.channels.cache.get(summaryChannelId);
				if (summaryChannel && summaryChannel.type === ChannelType.GuildText) {
					// 統一されたユーティリティを使用して日付を取得
					const targetDateForDisplay = getJSTDateForJudgment(dateString || undefined);
					
					const displayDateString = formatToDetailedJapaneseDate(targetDateForDisplay);

					const summaryWithDate = `# ${displayDateString}のサーバーニュース\n\n${summary}`;

					// メッセージが2000文字を超える場合は分割送信
					if (summaryWithDate.length <= 2000) {
						await (summaryChannel as TextChannel).send(summaryWithDate);
					} else {
						const chunks = splitMessage(summaryWithDate, 2000);
						for (const chunk of chunks) {
							await (summaryChannel as TextChannel).send(chunk);
						}
					}

					await interaction.editReply({
						content: `✅ 日次サマリーを ${summaryChannel.name} に投稿しました。`,
					});
				} else {
					await interaction.editReply({
						content: "投稿用チャンネルが見つかりません。設定を確認してください。",
					});
				}
			} else {
				// 従来通りの動作（実行されたチャンネルに返信）
				// メッセージが2000文字を超える場合は分割送信
				if (summary.length <= 2000) {
					await interaction.editReply({
						content: summary,
					});
				} else {
					const chunks = splitMessage(summary, 2000);
					await interaction.editReply({
						content: chunks[0],
					});
					// 残りのチャンクをフォローアップメッセージとして送信
					for (let i = 1; i < chunks.length; i++) {
						await interaction.followUp({
							content: chunks[i],
						});
					}
				}
			}

			logInfo(`Daily summary command executed by ${interaction.user.username}`);
		} catch (error) {
			logError(`Error executing daily summary command: ${error}`);
			try {
				await interaction.editReply({
					content: "サマリーの生成中にエラーが発生しました。",
				});
			} catch (replyError) {
				logError(`Failed to send error reply: ${replyError}`);
			}
		}
	},
};

export async function generateDailySummary(
	interaction: ChatInputCommandInteraction,
	targetChannelIds?: string | string[],
	highlight?: string | null,
	targetDate?: string | null,
): Promise<string> {
	try {
		const guild = interaction.guild;

		if (!guild) {
			throw new Error("Guild not found");
		}

		// JST基準で日付範囲を作成（統一されたユーティリティを使用）
		const { start: jstStartTime, end: jstEndTime } = targetDate 
			? parseJSTDateRange(targetDate)
			: getCurrentJSTDateRange();

		let channelIds: string[];

		if (targetChannelIds) {
			// 自動実行の場合：指定されたチャンネルIDsを使用
			channelIds = Array.isArray(targetChannelIds) ? targetChannelIds : [targetChannelIds];
		} else {
			// 手動実行の場合：設定されたすべてのチャンネルからメッセージを収集
			const configuredChannelIds = dailyChannelService.getChannels(guild.id);

			if (configuredChannelIds.length === 0) {
				return "日次サマリー用のチャンネルが設定されていません。`/daily-config add` でチャンネルを追加してください。";
			}

			channelIds = configuredChannelIds;
		}

		const todaysMessages: Array<{
			channel: string;
			author: string;
			content: string;
			timestamp: Date;
			messageId: string;
			channelId: string;
			guildId: string;
		}> = [];

		for (const channelId of channelIds) {
			try {
				const channel = guild.channels.cache.get(channelId);

				if (!channel || channel.type !== ChannelType.GuildText) {
					logError(`Channel ${channelId} not found or not a text channel`);
					continue;
				}

				const textChannel = channel as TextChannel;

				// その日の全メッセージを取得するため、ページネーションを使用
				const allMessages: Message[] = [];
				let lastMessageId: string | undefined;
				let hasMoreMessages = true;

				while (hasMoreMessages) {
					const options: { limit: number; before?: string } = { limit: 100 };
					if (lastMessageId) {
						options.before = lastMessageId;
					}

					const messages: Collection<string, Message> =
						await textChannel.messages.fetch(options);

					if (messages.size === 0) {
						hasMoreMessages = false;
						break;
					}

					// メッセージを配列に追加し、日付チェック
					const messagesArray = Array.from(messages.values());
					let foundOldMessage = false;

					for (const message of messagesArray) {
						// メッセージがJST基準の対象日より古いかチェック
						if (message.createdAt < jstStartTime) {
							foundOldMessage = true;
							break;
						}
						allMessages.push(message);
					}

					if (foundOldMessage) {
						hasMoreMessages = false;
					} else {
						lastMessageId = messagesArray[messagesArray.length - 1]?.id;
						if (messages.size < 100) {
							hasMoreMessages = false;
						}
					}
				}

				// 指定日のメッセージのみをフィルタリング（JSTベース）
				for (const message of allMessages) {
					// メッセージがJST基準の対象日の範囲内かチェック
					if (
						message.createdAt >= jstStartTime &&
						message.createdAt < jstEndTime &&
						!message.author.bot
					) {
						if (message.content && message.content.length > 0) {
							let content = message.content;

							// Twitter/X URLを検出してコンテンツを取得
							const twitterUrls = extractTwitterUrls(content);
							if (twitterUrls.length > 0) {
								for (const url of twitterUrls) {
									const tweetContent = await fetchTweetContent(url);
									if (tweetContent) {
										content += `\n${tweetContent}`;
									}
								}
							}

							todaysMessages.push({
								channel: textChannel.name,
								author: message.author.displayName || message.author.username,
								content: content,
								timestamp: message.createdAt,
								messageId: message.id,
								channelId: message.channelId,
								guildId: guild.id,
							});
						}
					}
				}
			} catch (error) {
				const channel = guild.channels.cache.get(channelId);
				const channelName = channel?.name || channelId;
				logError(
					`Could not fetch messages from channel ${channelName}: ${error}`,
				);
			}
		}

		// ハレ・ケ判定用の日付を準備（統一されたユーティリティを使用）
		const targetDateForJudgment = getJSTDateForJudgment(targetDate || undefined);

		// ハレ・ケ判定を実行（メッセージが0件でも実行）
		const messageDataForHareKe: MessageData[] = todaysMessages.map(msg => ({
			content: msg.content,
			author: msg.author,
			timestamp: msg.timestamp,
			channel: msg.channel
		}));

		const hareKeResult = await HareKeService.judge(messageDataForHareKe, targetDateForJudgment);

		// メッセージが0件の場合でもハレ・ケ判定付きで返す
		if (todaysMessages.length === 0) {
			const targetDateStr = targetDate || "today";
			const noMessagesSummary = `📰 **今日のサーバーニュース**\n\n${targetDateStr}はメッセージが見つかりませんでした。`;
			return generateFinalOutputWithHareKe(noMessagesSummary, hareKeResult);
		}

		todaysMessages.sort(
			(a, b) => getTimestamp(a.timestamp) - getTimestamp(b.timestamp),
		);

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

		// メッセージデータを時刻とURL付きで準備
		const messagesWithMeta = todaysMessages.map((msg) => {
			const timeString = msg.timestamp.toLocaleString('ja-JP', {
				hour: '2-digit',
				minute: '2-digit'
			});
			const messageUrl = `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId}`;
			return `[${timeString}] [${msg.channel}] ${msg.author}: ${msg.content} | URL: ${messageUrl}`;
		}).join("\n");

		// シンプル化した1回のプロンプトで全て処理
		let prompt =
			`以下は今日投稿されたメッセージです（時刻とURL付き）。これらの内容をニュース風にまとめて、興味深い話題や重要な出来事を15個のトピックとして整理してください。
特に個人のメッセージや発言を重視し、ユーザー同士の会話や個人的な出来事に焦点を当ててください。twitterやXの投稿は背景情報として使用してください。
できるだけメッセージを多く取り上げ、小さな話題でも見逃さずに拾い上げてください。また、プロの新聞記者の立場として、評論家のような視点で、かつ、ユーモアを交えた、読者を楽しませるような文章を書いてください。
"はい、承知いたしました。以下に、ご指定の形式で出力します。"のような不要な文章は含めないでください。

メッセージ:
${messagesWithMeta}

以下の形式でまとめてください：
📰 **今日のサーバーニュース**

🔸 **トピック1のタイトル** - 13:21
https://discord.com/channels/...
要約内容

🔸 **トピック2のタイトル**
要約内容
（時刻・URLが特定できない場合の例）

🔸 **トピック3のタイトル** - 21:10
https://discord.com/channels/...
要約内容

（以下同様に合計15個のトピックを続ける）

注意：
- 各トピックは見出し1文と、内容2文で要約し、しっかりと中身のあるニュースにする
- 日本語で出力
- 評論家のような視点で、ニュース記事のようにまとめる
- 各トピックは必ず「🔸 **」から始める
- 時刻・URLが特定できる場合のみ追加する（無理に推測しない）
- 時刻は HH:MM 形式、URLは正確なDiscordメッセージリンクのみ使用
- 個人のメッセージや会話を優先的に取り上げる
- 小さな話題でも見逃さずに取り上げる
- 15個のトピックを必ず作成する
`;

		if (highlight) {
			prompt += `

📌 **特に注目してほしい内容**: ${highlight}
上記の内容について特に詳しく調べて、関連するメッセージがあれば優先的に取り上げて、イチオシニュースとして強調してください。`;
		}

		// 1回のプロンプト実行
		const summary = await generateWithRetry(prompt);
		
		// ハレ・ケ判定結果を統合した最終出力を生成
		return generateFinalOutputWithHareKe(summary, hareKeResult);
	} catch (error) {
		logError(`Error generating daily summary: ${error}`);
		throw error;
	}
}

/**
 * ハレ・ケ判定結果を統合した最終出力を生成
 */
function generateFinalOutputWithHareKe(summary: string, hareKeResult: import("../../types").HareKeResult): string {
	// ハレ・ケ判定ヘッダーを作成
	const hareKeHeader = `${hareKeResult.emoji} **${hareKeResult.title}** (${hareKeResult.score}%)
┌─ 判定理由 ─────────────────┐
│ 💬 活動: ${hareKeResult.breakdown.activity.reason.padEnd(20)} │
│ 😊 感情: ${hareKeResult.breakdown.emotion.reason.padEnd(20)} │
│ 📅 伝統: ${hareKeResult.breakdown.tradition.reason.padEnd(20)} │
│ 🌤️ 自然: ${hareKeResult.breakdown.nature.reason.padEnd(20)} │
│ ✨ 運命: ${hareKeResult.breakdown.fortune.reason.padEnd(20)} │
└──────────────────────────┘

`;

	// フッターメッセージを作成
	const hareKeFooter = `

🔮 **明日への一言**
${hareKeResult.message}`;

	// サマリーがニュースヘッダーで始まる場合は、その前にハレ・ケ判定を挿入
	if (summary.includes('📰 **今日のサーバーニュース**')) {
		return `${summary.replace('📰 **今日のサーバーニュース**', `${hareKeHeader}📰 **今日のサーバーニュース**`)}${hareKeFooter}`;
	}
	// ニュースヘッダーがない場合は単純に前後に追加
	return `${hareKeHeader}${summary}${hareKeFooter}`;
}
