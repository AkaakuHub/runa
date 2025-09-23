import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { TTSService } from "../../services/TTSService";

export const TTSVolumeCommand: CommandDefinition = {
	name: "tts_volume",
	description: "TTSの音量を設定します",
	options: [
		{
			name: "volume",
			description: "音量 (0.0-1.0)",
			type: "NUMBER",
			required: true,
			min_value: 0.0,
			max_value: 1.0,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		if (!interaction.guild) {
			await interaction.reply({
				content: "このコマンドはサーバー内でのみ使用できます",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const volume = interaction.options.getNumber("volume");
		const ttsService = TTSService.getInstance();

		try {
			if (volume === null) {
				await interaction.reply({
					content: "音量を指定してください",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			ttsService.setVolume(volume);

			await interaction.reply(
				`TTSの音量を${Math.round(volume * 100)}%に設定しました 🔊`,
			);

			logInfo(`TTS音量を${volume}に設定しました`);
		} catch (error) {
			logError(`TTS音量設定エラー: ${error}`);
			await interaction.reply({
				content: "コマンドの実行中にエラーが発生しました",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
