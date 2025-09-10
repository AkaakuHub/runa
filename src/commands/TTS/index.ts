import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { TTSService } from "../../services/TTSService";

export const TTSCommand: CommandDefinition = {
	name: "tts",
	description: "TTS（テキスト読み上げ）機能を有効/無効にします",
	options: [
		{
			name: "action",
			description: "実行するアクション",
			type: "STRING",
			required: true,
			choices: [
				{ name: "有効にする", value: "on" },
				{ name: "無効にする", value: "off" },
				{ name: "状態を確認", value: "status" },
			],
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

		const action = interaction.options.getString("action");
		const ttsService = TTSService.getInstance();

		try {
			switch (action) {
				case "on":
					ttsService.setEnabled(true);
					await interaction.reply(
						"TTS機能を有効にしました 🎤\nメッセージを読み上げるには、ボイスチャンネルに接続してください。",
					);
					logInfo("TTS機能が有効になりました");
					break;
				case "off":
					ttsService.setEnabled(false);
					await interaction.reply("TTS機能を無効にしました 🔇");
					logInfo("TTS機能が無効になりました");
					break;
				case "status": {
					const config = ttsService.getConfig();
					const statusText = `
**TTS機能設定**
- 状態: ${config.enabled ? "✅ 有効" : "❌ 無効"}
- 音声キャラクター: ${config.speaker}
- 読み上げ速度: ${config.speed}
- 音量: ${Math.round(config.volume * 100)}%
- 音高: ${config.pitch}
- VOICEVOX URL: ${config.voicevoxUrl}
					`.trim();
					await interaction.reply({
						content: statusText,
						flags: MessageFlags.Ephemeral,
					});
					break;
				}
				default:
					await interaction.reply({
						content: "不明なアクションです",
						flags: MessageFlags.Ephemeral,
					});
			}
		} catch (error) {
			logError(`TTSコマンドエラー: ${error}`);
			await interaction.reply({
				content: "コマンドの実行中にエラーが発生しました",
				flags: MessageFlags.Ephemeral,
			});
		}
	},
};
