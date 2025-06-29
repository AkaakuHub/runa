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
import { dailyChannelService } from "../../services/DailyChannelService";

// メッセージ分割関数
function splitMessage(message: string, maxLength: number): string[] {
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
		const startTime = Date.now();
		
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
				const elapsed = Date.now() - startTime;
				logError(`Summary generation failed after ${elapsed}ms: ${error}`);
				
				if (!interaction.replied && !interaction.deferred) {
					return; // インタラクションが既に無効
				}
				
				try {
					await interaction.editReply({
						content: "サマリーの生成中にエラーが発生しました。時間をおいて再度お試しください。",
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
					let targetDateForDisplay: Date;
					
					if (dateString) {
						// 指定された日付を使用（JST）
						const [year, month, day] = dateString.split('-').map(Number);
						targetDateForDisplay = new Date(year, month - 1, day);
					} else {
						// 現在のJST日付を使用
						const now = new Date();
						const jstOffset = 9 * 60 * 60 * 1000;
						const jstNow = new Date(now.getTime() + jstOffset);
						targetDateForDisplay = new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate());
					}
					
					const displayDateString = targetDateForDisplay.toLocaleDateString('ja-JP', {
						year: 'numeric',
						month: 'long',
						day: 'numeric',
						weekday: 'long'
					});

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

		// JST基準で日付範囲を作成（サーバーのタイムゾーンに依存しない）
		let jstStartTime: Date;
		let jstEndTime: Date;
		
		if (targetDate) {
			try {
				const [year, month, day] = targetDate.split('-').map(Number);
				if (!year || !month || !day) {
					throw new Error('Invalid date format');
				}
				
				// JST（UTC+9）での指定日の00:00:00 UTCタイムスタンプを計算
				const jstDate = new Date(Date.UTC(year, month - 1, day, -9, 0, 0, 0)); // UTC-9時間でJST00:00
				jstStartTime = jstDate;
				jstEndTime = new Date(jstDate.getTime() + 24 * 60 * 60 * 1000); // 24時間後
			} catch {
				throw new Error('日付の形式が正しくありません。YYYY-MM-DD形式で入力してください。');
			}
		} else {
			// 現在のJST日付を取得
			const now = new Date();
			const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
			const year = jstNow.getUTCFullYear();
			const month = jstNow.getUTCMonth();
			const day = jstNow.getUTCDate();
			
			// JST今日の00:00:00 UTCタイムスタンプ
			jstStartTime = new Date(Date.UTC(year, month, day, -9, 0, 0, 0));
			jstEndTime = new Date(jstStartTime.getTime() + 24 * 60 * 60 * 1000);
		}

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

		if (todaysMessages.length === 0) {
			const targetDateStr = targetDate || "today";
			return `${targetDateStr}はメッセージが見つかりませんでした。`;
		}

		todaysMessages.sort(
			(a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
		);

		const googleApiKey = process.env.GOOGLE_API_KEY;
		if (!googleApiKey) {
			throw new Error("Google API key not found");
		}

		const genAI = new GoogleGenerativeAI(googleApiKey);
		const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

		// 1回目のプロンプト：従来のサマリー生成
		const messagesText = todaysMessages
			.map((msg) => `[${msg.channel}] ${msg.author}: ${msg.content}`)
			.join("\n");

		let firstPrompt =
			`以下は今日投稿されたメッセージです。これらの内容をニュース風にまとめて、興味深い話題や重要な出来事を15個のトピックとして整理してください。
特に個人のメッセージや発言を重視し、ユーザー同士の会話や個人的な出来事に焦点を当ててください。twitterやXの投稿は背景情報として使用してください。
できるだけメッセージを多く取り上げ、小さな話題でも見逃さずに拾い上げてください。

メッセージ:
${messagesText}

以下の形式でまとめてください：
📰 **今日のサーバーニュース**

🔸 **トピック1のタイトル**
要約内容

🔸 **トピック2のタイトル**
要約内容

（以下同様に15個のトピックを続ける）

注意：
- 各トピックは簡潔に、見出し1文と、内容1文で要約
- 日本語で出力
- 各文章は短めに記述して簡潔に要点だけをまとめる
- 個人のメッセージや会話を優先的に取り上げる
- 小さな話題でも見逃さずに取り上げる
- 15個のトピックを必ず作成する
`;

		if (highlight) {
			firstPrompt += `

📌 **特に注目してほしい内容**: ${highlight}
上記の内容について特に詳しく調べて、関連するメッセージがあれば優先的に取り上げて、イチオシニュースとして強調してください。`;
		}

		// 1回目のプロンプト実行
		const firstResult = await model.generateContent(firstPrompt);
		const firstResponse = firstResult.response;
		const basicSummary = firstResponse.text();

		// 2回目のプロンプト：時刻とURLを抽出・付与
		const messagesWithMeta = todaysMessages.map((msg) => {
			const timeString = msg.timestamp.toLocaleString('ja-JP', {
				hour: '2-digit',
				minute: '2-digit'
			});
			const messageUrl = `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId}`;
			return `[${timeString}] [${msg.channel}] ${msg.author}: ${msg.content} | URL: ${messageUrl}`;
		}).join("\n");

		const secondPrompt = `以下は1回目で生成したニュースサマリーです：

${basicSummary}

以下は元のメッセージデータ（時刻とURLを含む）です：

${messagesWithMeta}

上記のニュースサマリーの各トピックについて、元となったメッセージの時刻とURLを特定し、以下の形式で出力してください。
**重要**: 時刻やURLが特定できない場合は、その部分を省略し、トピックタイトルと要約のみを出力してください：

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

（以下15個のトピック）

必須のルール：
- 各トピックは必ず「🔸 **」から始める
- 時刻・URLが特定できる場合のみ追加する（無理に推測しない）
- 時刻は HH:MM 形式、URLは正確なDiscordメッセージリンクのみ使用
- 特定できない場合は、トピックタイトルの後に改行して要約のみを記載
- 15個のトピックすべてを必ず出力する`;

		// 2回目のプロンプト実行とフォールバック処理
		try {
			const secondResult = await model.generateContent(secondPrompt);
			const secondResponse = secondResult.response;
			const finalSummary = secondResponse.text();

			// AIの応答が正しい形式かチェック
			if (finalSummary.includes('📰 **今日のサーバーニュース**') && 
				finalSummary.includes('🔸 **')) {
				return finalSummary;
			}
			// 形式が正しくない場合は1回目のサマリーにフォールバック
			logError('Second prompt failed to generate proper format, falling back to basic summary');
			return basicSummary;
		} catch (secondError) {
			// 2回目のプロンプトが失敗した場合は1回目のサマリーを返す
			logError(`Second prompt failed: ${secondError}, falling back to basic summary`);
			return basicSummary;
		}
	} catch (error) {
		logError(`Error generating daily summary: ${error}`);
		throw error;
	}
}
