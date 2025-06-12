import * as cron from "node-cron";
import { type Client, ChannelType, type TextChannel, type ChatInputCommandInteraction } from "discord.js";
import { generateDailySummary } from "../commands/DailySummary";
import { logInfo, logError } from "./logger";
import { dailyChannelService } from "../services/DailyChannelService";

export function setupDailySummaryScheduler(client: Client): void {
	cron.schedule('50 23 * * *', async () => {
		try {
			logInfo("Starting scheduled daily summary generation...");
			
			const guilds = client.guilds.cache;
			
			for (const [, guild] of guilds) {
				try {
					const configuredChannelIds = dailyChannelService.getChannels(guild.id);
					
					if (configuredChannelIds.length === 0) {
						logInfo(`No daily summary channels configured for guild ${guild.name}`);
						continue;
					}

					let targetChannel: TextChannel | null = null;

					// 設定されたチャンネルの最初のものを投稿先として使用
					const firstChannelId = configuredChannelIds[0];
					const channel = guild.channels.cache.get(firstChannelId);
					
					if (channel && channel.type === ChannelType.GuildText) {
						targetChannel = channel as TextChannel;
					}

					if (!targetChannel) {
						logError(`No suitable channel found in guild ${guild.name}`);
						continue;
					}

					const mockInteraction = {
						client: client,
						guild: guild,
						user: { username: 'System', displayName: 'System' },
						deferReply: async () => ({ fetchReply: true }),
						editReply: async () => {},
					} as ChatInputCommandInteraction;

					const summary = await generateDailySummary(mockInteraction);
					
					if (summary.includes("日次サマリー用のチャンネルが設定されていません")) {
						logInfo(`Skipping guild ${guild.name} - no channels configured`);
						continue;
					}
					
					await targetChannel.send(summary);
					
					logInfo(`Daily summary sent to ${guild.name}#${targetChannel.name}`);
					
				} catch (error) {
					logError(`Error sending daily summary to guild ${guild.name}: ${error}`);
				}
			}
			
		} catch (error) {
			logError(`Error in scheduled daily summary: ${error}`);
		}
	}, {
		timezone: "Asia/Tokyo"
	});

	logInfo("Daily summary scheduler initialized (23:50 JST)");
}