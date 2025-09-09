import type { ChatInputCommandInteraction } from "discord.js";
import { ChannelType, MessageFlags } from "discord.js";
import type { TextChannel } from "discord.js";
import { ChannelRegistryService } from "../../services/ChannelRegistryService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const RegisterCommand: CommandDefinition = {
	name: "register",
	description: "音楽コマンドを受け付けるチャンネルを登録/解除します",
	options: [
		{
			name: "action",
			description: "実行するアクション",
			type: "STRING",
			required: true,
			choices: [
				{
					name: "add - 現在のチャンネルを音楽コマンド用チャンネルとして登録",
					value: "add",
				},
				{
					name: "remove - 現在のチャンネルの登録を解除",
					value: "remove",
				},
				{
					name: "list - 登録済みチャンネル一覧を表示",
					value: "list",
				},
			],
		},
	],

	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply();

			if (!interaction.guild) {
				await interaction.editReply(
					"このコマンドはサーバー内でのみ使用できます",
				);
				return;
			}

			const registry = ChannelRegistryService.getInstance();
			const action = interaction.options.getString("action");

			const guildId = interaction.guildId;
			if (!guildId) {
				await interaction.editReply("ギルドIDが取得できませんでした");
				return;
			}

			// アクションに基づいて処理を分岐
			switch (action) {
				case "add": {
					const channelId = interaction.channelId;
					const channel = interaction.channel as TextChannel;

					if (channel.type !== ChannelType.GuildText) {
						await interaction.editReply("テキストチャンネルでのみ登録できます");
						return;
					}

					const result = registry.registerChannel(guildId, channelId);
					if (result) {
						await interaction.editReply(
							`チャンネル「${channel.name}」を音楽コマンド用チャンネルとして登録しました`,
						);
						logInfo(
							`チャンネル「${channel.name}」を登録: ${interaction.guild.name}`,
						);
					} else {
						await interaction.editReply("このチャンネルは既に登録されています");
					}
					break;
				}
				case "remove": {
					const channelId = interaction.channelId;
					const channel = interaction.channel as TextChannel;

					const result = registry.unregisterChannel(guildId, channelId);
					if (result) {
						await interaction.editReply(
							`チャンネル「${channel.name}」の登録を解除しました`,
						);
						logInfo(
							`チャンネル「${channel.name}」の登録を解除: ${interaction.guild.name}`,
						);
					} else {
						await interaction.editReply("このチャンネルは登録されていません");
					}
					break;
				}
				case "list": {
					const channels = registry.getRegisteredChannels(guildId);

					if (channels.length === 0) {
						await interaction.editReply(
							"このサーバーには登録済みの音楽コマンドチャンネルがありません",
						);
						return;
					}

					const channelList = channels
						.map((id) => {
							const channel = interaction.client.channels.cache.get(id);
							return channel ? `<#${id}>` : `不明なチャンネル (${id})`;
						})
						.join("\n");

					await interaction.editReply(
						`**登録済み音楽コマンドチャンネル:**\n${channelList}`,
					);
					break;
				}
				default: {
					// 想定外のアクション値が来た場合の親切なガイド
					await interaction.editReply(
						"無効なアクションです。以下のいずれかを選択してください：\n" +
							"・`add` - 現在のチャンネルを音楽コマンド用チャンネルとして登録します\n" +
							"・`remove` - 現在のチャンネルの登録を解除します\n" +
							"・`list` - 登録済みチャンネル一覧を表示します",
					);
				}
			}
		} catch (error) {
			logError(`registerコマンドエラー: ${error}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "エラーが発生しました",
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await interaction.editReply("エラーが発生しました");
			}
		}
	},
};
