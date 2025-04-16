import type { ChatInputCommandInteraction } from "discord.js";
import { ChannelType } from "discord.js";
import type { TextChannel } from "discord.js";
import { ChannelRegistryService } from "../../services/ChannelRegistryService";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const RegisterCommand: CommandDefinition = {
	name: "register",
	description: "音楽コマンドを受け付けるチャンネルを登録/解除します",
	options: [
		{
			name: "add",
			description: "現在のチャンネルを音楽コマンド用チャンネルとして登録します",
			type: "STRING",
			required: true,
		},
		{
			name: "remove",
			description: "現在のチャンネルの音楽コマンドチャンネル登録を解除します",
			type: "STRING",
			required: true,
		},
		{
			name: "list",
			description: "登録済みの音楽コマンドチャンネル一覧を表示します",
			type: "STRING",
			required: true,
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
			const subcommand = interaction.options.getSubcommand();

			const guildId = interaction.guildId;
			if (!guildId) {
				await interaction.editReply("ギルドIDが取得できませんでした");
				return;
			}

			if (subcommand === "add") {
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
			} else if (subcommand === "remove") {
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
			} else if (subcommand === "list") {
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
			}
		} catch (error) {
			logError(`registerコマンドエラー: ${error}`);
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: "エラーが発生しました",
					ephemeral: true,
				});
			} else {
				await interaction.editReply("エラーが発生しました");
			}
		}
	},
};

export default RegisterCommand;
