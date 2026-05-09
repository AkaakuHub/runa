import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { reminderService } from "../../services/ReminderService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { buildReminderEditedMessage } from "../../utils/reminderFormatter";
import { parseReminderEditText } from "../../utils/reminderParser";

export const ReminderEditCommand: CommandDefinition = {
	name: "remind-edit",
	description: "登録中のリマインダーの日時や内容を変更します。",
	options: [
		{
			name: "id",
			description: "`/reminders` に表示されるID",
			type: "STRING",
			required: true,
		},
		{
			name: "text",
			description: "例: 明日の9時に変更、内容を牛乳に変更",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: true,
			});

			const id = interaction.options.getString("id", true);
			const text = interaction.options.getString("text", true);
			const currentReminder = reminderService.findPendingForUser(
				id,
				interaction.user.id,
				interaction.guildId,
			);

			if (currentReminder === "ambiguous") {
				await interaction.editReply({
					content:
						"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
				});
				return;
			}
			if (currentReminder === "not_found") {
				await interaction.editReply({
					content: "そのIDのリマインダーは見つかりませんでした。",
				});
				return;
			}

			const parsed = await parseReminderEditText(text, new Date(), {
				remindAt: new Date(currentReminder.remindAt),
				message: currentReminder.message,
			});

			if (!parsed.ok) {
				await interaction.editReply({
					content: buildParseFailureMessage(parsed.reason, parsed.question),
				});
				return;
			}

			const result = await reminderService.editPendingForUser(
				id,
				interaction.user.id,
				interaction.guildId,
				{
					remindAt: parsed.remindAt,
					message: parsed.message,
				},
			);

			switch (result.status) {
				case "edited":
					await interaction.editReply({
						content: buildReminderEditedMessage(result.reminder),
					});
					logInfo(`Reminder edited by ${interaction.user.username}: ${id}`);
					return;
				case "ambiguous":
					await interaction.editReply({
						content:
							"そのIDに一致するリマインダーが複数あります。もう少し長いIDを指定してください。",
					});
					return;
				case "not_found":
					await interaction.editReply({
						content: "そのIDのリマインダーは見つかりませんでした。",
					});
					return;
			}
		} catch (error) {
			logError(`Error editing reminder: ${error}`);
			const content = "リマインダーの編集中にエラーが発生しました。";
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ content });
				return;
			}
			await interaction.reply({
				content,
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
