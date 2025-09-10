import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { TTSService } from "../../services/TTSService";

export const TTSSpeakerCommand: CommandDefinition = {
	name: "tts_speaker",
	description: "TTSの音声キャラクターを設定します",
	options: [
		{
			name: "speaker",
			description: "話者ID",
			type: "INTEGER",
			required: true,
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

		const speaker = interaction.options.getInteger("speaker");
		const ttsService = TTSService.getInstance();

		try {
			if (speaker === null) {
				await interaction.reply({
					content: "話者IDを指定してください",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const success = ttsService.setSpeaker(speaker);

			if (success) {
				await interaction.reply(
					`TTSの音声キャラクターを話者ID ${speaker} に設定しました 🎤`,
				);
				logInfo(`TTS話者を${speaker}に設定しました`);
			} else {
				await interaction.reply({
					content:
						"指定された話者IDは無効です。利用可能な話者IDを確認してください。",
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch (error) {
			logError(`TTS話者設定エラー: ${error}`);
			await interaction.reply({
				content: "コマンドの実行中にエラーが発生しました",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
