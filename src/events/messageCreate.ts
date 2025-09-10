import {
	getVoiceConnection,
	joinVoiceChannel,
	type VoiceConnection,
} from "@discordjs/voice";
import type {
	GuildMember,
	Message,
	TextChannel,
	VoiceChannel,
} from "discord.js";
import { IyaResponse } from "../response/Iya";
import { ChannelRegistryService } from "../services/ChannelRegistryService";
import { MusicService } from "../services/MusicService";
import { TTSService } from "../services/TTSService";
import type { IYAKind } from "../types";
import { logError, logInfo } from "../utils/logger";
import { isValidYoutubeUrl } from "../utils/youtubeUtils";

const iyaHandler = (message: Message, kind: IYAKind): void => {
	logInfo(`Iya! trigger detected from ${message.author.username}`);
	IyaResponse(message, kind);
};

export const messageCreateHandler = async (message: Message): Promise<void> => {
	// ボットのメッセージは無視
	if (message.author.bot) return;

	// TTS機能の処理
	await handleTTS(message);

	// がああパターンのチェック
	const goosePattern = /が[ぁあ]{2,}/;
	let hasGoosePattern = false;
	if (goosePattern.test(message.content)) {
		await message.react("🦆");
		hasGoosePattern = true;
	}

	// ｺｹｰｯ!!のような文字列をチェック（前後に文字があってもOK、表記揺れ対応）
	const kokePattern = /[ｺコこ][ｹケけ][ｰー～〜ー]*[ｯッっ]!*/i;
	// ﾌﾞﾎｫｯのような文字列をチェック（前後に文字があってもOK、表記揺れ対応）
	const bufoPattern = /[ﾌﾞブぶ][ﾎホほ][ｫォおぉ]+[ｯッっ]?/i;

	if (kokePattern.test(message.content) || bufoPattern.test(message.content)) {
		await message.reply(
			"💢💢💢 **絶対に禁止されています！！！** 💢💢💢\nそんな言葉を使うなんてとんでもない！😡",
		);
		// がああパターンも含む場合は、この後の処理を継続しない
		if (hasGoosePattern) {
			return;
		}
		return;
	}

	const iyaMessageDict = {
		"寝る！": ["眠くなったら"],
		"起きる！": ["お昼過ぎに", "お昼すぎに"],
		"遊ぶ！": ["遊びたくて"],
		"ご飯を食べる！": ["お腹減ったら", "お腹へったら"],
	};
	const match = Object.entries(iyaMessageDict).find(([, values]) => {
		return values.some((value) => message.content.includes(value));
	});
	if (match) {
		const [kind] = match;
		iyaHandler(message, kind as IYAKind);
		return;
	}

	if (isValidYoutubeUrl(message.content)) {
		// サーバー内のメッセージのみ処理
		if (!message.guild) return;

		// チャンネル登録サービスを取得
		const channelRegistry = ChannelRegistryService.getInstance();

		// このチャンネルが登録されているか確認
		if (!channelRegistry.isRegistered(message.guild.id, message.channelId)) {
			// 登録されていないチャンネルのメッセージは無視
			return;
		}

		const member = message.member as GuildMember;
		const voiceChannel = member?.voice.channel as VoiceChannel;

		if (!voiceChannel) {
			await message.reply(
				"YouTubeの音声を再生するにはボイスチャンネルに接続してください",
			);
			return;
		}

		const musicService = MusicService.getInstance();
		const textChannel = message.channel as TextChannel;

		// ボイス接続の状態を確認
		const existingConnection = getVoiceConnection(message.guild.id);
		const currentVoiceChannelId = existingConnection?.joinConfig.channelId;

		// 接続が存在しない場合、または接続先が別のチャンネルである場合のみ接続処理を実行
		if (!existingConnection || currentVoiceChannelId !== voiceChannel.id) {
			await musicService.joinChannel(voiceChannel, textChannel);
		} else if (textChannel.id !== musicService.getCurrentTextChannelId()) {
			// テキストチャンネルの更新のみ行う
			musicService.updateTextChannel(textChannel);
		}

		// URLをキューに追加
		const response = await musicService.queueYoutubeUrl(
			message.content,
			message.guild.id,
		);
		// レスポンスが空でない場合のみ返信（埋め込みメッセージが送信済みの場合は空文字が返る）
		if (response) {
			await message.reply(response);
		}

		// キューの処理を開始（再生中でなければ再生開始）
		await musicService.processQueue();

		logInfo(
			`YouTube URL検出: ${message.content}, サーバー: ${message.guild.name}`,
		);
	}
};

/**
 * TTS機能の処理
 */
async function handleTTS(message: Message): Promise<void> {
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

	// ボットがこのサーバーのボイスチャンネルに接続しているか確認
	const connection = getVoiceConnection(message.guild.id);
	if (!connection) {
		logInfo("TTS: ボットはこのサーバーのボイスチャンネルに接続していません");
		return;
	}

	// MusicServiceから現在のテキストチャンネルを取得
	const musicService = MusicService.getInstance();
	const currentTextChannelId = musicService.getCurrentTextChannelId();

	// /joinが実行されたチャンネルかどうかを確認
	if (message.channelId !== currentTextChannelId) {
		logInfo(
			`TTS: このチャンネル ${message.channelId} は/joinが実行されたチャンネルではありません`,
		);
		return;
	}
	logInfo(`TTS: 正しいチャンネル ${message.channelId} を監視しています`);

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

	// 接続が存在しない場合、または接続先が別のチャンネルである場合のみ接続処理を実行
	if (!existingConnection || currentVoiceChannelId !== voiceChannel.id) {
		// TTS用に接続
		const connection = await connectToVoiceChannelForTTS(voiceChannel);
		if (!connection) {
			return;
		}
	}

	// TTSで読み上げ
	try {
		await ttsService.speak(message.content, voiceChannel);
		logInfo(`TTS読み上げ: ${message.content}, サーバー: ${message.guild.name}`);
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
