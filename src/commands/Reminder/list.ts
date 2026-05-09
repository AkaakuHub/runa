import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { reminderService } from "../../services/ReminderService";
import type { CommandDefinition } from "../../types";
import { logError } from "../../utils/logger";
import { buildReminderListMessage } from "../../utils/reminderFormatter";

export const ReminderListCommand: CommandDefinition = {
	name: "reminders",
	description: "登録中のリマインダー一覧を表示します。",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			const reminders = reminderService.listPendingForUser(
				interaction.user.id,
				interaction.guildId,
			);
			await interaction.reply({
				content: buildReminderListMessage(reminders),
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			logError(`Error listing reminders: ${error}`);
			await interaction.reply({
				content: "リマインダー一覧の取得中にエラーが発生しました。",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
