import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const PingCommand: CommandDefinition = {
	name: "ping",
	description: "応答速度を確認します。",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
			});
			const latency = Date.now() - interaction.createdTimestamp;

			await interaction.editReply({
				content: `Pong! 🏓\nレイテンシ: ${latency}ms`,
			});

			logInfo(
				`Ping command executed by ${interaction.user.username}, latency: ${latency}ms`,
			);
		} catch (error) {
			logError(`Error executing ping command: ${error}`);
		}
	},
};
