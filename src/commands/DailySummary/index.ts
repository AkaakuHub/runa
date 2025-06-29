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
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
				fetchReply: true,
			});

			const highlight = interaction.options.getString("highlight");

			if (!interaction.guild) {
				await interaction.editReply({
					content: "このコマンドはサーバー内でのみ使用できます。",
				});
				return;
			}

			const summaryChannelId = dailyChannelService.getSummaryChannel(interaction.guild.id);
			const summary = await generateDailySummary(
				interaction,
				undefined,
				highlight,
			);

			// 投稿用チャンネルが設定されている場合はそこに投稿
			if (summaryChannelId) {
				const summaryChannel = interaction.guild.channels.cache.get(summaryChannelId);
				if (summaryChannel && summaryChannel.type === ChannelType.GuildText) {
					const today = new Date();
					const dateString = today.toLocaleDateString('ja-JP', {
						year: 'numeric',
						month: 'long',
						day: 'numeric',
						weekday: 'long'
					});

					const summaryWithDate = `# ${dateString}のサーバーニュース\n\n${summary}`;

					await (summaryChannel as TextChannel).send(summaryWithDate);

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
				await interaction.editReply({
					content: summary,
				});
			}

			logInfo(`Daily summary command executed by ${interaction.user.username}`);
		} catch (error) {
			logError(`Error executing daily summary command: ${error}`);
			await interaction.editReply({
				content: "サマリーの生成中にエラーが発生しました。",
			});
		}
	},
};

export async function generateDailySummary(
	interaction: ChatInputCommandInteraction,
	targetChannelIds?: string | string[],
	highlight?: string | null,
): Promise<string> {
	try {
		const guild = interaction.guild;

		if (!guild) {
			throw new Error("Guild not found");
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

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
						if (message.createdAt < today) {
							// 今日より古いメッセージが見つかったら、それ以降は取得しない
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

				// 今日のメッセージのみをフィルタリング
				for (const message of allMessages) {
					if (
						message.createdAt >= today &&
						message.createdAt < tomorrow &&
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
			return "今日はメッセージが見つかりませんでした。";
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
