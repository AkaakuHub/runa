import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import {
	MAX_PENDING_REMINDERS_PER_USER,
	reminderService,
} from "../../services/ReminderService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { buildReminderRegisteredMessage } from "../../utils/reminderFormatter";
import { parseReminderText } from "../../utils/reminderParser";

export const ReminderCommand: CommandDefinition = {
	name: "remind",
	description: "自然文でリマインダーを登録します。",
	options: [
		{
			name: "text",
			description: "例: 明日の9時に燃えるゴミ、30分後に洗濯物",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
			});

			const text = interaction.options.getString("text", true);
			const parsed = await parseReminderText(text);

			if (!parsed.ok) {
				await interaction.editReply({
					content: buildParseFailureMessage(parsed.reason, parsed.question),
				});
				return;
			}

			const createResult = await reminderService.create({
				guildId: interaction.guildId,
				channelId: interaction.channelId,
				userId: interaction.user.id,
				remindAt: parsed.remindAt,
				message: parsed.message,
				source: "slash",
			});

			if (createResult.status === "limit_exceeded") {
				await interaction.editReply({
					content: `未完了のリマインダーは1人${MAX_PENDING_REMINDERS_PER_USER}件までです。不要なリマインダーをキャンセルしてください。`,
				});
				return;
			}

			await interaction.editReply({
				content: buildReminderRegisteredMessage(
					parsed.remindAt,
					parsed.message,
				),
			});

			logInfo(
				`Reminder registered by ${interaction.user.username}: ${parsed.remindAt.toISOString()} "${parsed.message}"`,
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

function buildParseFailureMessage(reason: string, question?: string): string {
	if (question) {
		return `${reason}\n${question}`;
	}
	return reason;
}
