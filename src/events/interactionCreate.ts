import { MessageFlags } from "discord.js";
import type { Interaction } from "discord.js";
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
			// interactionがまだ有効か確認
			if (interaction.replied || interaction.deferred) {
				logInfo(`Interaction already handled for command: ${commandName}`);
				return;
			}

			// タイムアウトを防ぐためにdeferReplyを実行
			await interaction.deferReply();

			await command.execute(interaction);
		} else {
			logInfo(`Unknown command: ${commandName}`);
		}
	} catch (error) {
		logError(`Error handling interaction: ${error}`);

		// エラー時、まだ返信していない場合はエラーメッセージを送信
		try {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "コマンドの実行中にエラーが発生しました。",
					flags: [MessageFlags.Ephemeral],
				});
			}
		} catch (replyError) {
			logError(`Failed to send error message: ${replyError}`);
		}
	}
};
