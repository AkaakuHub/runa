import {
	getVoiceConnection,
	joinVoiceChannel,
	type VoiceConnection,
} from "@discordjs/voice";
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
		logInfo("TTS: TTS機能が無効です");
		return;
	}
	logInfo("TTS: TTS機能が有効です");

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

/**
 * TTS用にボイスチャンネルに接続
 */
async function connectToVoiceChannelForTTS(
	voiceChannel: VoiceChannel,
): Promise<VoiceConnection | null> {
	try {
		const existingConnection = getVoiceConnection(voiceChannel.guild.id);
		if (
			existingConnection &&
			existingConnection.joinConfig.channelId === voiceChannel.id
		) {
			return existingConnection;
		}

		// 既存の接続があれば切断
		if (existingConnection) {
			existingConnection.destroy();
			// 接続が完全に破棄されるまで少し待機
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		const connection = joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: voiceChannel.guild.id,
			adapterCreator: voiceChannel.guild.voiceAdapterCreator,
			selfDeaf: true,
			selfMute: false,
		});

		// 接続状態が準備完了するまで待機（タイムアウト付き）
		let ready = false;
		try {
			await new Promise<void>((resolve, reject) => {
				// 接続タイムアウト（10秒）
				const timeout = setTimeout(() => {
					reject(new Error("ボイス接続のタイムアウト"));
				}, 10000);

				// 状態変化の監視
				const stateChangeHandler = (
					_oldState: { status: string },
					newState: { status: string },
				) => {
					if (newState.status === "ready") {
						clearTimeout(timeout);
						connection.off("stateChange", stateChangeHandler);
						logInfo("TTS用ボイス接続の準備完了");
						ready = true;
						resolve();
					}
				};

				connection.on("stateChange", stateChangeHandler);
			});
		} catch (error) {
			logError(`TTS接続タイムアウト: ${error}`);
			// 接続に失敗した場合は破棄
			connection.destroy();
			return null;
		}

		if (!ready) {
			connection.destroy();
			return null;
		}

		return connection;
	} catch (error) {
		logError(`TTSボイスチャンネル接続エラー: ${error}`);
		return null;
	}
}
