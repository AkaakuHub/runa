import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import {
	MAX_PENDING_REMINDERS_PER_USER,
	reminderService,
} from "../../services/ReminderService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { buildReminderRegisteredMessage } from "../../utils/reminderFormatter";
import {
	JST_DATE_OPTION_DESCRIPTION,
	JST_TIME_OPTION_DESCRIPTION,
	parseJSTDateTimeInput,
} from "../../utils/slashDateTime";

export const ReminderCommand: CommandDefinition = {
	name: "remind",
	description: "日時と内容を指定してリマインダーを登録します。",
	options: [
		{
			name: "date",
			description: JST_DATE_OPTION_DESCRIPTION,
			type: "STRING",
			required: true,
		},
		{
			name: "time",
			description: JST_TIME_OPTION_DESCRIPTION,
			type: "STRING",
			required: true,
		},
		{
			name: "message",
			description: "リマインド内容",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
			});

			const date = interaction.options.getString("date", true);
			const time = interaction.options.getString("time", true);
			const message = interaction.options.getString("message", true).trim();

			if (!message) {
				await interaction.editReply({
					content: "リマインド内容を指定してください。",
				});
				return;
			}

			let remindAt: Date;
			try {
				remindAt = parseJSTDateTimeInput(date, time);
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

			const createResult = await reminderService.create({
				guildId: interaction.guildId,
				channelId: interaction.channelId,
				userId: interaction.user.id,
				remindAt,
				message,
				source: "slash",
			});

			if (createResult.status === "limit_exceeded") {
				await interaction.editReply({
					content: `未完了のリマインダーは1人${MAX_PENDING_REMINDERS_PER_USER}件までです。不要なリマインダーをキャンセルしてください。`,
				});
				return;
			}

			await interaction.editReply({
				content: buildReminderRegisteredMessage(remindAt, message),
			});

			logInfo(
				`Reminder registered by ${interaction.user.username}: ${remindAt.toISOString()} "${message}"`,
			);
		} catch (error) {
			logError(`Error executing remind command: ${error}`);
			try {
				const content = "リマインダー登録中にエラーが発生しました。";
				if (interaction.deferred || interaction.replied) {
					await interaction.editReply({ content });
				} else {
					await interaction.reply({
						content,
						flags: MessageFlags.Ephemeral,
					});
				}
			} catch (replyError) {
				logError(`Failed to send remind error message: ${replyError}`);
			}
		}
	},
};
