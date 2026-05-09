import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { reminderService } from "../../services/ReminderService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { buildReminderCanceledMessage } from "../../utils/reminderFormatter";

export const ReminderCancelCommand: CommandDefinition = {
	name: "remind-cancel",
	description: "登録中のリマインダーをキャンセルします。",
	options: [
		{
			name: "id",
			description: "`/reminders` に表示されるID",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			const id = interaction.options.getString("id", true);
			const result = await reminderService.cancelPendingForUser(
				id,
				interaction.user.id,
				interaction.guildId,
			);

			switch (result) {
				case "canceled":
					await interaction.reply({
						content: buildReminderCanceledMessage(id),
						flags: MessageFlags.Ephemeral,
					});
					logInfo(`Reminder canceled by ${interaction.user.username}: ${id}`);
					return;
				case "ambiguous":
					await interaction.reply({
						content:
							"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
						flags: MessageFlags.Ephemeral,
					});
					return;
				case "not_found":
					await interaction.reply({
						content: "そのIDのリマインダーは見つかりませんでした。",
						flags: MessageFlags.Ephemeral,
					});
					return;
			}
		} catch (error) {
			logError(`Error canceling reminder: ${error}`);
			await interaction.reply({
				content: "リマインダーのキャンセル中にエラーが発生しました。",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
