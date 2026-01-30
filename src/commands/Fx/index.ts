import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logInfo, logError } from "../../utils/logger";
import { convertTwitterLinks } from "../../utils/fxTwitter";
import { config } from "../../config/config";

export const FxCommand: CommandDefinition = {
	name: "fx",
	description:
		"同じチャンネルの直近のメッセージ内のTwitter/Xリンクをfxtwitterに変換します。",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
			});

			// 直近のメッセージを100件取得
			const messages = await interaction.channel?.messages.fetch({
				limit: 100,
			});

			if (!messages || messages.size === 0) {
				await interaction.editReply({
					content: "メッセージが見つかりませんでした。",
				});
				return;
			}

			// 最初に見つかったtwitter/xリンクを含むメッセージを探す（コマンドメッセージ自体はスキップ）
			const targetMessage = messages.find((msg) => {
				// コマンドメッセージ自体はスキップ
				if (msg.id === interaction.id) return false;
				// bot自身が投稿した変換済みメッセージはスキップ
				if (msg.author.id === config.clientId) return false;
				// twitter/xリンクが含まれているかチェック
				return convertTwitterLinks(msg.content).length > 0;
			});

			if (!targetMessage) {
				await interaction.editReply({
					content:
						"直近100件のメッセージにTwitter/Xリンクが含まれていませんでした。",
				});
				return;
			}

			// Twitter/Xリンクを変換
			const pairs = convertTwitterLinks(targetMessage.content);

			await interaction.editReply({
				content: pairs.join(" "),
			});

			logInfo(
				`fx command executed by ${interaction.user.username}, converted ${pairs.length} link(s)`,
			);
		} catch (error) {
			logError(`Error executing fx command: ${error}`);
			if (interaction.deferred) {
				await interaction.editReply({
					content: "エラーが発生しました。",
				});
			}
		}
	},
};
