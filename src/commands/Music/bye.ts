import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";
import { MusicService } from "../../services/MusicService";
import { logError, logInfo } from "../../utils/logger";

export const ByeCommand: CommandDefinition = {
	name: "bye",
	description: "ボットをボイスチャンネルから退出させます",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		if (!interaction.guild) {
			await interaction.reply("このコマンドはサーバー内でのみ使用できます");
			return;
		}

		try {
			const musicService = MusicService.getInstance();
			const left = musicService.leaveChannel(interaction.guild.id);

			if (left) {
				await interaction.reply("ボイスチャンネルから退出しました");
				logInfo(`ボイスチャンネルから退出: ${interaction.guild.name}`);
			} else {
				await interaction.reply("ボイスチャンネルに接続していません");
			}
		} catch (error) {
			logError(`byeコマンドエラー: ${error}`);
			await interaction.reply("エラーが発生しました");
		}
	},
};
