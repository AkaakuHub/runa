import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";
import { getChannelContextScopeId } from "../../utils/chatContextScope";
import { generateChatResponse } from "../../utils/chatResponse";
import { checkCommandCooldown } from "../../utils/commandCooldown";
import { logError } from "../../utils/logger";
import { editAndFollowUpLongMessage } from "../../utils/messageUtils";

const CHAT_COOLDOWN_MS = 0;

export const ChatCommand: CommandDefinition = {
	name: "chat",
	description: "AIとチャットします",
	options: [
		{
			name: "message",
			description: "AIに送信するメッセージ",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			const canExecute = await checkCommandCooldown(interaction, {
				commandName: "chat",
				cooldownMs: CHAT_COOLDOWN_MS,
			});

			if (!canExecute) {
				return;
			}

			await interaction.deferReply({
				ephemeral: true,
			});

			const message = interaction.options.getString("message", true);

			const response = await generateChatResponse(message, {
				contextScopeId: getChannelContextScopeId(
					interaction.guildId,
					interaction.channelId,
				),
				onProgress: async (content) => {
					await interaction.editReply({
						content: limitProgressContent(content),
					});
				},
			});

			// 少し遅延を入れて進捗表示が確実に更新されるようにする
			await new Promise((resolve) => setTimeout(resolve, 500));
			await editAndFollowUpLongMessage(interaction, response, true);
		} catch (error) {
			logError(`Error executing chat command: ${error}`);
			try {
				await interaction.editReply({
					content: "チャット中にエラーが発生しました。",
				});
			} catch (replyError) {
				logError(`Failed to send error message: ${replyError}`);
			}
		}
	},
};

function limitProgressContent(content: string): string {
	const maxLength = 1800;
	if (content.length <= maxLength) {
		return content;
	}

	return `${content.slice(0, maxLength - 20)}\n...省略しました。`;
}
