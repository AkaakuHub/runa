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
		"50 23 * * *",
		async () => {
			try {
				logInfo("Starting scheduled daily summary generation...");

				const guilds = client.guilds.cache;

				for (const [, guild] of guilds) {
					try {
						const configuredChannelIds = dailyChannelService.getChannels(
							guild.id,
						);

						if (configuredChannelIds.length === 0) {
							logInfo(
								`No daily summary channels configured for guild ${guild.name}`,
							);
							continue;
						}

						// 各設定されたチャンネルに対して個別にサマリーを生成・投稿
						for (const channelId of configuredChannelIds) {
							try {
								const channel = guild.channels.cache.get(channelId);

								if (!channel || channel.type !== ChannelType.GuildText) {
									logError(
										`Channel ${channelId} not found or not a text channel in guild ${guild.name}`,
									);
									continue;
								}

								const targetChannel = channel as TextChannel;

								const mockInteraction = {
									client: client,
									guild: guild,
									channel: targetChannel,
									user: { username: "System", displayName: "System" },
									deferReply: async () => ({ fetchReply: true }),
									editReply: async () => { },
								} as unknown as ChatInputCommandInteraction;

								const summary = await generateDailySummary(
									mockInteraction,
									channelId,
								);

								if (
									summary.includes(
										"日次サマリー用のチャンネルが設定されていません",
									) ||
									summary.includes("今日はメッセージが見つかりませんでした")
								) {
									logInfo(
										`Skipping channel ${targetChannel.name} in guild ${guild.name} - no content`,
									);
									continue;
								}

								await targetChannel.send(summary);

								logInfo(
									`Daily summary sent to ${guild.name}#${targetChannel.name}`,
								);
							} catch (error) {
								logError(
									`Error sending daily summary to channel ${channelId} in guild ${guild.name}: ${error}`,
								);
							}
						}
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

	logInfo("Daily summary scheduler initialized (23:50 JST)");
}
