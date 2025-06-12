import { type ChatInputCommandInteraction, ChannelType, type TextChannel } from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const DailySummaryCommand: CommandDefinition = {
	name: "daily-summary",
	description: "今日のチャンネルの出来事をニュース風にまとめます。",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
				fetchReply: true,
			});

			const summary = await generateDailySummary(interaction);
			
			await interaction.editReply({
				content: summary,
			});

			logInfo(
				`Daily summary command executed by ${interaction.user.username}`,
			);
		} catch (error) {
			logError(`Error executing daily summary command: ${error}`);
			await interaction.editReply({
				content: "サマリーの生成中にエラーが発生しました。",
			});
		}
	},
};

export async function generateDailySummary(interaction: ChatInputCommandInteraction): Promise<string> {
	try {
		const guild = interaction.guild;

		if (!guild) {
			throw new Error("Guild not found");
		}

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		const channels = guild.channels.cache.filter(
			channel => channel.type === ChannelType.GuildText
		) as Map<string, TextChannel>;

		const todaysMessages: Array<{
			channel: string;
			author: string;
			content: string;
			timestamp: Date;
		}> = [];

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		for (const [_, channel] of channels) {
			try {
				const messages = await channel.messages.fetch({ limit: 100 });
				
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				for (const [_, message] of messages) {
					if (message.createdAt >= today && message.createdAt < tomorrow && !message.author.bot) {
						if (message.content && message.content.length > 0) {
							todaysMessages.push({
								channel: channel.name,
								author: message.author.displayName || message.author.username,
								content: message.content,
								timestamp: message.createdAt,
							});
						}
					}
				}
			} catch (error) {
				console.warn(`Could not fetch messages from channel ${channel.name}: ${error}`);
			}
		}

		if (todaysMessages.length === 0) {
			return "今日はメッセージが見つかりませんでした。";
		}

		todaysMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

		const googleApiKey = process.env.GOOGLE_API_KEY;
		if (!googleApiKey) {
			throw new Error("Google API key not found");
		}

		const genAI = new GoogleGenerativeAI(googleApiKey);
		const model = genAI.getGenerativeModel({ model: "gemini-pro" });

		const messagesText = todaysMessages
			.map(msg => `[${msg.channel}] ${msg.author}: ${msg.content}`)
			.join('\n');

		const prompt = `以下は今日Discordサーバーで投稿されたメッセージです。これらの内容をニュース風にまとめて、興味深い話題や重要な出来事を3-5個のトピックとして整理してください。

メッセージ:
${messagesText}

以下の形式でまとめてください：
📰 **今日のサーバーニュース**

🔸 **トピック1のタイトル**
要約内容

🔸 **トピック2のタイトル**  
要約内容

（以下同様に続ける）

注意：
- 各トピックは簡潔に1-2文で要約
- プライベートな情報は含めない
- 建設的で興味深い内容を優先
- 日本語で出力`;

		const result = await model.generateContent(prompt);
		const response = await result.response;
		const summary = response.text();

		return summary;

	} catch (error) {
		logError(`Error generating daily summary: ${error}`);
		throw error;
	}
}