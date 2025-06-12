import * as cron from "node-cron";
import { type Client, ChannelType, type TextChannel } from "discord.js";
import { generateDailySummary } from "../commands/DailySummary";
import { logInfo, logError } from "./logger";

export function setupDailySummaryScheduler(client: Client): void {
	cron.schedule('50 23 * * *', async () => {
		try {
			logInfo("Starting scheduled daily summary generation...");
			
			const guilds = client.guilds.cache;
			
			for (const [guildId, guild] of guilds) {
				try {
					const systemChannel = guild.systemChannel;
					let targetChannel: TextChannel | null = null;

					if (systemChannel && systemChannel.type === ChannelType.GuildText) {
						targetChannel = systemChannel;
					} else {
						const textChannels = guild.channels.cache.filter(
							channel => channel.type === ChannelType.GuildText
						) as Map<string, TextChannel>;
						
						const generalChannel = textChannels.find(channel => 
							channel.name.includes('general') || 
							channel.name.includes('雑談') ||
							channel.name.includes('全体')
						);
						
						if (generalChannel) {
							targetChannel = generalChannel;
						} else if (textChannels.size > 0) {
							targetChannel = textChannels.first() || null;
						}
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
					} as any;

					const summary = await generateDailySummary(mockInteraction);
					
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