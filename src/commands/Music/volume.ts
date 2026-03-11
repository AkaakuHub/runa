import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { MusicService } from "../../services/MusicService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const VolumeCommand: CommandDefinition = {
	name: "music_volume",
	description: "音楽の音量を設定します (0-200, デフォルト10)",
	options: [
		{
			name: "level",
			description: "音量レベル (0-200, デフォルト10)",
			type: "INTEGER",
			required: true,
			min_value: 0,
			max_value: 200,
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

		const level = interaction.options.getInteger("level", true);

		try {
			const musicService = MusicService.getInstance();
			const success = musicService.setVolume(level, interaction.guild.id);

			if (success) {
				await interaction.reply(
					`音楽の音量を ${level}% に設定しました。再生中の曲には次の曲から反映されます。`,
				);
				logInfo(
					`音楽音量変更: ${level}% by ${interaction.user.tag} in ${interaction.guild.name}`,
				);
			} else {
				await interaction.reply({
					content: "音量の設定に失敗しました",
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch (error) {
			logError(`volumeコマンドエラー: ${error}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "音量調整中にエラーが発生しました",
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await interaction.editReply("音量調整中にエラーが発生しました");
			}
		}
	},
};
