import type {
	ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
	TextChannel,
	VoiceChannel,
} from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { MusicService } from "../../services/MusicService";

export const JoinCommand: CommandDefinition = {
	name: "join",
	description: "ボットをボイスチャンネルに参加させます",
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		if (!interaction.guild) {
			await interaction.reply({
				content: "このコマンドはサーバー内でのみ使用できます",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// deferReply を ephemeral: false で実行
		await interaction.deferReply();

		try {
			const member = interaction.member as GuildMember;

			// ユーザーがボイスチャンネルにいるか確認
			const voiceChannel = member.voice.channel as VoiceChannel;
			if (!voiceChannel) {
				await interaction.editReply("先にボイスチャンネルに接続してください");
				return;
			}

			// ボットの権限を確認
			const permissions = voiceChannel.permissionsFor(interaction.client.user!);
			if (!permissions?.has("Connect") || !permissions?.has("Speak")) {
				await interaction.editReply(
					"ボイスチャンネルへの接続権限または発言権限がありません",
				);
				return;
			}

			// ボイスチャンネルに参加
			const musicService = MusicService.getInstance();
			const joined = await musicService.joinChannel(
				voiceChannel,
				interaction.channel as TextChannel,
			);

			if (joined) {
				await interaction.editReply(
					`ボイスチャンネル「${voiceChannel.name}」に参加しました。`,
				);
				logInfo(
					`ボイスチャンネル "${voiceChannel.name}" に参加: ${interaction.guild.name}`,
				);
			} else {
				// 失敗した場合も editReply を呼ぶ
				await interaction.editReply("ボイスチャンネルへの参加に失敗しました");
			}
		} catch (error) {
			logError(`joinコマンドエラー: ${error}`);
			// エラー時も editReply を呼ぶ
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
