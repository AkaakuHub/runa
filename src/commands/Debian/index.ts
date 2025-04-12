import { ChatInputCommandInteraction } from "discord.js";
import { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const DebianCommand: CommandDefinition = {
	name: "debian",
	description: "Debianのロゴを表示します。",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.reply({
				content: "ﾃﾞﾋﾞｱﾝ",
				files: ["assets/images/distro/debian.png"],
			});
			logInfo("Debian command executed");
		} catch (error) {
			logError(`Error executing debian command: ${error}`);
		}
	},
};
