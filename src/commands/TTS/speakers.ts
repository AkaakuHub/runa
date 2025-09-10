import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { TTSService } from "../../services/TTSService";
import { replyLongMessage } from "../../utils/messageUtils";

export const TTSSpeakersCommand: CommandDefinition = {
	name: "tts_speakers",
	description: "利用可能な音声キャラクター一覧を表示します",
	options: [],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		if (!interaction.guild) {
			await interaction.reply({
				content: "このコマンドはサーバー内でのみ使用できます",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const ttsService = TTSService.getInstance();

		try {
			// まずdeferReplyで応答を遅延させる
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const characters = await ttsService.getVoiceCharacters();

			if (characters.length === 0) {
				await interaction.editReply({
					content:
						"音声キャラクター情報を取得できませんでした。VOICEVOXエンジンが起動しているか確認してください。",
				});
				return;
			}

			let speakerList = "**利用可能な音声キャラクター**\n\n";

			for (const character of characters) {
				speakerList += `🔸 **${character.name}**\n`;
				for (const style of character.styles) {
					speakerList += `- 話者ID: ${style.id} (${style.name})\n`;
				}
				speakerList += "\n";
			}

			speakerList += "---\n";
			speakerList += "使用例: `/tts_speaker speaker:3` (ずんだもん)";

			await interaction.editReply({
				content: "音声キャラクター一覧を取得しました。",
			});

			// replyLongMessageを使用して長いメッセージを送信
			await replyLongMessage(interaction, speakerList);

			logInfo("音声キャラクター一覧を表示しました");
		} catch (error) {
			logError(`TTS話者一覧取得エラー: ${error}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "コマンドの実行中にエラーが発生しました",
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await interaction.editReply({
					content: "コマンドの実行中にエラーが発生しました",
				});
			}
		}
	},
};
