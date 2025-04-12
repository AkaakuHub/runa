import { Interaction } from "discord.js";
import { logError, logInfo } from "../utils/logger";
import { getCommandByName } from "../utils/useCommands";
import "../commands";

export const interactionCreateHandler = async (
	interaction: Interaction,
): Promise<void> => {
	// スラッシュコマンド以外は無視
	if (!interaction.isChatInputCommand()) return;

	try {
		const commandName = interaction.commandName;
		const command = getCommandByName(commandName);

		if (command) {
			await command.execute(interaction);
		} else {
			logInfo(`Unknown command: ${commandName}`);
		}
	} catch (error) {
		logError(`Error handling interaction: ${error}`);
	}
};
