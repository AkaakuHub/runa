import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { TTSService } from "../../services/TTSService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const TTSSkipCommand: CommandDefinition = {
	name: "tts_skip",
	description: "現在再生中のTTSを1件スキップします",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		if (!interaction.guild) {
			await interaction.reply({
				content: "このコマンドはサーバー内でのみ使用できます",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			const ttsService = TTSService.getInstance();
			if (!ttsService.isCurrentlyPlaying()) {
				await interaction.reply({
					content: "現在再生中のTTSはありません",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const skipped = await ttsService.skipCurrent();
			if (!skipped) {
				await interaction.reply({
					content: "TTSのスキップに失敗しました",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			await interaction.reply("現在再生中のTTSをスキップしました ⏭️");
			logInfo(`TTSをスキップ: ${interaction.guild.name}`);
		} catch (error) {
			logError(`tts_skipコマンドエラー: ${error}`);
			await interaction.reply({
				content: "コマンドの実行中にエラーが発生しました",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
