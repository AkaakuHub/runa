import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { TTSService } from "../../services/TTSService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const TTSPitchCommand: CommandDefinition = {
	name: "tts_pitch",
	description: "TTSの音高を設定します",
	options: [
		{
			name: "pitch",
			description: "音高 (-10.0～10.0)",
			type: "NUMBER",
			required: true,
			min_value: -10.0,
			max_value: 10.0,
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

		const pitch = interaction.options.getNumber("pitch");
		const ttsService = TTSService.getInstance();

		try {
			if (pitch === null) {
				await interaction.reply({
					content: "音高を指定してください",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			ttsService.setPitch(pitch);

			await interaction.reply(`TTSの音高を${pitch}に設定しました 🎵`);

			logInfo(`TTS音高を${pitch}に設定しました`);
		} catch (error) {
			logError(`TTS音高設定エラー: ${error}`);
			await interaction.reply({
				content: "コマンドの実行中にエラーが発生しました",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
