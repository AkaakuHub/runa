import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { TTSService } from "../../services/TTSService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const TTSSpeedCommand: CommandDefinition = {
	name: "tts_speed",
	description: "TTSの読み上げ速度を設定します",
	options: [
		{
			name: "speed",
			description: "速度 (0.5-2.0)",
			type: "NUMBER",
			required: true,
			min_value: 0.5,
			max_value: 2.0,
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

		const speed = interaction.options.getNumber("speed");
		const ttsService = TTSService.getInstance();

		try {
			if (speed === null) {
				await interaction.reply({
					content: "速度を指定してください",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			ttsService.setSpeed(speed, interaction.guild.id);
			const updated = ttsService.getSpeedForGuild(interaction.guild.id);

			await interaction.reply(`TTSの読み上げ速度を${updated}に設定しました ⚡`);

			logInfo(`TTS速度を${updated}に設定しました`);
		} catch (error) {
			logError(`TTS速度設定エラー: ${error}`);
			await interaction.reply({
				content: "コマンドの実行中にエラーが発生しました",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
