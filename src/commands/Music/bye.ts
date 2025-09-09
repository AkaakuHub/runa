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
			// キューを保持したまま退出する（clearQueue = false）
			const left = musicService.leaveChannel(interaction.guild.id, false);

			if (left) {
				await interaction.reply("ボイスチャンネルから退出しました。キューは保持されていますので、再接続すると続きから再生できます。");
				logInfo(`ボイスチャンネルから退出（キュー保持）: ${interaction.guild.name}`);
			} else {
				await interaction.reply("ボイスチャンネルに接続していません");
			}
		} catch (error) {
			logError(`byeコマンドエラー: ${error}`);
			await interaction.reply("エラーが発生しました");
		}
	},
};
