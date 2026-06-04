import type { ChatInputCommandInteraction } from "discord.js";
import { MusicService } from "../../services/MusicService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const SkipCommand: CommandDefinition = {
	name: "skip",
	description: "現在再生中の曲をスキップします",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		if (!interaction.guild) {
			await interaction.reply("このコマンドはサーバー内でのみ使用できます");
			return;
		}

		try {
			const musicService = MusicService.getInstance(interaction.guild.id);

			if (!musicService.isCurrentlyPlaying()) {
				await interaction.reply("現在何も再生していません");
				return;
			}

			const skipped = musicService.skip();

			if (skipped) {
				await interaction.reply("現在の曲をスキップしました");
				logInfo(`曲をスキップ: ${interaction.guild.name}`);
			} else {
				await interaction.reply("スキップに失敗しました");
			}
		} catch (error) {
			logError(`skipコマンドエラー: ${error}`);
			await interaction.reply("エラーが発生しました");
		}
	},
};
