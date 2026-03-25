import { getVoiceConnection } from "@discordjs/voice";
import type { GuildMember, Message, VoiceChannel } from "discord.js";
import { MusicService } from "../services/MusicService";
import { TTSQueue } from "../services/TTSQueue";
import { TTSService } from "../services/TTSService";
import { logDebug, logError } from "../utils/logger";
import { isSimpleSingText } from "../utils/ttsSing/format";
import { formatTTSInput } from "./ttsTextFormatter";

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

	const musicService = MusicService.getInstance();
	const activeTextChannelId = musicService.getCurrentTextChannelId();
	if (!activeTextChannelId) {
		logDebug("TTS: join実行チャンネルが未設定のため無視します");
		return;
	}

	if (activeTextChannelId !== message.channelId) {
		logDebug(
			`TTS: join実行チャンネル外のため無視します current=${activeTextChannelId} message=${message.channelId}`,
		);
		return;
	}
	logDebug(`TTS: join実行チャンネル ${message.channelId} を監視しています`);

	// コマンドメッセージは無視（スラッシュコマンド）
	if (message.content.startsWith("/")) return;

	// メンバーがボイスチャンネルにいるか確認
	const member = message.member as GuildMember;
	const voiceChannel = member?.voice.channel as VoiceChannel;

	if (!voiceChannel) {
		logDebug(
			`TTS: ユーザー ${message.author.username} はボイスチャンネルにいません`,
		);
		return;
	}
	logDebug(
		`TTS: ユーザー ${message.author.username} はボイスチャンネル ${voiceChannel.name} にいます`,
	);

	// ボイス接続の状態を確認
	const existingConnection = getVoiceConnection(message.guild.id);
	const currentVoiceChannelId = existingConnection?.joinConfig.channelId;

	// 既存接続がない場合は処理しない（自動接続を防止）
	if (!existingConnection) {
		logDebug("TTS: ボットがボイスチャンネルに参加していません");
		return;
	}

	// 接続先が別のチャンネルである場合は処理しない
	if (currentVoiceChannelId !== voiceChannel.id) {
		logDebug(
			`TTS: ボットが別のボイスチャンネルに参加しています (現在: ${currentVoiceChannelId}, ユーザー: ${voiceChannel.id})`,
		);
		return;
	}

	// TTSキューの状態をログ
	const ttsQueue = TTSQueue.getInstance();
	logDebug(`TTSキュー状態: 待機中=${ttsQueue.getQueueLength()}`);

	// TTSで読み上げ（キューに追加）
	try {
		const isSing = isSimpleSingText(message.content);
		const content = isSing
			? message.content
			: formatTTSInput(message.content, message.guild);
		await ttsService.speak(content, voiceChannel, message.author.id, isSing);
		logDebug(
			`TTS読み上げキューに追加: ${content}, サーバー: ${message.guild.name}`,
		);
	} catch (error) {
		logError(`TTS処理エラー: ${error}`);
	}
}
