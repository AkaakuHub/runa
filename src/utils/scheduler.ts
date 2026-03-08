import {
	ChannelType,
	type ChatInputCommandInteraction,
	type Client,
	type TextChannel,
} from "discord.js";
import * as cron from "node-cron";
import { generateDailySummary } from "../commands/DailySummary";
import { dailyChannelService } from "../services/DailyChannelService";
import { getCurrentJSTDateString } from "./dateUtils";
import { logDebug, logError, logInfo, logWarn } from "./logger";
import { splitMessage } from "./messageUtils";

export function setupDailySummaryScheduler(client: Client): void {
	cron.schedule(
		"50 23 * * *",
		async () => {
			try {
				logInfo("🕒 Daily summary cron job triggered at 23:50 JST");
				logDebug("Starting scheduled daily summary generation...");

				const guilds = client.guilds.cache;
				logDebug(`Found ${guilds.size} guilds to process`);

				for (const [, guild] of guilds) {
					try {
						logDebug(`Processing guild: ${guild.name} (${guild.id})`);
						const summaryChannelId = dailyChannelService.getSummaryChannel(
							guild.id,
						);
						const configuredChannelIds = dailyChannelService.getChannels(
							guild.id,
						);

						logDebug(`Summary channel ID: ${summaryChannelId}`);
						logDebug(
							`Configured channel IDs: [${configuredChannelIds.join(", ")}]`,
						);

						if (!summaryChannelId) {
							logWarn(
								`❌ No summary channel configured for guild ${guild.name}`,
							);
							continue;
						}

						if (configuredChannelIds.length === 0) {
							logWarn(
								`❌ No daily summary channels configured for guild ${guild.name}`,
							);
							continue;
						}

						const summaryChannel = guild.channels.cache.get(summaryChannelId);
						if (
							!summaryChannel ||
							summaryChannel.type !== ChannelType.GuildText
						) {
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
							editReply: async () => {},
						} as unknown as ChatInputCommandInteraction;

						// 全ての対象チャンネルからメッセージを収集してサマリーを生成
						logDebug(`Generating summary for guild ${guild.name}...`);
						// 時間シードの可能性があるので0~2秒の間で、ミリ秒単位でランダムに待機
						const delayMs = Math.floor(Math.random() * 2000);
						await new Promise((resolve) => setTimeout(resolve, delayMs));
						const summary = await generateDailySummary(
							mockInteraction,
							configuredChannelIds,
						);
						logDebug(`Summary generated, length: ${summary.length} characters`);

						if (
							summary.includes(
								"日次サマリー用のチャンネルが設定されていません",
							) ||
							summary.includes("今日はメッセージが見つかりませんでした")
						) {
							logWarn(
								`⚠️ Skipping guild ${guild.name} - no content to summarize`,
							);
							continue;
						}

						// 統一されたユーティリティを使用して日付を取得
						const dateString = getCurrentJSTDateString();
						const summaryWithDate = `# ${dateString}のサーバーニュース\n\n${summary}`;

						// メッセージが2000文字を超える場合は分割送信
						if (summaryWithDate.length <= 2000) {
							await targetChannel.send(summaryWithDate);
						} else {
							logDebug(
								`Message too long (${summaryWithDate.length} chars), splitting...`,
							);
							const chunks = splitMessage(summaryWithDate, 2000);
							for (const chunk of chunks) {
								await targetChannel.send(chunk);
							}
						}

						logInfo(
							`✅ Daily summary sent to ${guild.name}#${targetChannel.name}`,
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

	logInfo("Daily summary scheduler initialized (23:50 JST)");
}
