import { getVoiceConnection } from "@discordjs/voice";
import type { GuildMember, Message, VoiceChannel } from "discord.js";
import { ChannelRegistryService } from "../services/ChannelRegistryService";
import { TTSService } from "../services/TTSService";
import { TTSQueue } from "../services/TTSQueue";
import { logError, logInfo } from "../utils/logger";

/**
 * TTS機能の処理
 */
export async function handleTTS(message: Message): Promise<void> {
	// サーバー内のメッセージのみ処理
	if (!message.guild) return;

	// TTSサービスを取得
	const ttsService = TTSService.getInstance();

	// TTSが有効か確認
	const ttsEnabled = ttsService.isEnabled();
	if (!ttsEnabled) {
		return;
	}

	// チャンネル登録サービスを取得
	const channelRegistry = ChannelRegistryService.getInstance();

	// このチャンネルが登録されているか確認
	if (!channelRegistry.isRegistered(message.guild.id, message.channelId)) {
		return;
	}
	logInfo(`TTS: 登録済みチャンネル ${message.channelId} を監視しています`);

	// コマンドメッセージは無視（スラッシュコマンド）
	if (message.content.startsWith("/")) return;

	// メンバーがボイスチャンネルにいるか確認
	const member = message.member as GuildMember;
	const voiceChannel = member?.voice.channel as VoiceChannel;

	if (!voiceChannel) {
		logInfo(
			`TTS: ユーザー ${message.author.username} はボイスチャンネルにいません`,
		);
		return;
	}
	logInfo(
		`TTS: ユーザー ${message.author.username} はボイスチャンネル ${voiceChannel.name} にいます`,
	);

	// ボイス接続の状態を確認
	const existingConnection = getVoiceConnection(message.guild.id);
	const currentVoiceChannelId = existingConnection?.joinConfig.channelId;

	// 既存接続がない場合は処理しない（自動接続を防止）
	if (!existingConnection) {
		logInfo("TTS: ボットがボイスチャンネルに参加していません");
		return;
	}

	// 接続先が別のチャンネルである場合は処理しない
	if (currentVoiceChannelId !== voiceChannel.id) {
		logInfo(
			`TTS: ボットが別のボイスチャンネルに参加しています (現在: ${currentVoiceChannelId}, ユーザー: ${voiceChannel.id})`,
		);
		return;
	}

	// TTSキューの状態をログ
	const ttsQueue = TTSQueue.getInstance();
	logInfo(`TTSキュー状態: 待機中=${ttsQueue.getQueueLength()}`);

	// TTSで読み上げ（キューに追加）
	try {
		await ttsService.speak(message.content, voiceChannel);
		logInfo(
			`TTS読み上げキューに追加: ${message.content}, サーバー: ${message.guild.name}`,
		);
	} catch (error) {
		logError(`TTS処理エラー: ${error}`);
	}
}
