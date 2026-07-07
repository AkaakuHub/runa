import type { ChatInputCommandInteraction } from "discord.js";
import { chatContextRepository } from "../../db/chatContextRepository";
import type { CommandDefinition } from "../../types";
import { getChannelContextScopeId } from "../../utils/chatContextScope";
import { logError, logInfo } from "../../utils/logger";

export const ChatContextClearCommand: CommandDefinition = {
	name: "chat-context-clear",
	description: "このチャンネルの会話コンテキストをクリアします",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			const scopeId = getChannelContextScopeId(
				interaction.guildId,
				interaction.channelId,
			);
			chatContextRepository.clear(scopeId);

			await interaction.reply({
				content: "このチャンネルの会話コンテキストをクリアしました。",
				ephemeral: false,
			});

			logInfo(
				`Chat context cleared: guild=${interaction.guildId ?? "dm"} channel=${interaction.channelId} user=${interaction.user.id}`,
			);
		} catch (error) {
			logError(`Error clearing chat context: ${error}`);
			await interaction.reply({
				content: "会話コンテキストのクリアに失敗しました。",
				ephemeral: true,
			});
		}
	},
};
