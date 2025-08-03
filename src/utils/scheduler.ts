import * as cron from "node-cron";
import {
	type Client,
	ChannelType,
	type TextChannel,
	type ChatInputCommandInteraction,
} from "discord.js";
import { generateDailySummary } from "../commands/DailySummary";
import { logInfo, logError } from "./logger";
import { dailyChannelService } from "../services/DailyChannelService";

export function setupDailySummaryScheduler(client: Client): void {
	cron.schedule(
		"20 23 * * *",
		async () => {
			try {
				logInfo("🕒 Daily summary cron job triggered at 23:20 JST");
				logInfo("Starting scheduled daily summary generation...");

				const guilds = client.guilds.cache;
				logInfo(`Found ${guilds.size} guilds to process`);

				for (const [, guild] of guilds) {
					try {
						logInfo(`Processing guild: ${guild.name} (${guild.id})`);
						const summaryChannelId = dailyChannelService.getSummaryChannel(guild.id);
						const configuredChannelIds = dailyChannelService.getChannels(guild.id);
						
						logInfo(`Summary channel ID: ${summaryChannelId}`);
						logInfo(`Configured channel IDs: [${configuredChannelIds.join(', ')}]`);

						if (!summaryChannelId) {
							logInfo(
								`❌ No summary channel configured for guild ${guild.name}`,
							);
							continue;
						}

						if (configuredChannelIds.length === 0) {
							logInfo(
								`❌ No daily summary channels configured for guild ${guild.name}`,
							);
							continue;
						}

						const summaryChannel = guild.channels.cache.get(summaryChannelId);
						if (!summaryChannel || summaryChannel.type !== ChannelType.GuildText) {
							logError(
								`Summary channel ${summaryChannelId} not found or not a text channel in guild ${guild.name}`,
							);
							continue;
						}

						const targetChannel = summaryChannel as TextChannel;

						const mockInteraction = {
							client: client,
							guild: guild,
							channel: targetChannel,
							user: { username: "System", displayName: "System" },
							deferReply: async () => ({ fetchReply: true }),
							editReply: async () => { },
						} as unknown as ChatInputCommandInteraction;

						// 全ての対象チャンネルからメッセージを収集してサマリーを生成
						logInfo(`Generating summary for guild ${guild.name}...`);
						const summary = await generateDailySummary(
							mockInteraction,
							configuredChannelIds
						);
						logInfo(`Summary generated, length: ${summary.length} characters`);

						if (
							summary.includes(
								"日次サマリー用のチャンネルが設定されていません",
							) ||
							summary.includes("今日はメッセージが見つかりませんでした")
						) {
							logInfo(
								`⚠️ Skipping guild ${guild.name} - no content to summarize`,
							);
							continue;
						}

						// 日付を追加してサマリーを投稿
						const today = new Date();
						const dateString = today.toLocaleDateString('ja-JP', {
							year: 'numeric',
							month: 'long',
							day: 'numeric',
							weekday: 'long'
						});

						const summaryWithDate = `# ${dateString}のサーバーニュース\n\n${summary}`;

						await targetChannel.send(summaryWithDate);

						logInfo(
							`Daily summary sent to ${guild.name}#${targetChannel.name}`,
						);
					} catch (error) {
						logError(
							`Error processing daily summary for guild ${guild.name}: ${error}`,
						);
					}
				}
			} catch (error) {
				logError(`Error in scheduled daily summary: ${error}`);
			}
		},
		{
			timezone: "Asia/Tokyo",
		},
	);

	logInfo("Daily summary scheduler initialized (23:20 JST)");
}
