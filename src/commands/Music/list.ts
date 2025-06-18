import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { CommandDefinition } from "../../types";
import { MusicService } from "../../services/MusicService";
import { logError, logInfo } from "../../utils/logger";

export const ListCommand: CommandDefinition = {
	name: "list",
	description: "現在の再生キューを表示します",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		if (!interaction.guild) {
			await interaction.reply({
				content: "このコマンドはサーバー内でのみ使用できます",
				ephemeral: true,
			});
			return;
		}

		try {
			const musicService = MusicService.getInstance();
			const currentTrack = musicService.getCurrentPlayingUrl();
			const queue = musicService.getCurrentQueue(interaction.guild.id);

			const embed = new EmbedBuilder()
				.setColor(0x0099ff)
				.setTitle("再生キュー");

			if (currentTrack) {
				embed.addFields({ name: "再生中", value: currentTrack });
			} else {
				embed.setDescription("現在再生中の曲はありません。");
			}

			if (queue.length > 0) {
				// キューが長い場合、表示件数を制限する（例：最初の10件）
				const queueString = queue
					.slice(0, 10)
					.map((track, index) => `${index + 1}. ${track}`)
					.join("\n");
				embed.addFields({
					name: `待機中 (${queue.length}曲)`,
					value: queueString,
				});
				if (queue.length > 10) {
					embed.setFooter({ text: `他 ${queue.length - 10} 曲が待機中...` });
				}
			} else if (!currentTrack) {
				// 再生中でもなくキューも空の場合
				embed.setDescription("キューは空です。");
			}

			await interaction.reply({ embeds: [embed] });
			logInfo(
				`キュー表示実行 by ${interaction.user.tag} in ${interaction.guild.name}`,
			);
		} catch (error) {
			logError(`listコマンドエラー: ${error}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "キューの表示中にエラーが発生しました",
					ephemeral: true,
				});
			} else {
				await interaction.editReply("キューの表示中にエラーが発生しました");
			}
		}
	},
};
