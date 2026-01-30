import { getVoiceConnection } from "@discordjs/voice";
import {
	MessageFlags,
	type GuildMember,
	type Message,
	type TextChannel,
	type VoiceChannel,
} from "discord.js";
import { IyaResponse } from "../response/Iya";
import { ChannelRegistryService } from "../services/ChannelRegistryService";
import { MusicService } from "../services/MusicService";
import type { IYAKind } from "../types";
import { isValidYoutubeUrl } from "../utils/youtubeUtils";
import { handleTTS } from "../utils/useTTS";
import { logInfo } from "../utils/logger";
import { config } from "../config/config";

const iyaHandler = (message: Message, kind: IYAKind): void => {
	logInfo(`Iya! trigger detected from ${message.author.username}`);
	IyaResponse(message, kind);
};

export const messageCreateHandler = async (message: Message): Promise<void> => {
	// ボットのメッセージは無視
	// ではなくて、このbot自身だけを無視する
	if (message.author.id === config.clientId) return;

	// TTS機能の処理
	await handleTTS(message);

	// twitter/xリンクの変換処理
	const urls = message.content.match(/https?:\/\/\S+/g) ?? []
	const mkMdLink = (url: string) => `[.](${url})`
	const mkAngleLink = (url: string) => `<${url}>`
	const convertToFxTwitter = (url: string) =>
		url
			.replace(/(^https?:\/\/)(?:www\.)?x\.com\b/i, "$1fxtwitter.com")
			.replace(/(^https?:\/\/)(?:www\.)?twitter\.com\b/i, "$1fxtwitter.com")
	const pairs = urls.map((originalUrl) => {
		const convertedUrl = convertToFxTwitter(originalUrl)
		return `${mkMdLink(convertedUrl)} ${mkAngleLink(originalUrl)}`
	})
	if (pairs.length) {
		await message.reply({
			content: pairs.join(" "),
			flags: MessageFlags.SuppressNotifications,
			allowedMentions: {
				repliedUser: false,
				parse: []
			}
		})
	}

	// がああパターンのチェック
	const goosePattern = /が[ぁあ]{2,}/;
	let hasGoosePattern = false;
	if (goosePattern.test(message.content)) {
		await message.react("🦆");
		hasGoosePattern = true;
	}

	const ngWordsRegex = [
		/[ｺコこ][ｹケけ][ｰー～〜ー]*[ｯッっ]!*/i,
		/[ﾌﾞブぶ][ﾎホほ][ｫォおぉ]+[ｯッっ]?/i,
		...(process.env.NG_WORDS?.split(",").map(
			(word) => new RegExp(word.trim(), "i"),
		) || []),
	];

	if (ngWordsRegex.some((regex) => regex.test(message.content))) {
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
			return;
		}

		// ボイス接続の状態を確認
		const existingConnection = getVoiceConnection(message.guild.id);

		// 既存接続がない場合は処理しない（自動接続を防止）
		if (!existingConnection) {
			return;
		}

		const currentVoiceChannelId = existingConnection?.joinConfig.channelId;
		const musicService = MusicService.getInstance();
		const textChannel = message.channel as TextChannel;

		// 接続先が別のチャンネルである場合のみ接続処理を実行
		if (currentVoiceChannelId !== voiceChannel.id) {
			await message.reply(
				"ボットが別のボイスチャンネルに参加しています。 `/join` コマンドでチャンネルを移動してください",
			);
			return;
		}
		if (textChannel.id !== musicService.getCurrentTextChannelId()) {
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
