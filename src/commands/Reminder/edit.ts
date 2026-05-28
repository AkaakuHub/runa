import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { reminderService } from "../../services/ReminderService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { buildReminderEditedMessage } from "../../utils/reminderFormatter";
import { parseReminderRepeatInput } from "../../utils/reminderRecurrence";
import {
	getJSTDateInputFromDate,
	getJSTTimeInputFromDate,
	JST_DATE_OPTION_DESCRIPTION,
	JST_TIME_OPTION_DESCRIPTION,
	parseJSTDateTimeInput,
} from "../../utils/slashDateTime";

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
			name: "date",
			description: JST_DATE_OPTION_DESCRIPTION,
			type: "STRING",
			required: false,
		},
		{
			name: "time",
			description: JST_TIME_OPTION_DESCRIPTION,
			type: "STRING",
			required: false,
		},
		{
			name: "message",
			description: "新しいリマインド内容",
			type: "STRING",
			required: false,
		},
		{
			name: "repeat",
			description: "繰り返し",
			type: "STRING",
			required: false,
			choices: [
				{ name: "変更しない", value: "keep" },
				{ name: "なし", value: "none" },
				{ name: "毎日", value: "daily" },
				{ name: "毎週", value: "weekly" },
			],
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: true,
			});

			const id = interaction.options.getString("id", true);
			const date = interaction.options.getString("date");
			const time = interaction.options.getString("time");
			const message = interaction.options.getString("message")?.trim();
			const repeatInput = interaction.options.getString("repeat");
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

			if (!date && !time && !message && !repeatInput) {
				await interaction.editReply({
					content:
						"変更する日付、時刻、内容、繰り返しのいずれかを指定してください。",
				});
				return;
			}

			const currentRemindAt = new Date(currentReminder.remindAt);
			const newDate = date ?? getJSTDateInputFromDate(currentRemindAt);
			const newTime = time ?? getJSTTimeInputFromDate(currentRemindAt);
			let remindAt: Date | undefined;
			if (date || time) {
				try {
					remindAt = parseJSTDateTimeInput(newDate, newTime);
				} catch (parseError) {
					await interaction.editReply({
						content:
							parseError instanceof Error
								? parseError.message
								: "日時の形式を読み取れませんでした。",
					});
					return;
				}

				if (remindAt.getTime() <= Date.now()) {
					await interaction.editReply({
						content: "未来の日時を指定してください。",
					});
					return;
				}
			}

			const result = await reminderService.editPendingForUser(
				id,
				interaction.user.id,
				interaction.guildId,
				{
					remindAt,
					message,
					repeat:
						repeatInput && repeatInput !== "keep"
							? parseReminderRepeatInput(repeatInput)
							: undefined,
					clearRepeat: repeatInput === "none",
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
