import { getVoiceConnection } from "@discordjs/voice";
import {
	AttachmentBuilder,
	type GuildMember,
	type Message,
	type VoiceChannel,
} from "discord.js";
import { config } from "../config/config";
import { handleGomamayoResponse } from "../response/Gomamayo";
import { IyaResponse } from "../response/Iya";
import { MusicService } from "../services/MusicService";
import type { IYAKind } from "../types";
import { logDebug, logError, logInfo } from "../utils/logger";
import { detectSenryu } from "../utils/senryuDetector";
import { buildSenryuReply, generateSenryuImage } from "../utils/senryuResponse";
import { handleTTS } from "../utils/useTTS";
import { extractYoutubeUrls } from "../utils/youtubeUtils";

const iyaHandler = (message: Message, kind: IYAKind): void => {
	logInfo(`Iya! trigger detected from ${message.author.username}`);
	IyaResponse(message, kind);
};

export const messageCreateHandler = async (message: Message): Promise<void> => {
	logDebug(
		`messageCreate: guild=${message.guild?.id ?? "dm"} channel=${message.channelId} author=${message.author.id} bot=${message.author.bot} contentLength=${message.content.length}`,
	);

	// ボットのメッセージは無視
	if (message.author.bot) {
		return;
	}
	// ではなくて、このbot自身だけを無視する
	// if (message.author.id === config.clientId) {
	// 	logDebug("messageCreate: このbot自身のメッセージなので無視します");
	// 	return;
	// }

	// TTS機能の処理
	await handleTTS(message);

	const senryu = await detectSenryu(message.content);
	if (senryu) {
		logInfo(`川柳を検知しました: author=${message.author.username}`);
		const messageAuthorName =
			message.member?.displayName ?? message.author.username;
		const replyContent = buildSenryuReply(senryu, messageAuthorName);
		try {
			const imageBuffer = await generateSenryuImage(senryu, messageAuthorName);
			const attachment = new AttachmentBuilder(imageBuffer, {
				name: "senryu-washi.png",
			});
			await message.reply({
				content: replyContent,
				files: [attachment],
			});
		} catch (error) {
			logError(`川柳画像生成に失敗しました: ${error}`);
			await message.reply(replyContent);
		}
	}

	await handleGomamayoResponse(message);

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

	const youtubeUrls = extractYoutubeUrls(message.content);
	if (youtubeUrls.length > 0) {
		// サーバー内のメッセージのみ処理
		if (!message.guild) return;

		const musicService = MusicService.getInstance();
		const activeTextChannelId = musicService.getCurrentTextChannelId();
		if (!activeTextChannelId) {
			logDebug("YouTube: join実行チャンネルが未設定のため無視します");
			return;
		}

		if (activeTextChannelId !== message.channelId) {
			logDebug(
				`YouTube: join実行チャンネル外のため無視します current=${activeTextChannelId} message=${message.channelId}`,
			);
			return;
		}

		const member = message.member as GuildMember;
		const voiceChannel = member?.voice.channel as VoiceChannel;

		if (!voiceChannel) {
			logDebug("YouTube: 投稿者がボイスチャンネルにいないため無視します");
			return;
		}

		// ボイス接続の状態を確認
		const existingConnection = getVoiceConnection(message.guild.id);

		// 既存接続がない場合は処理しない（自動接続を防止）
		if (!existingConnection) {
			logDebug("YouTube: Botがボイスチャンネル未接続のため無視します");
			return;
		}

		const currentVoiceChannelId = existingConnection?.joinConfig.channelId;

		// 接続先が別のチャンネルである場合のみ接続処理を実行
		if (currentVoiceChannelId !== voiceChannel.id) {
			logDebug(
				`YouTube: Bot接続先が別です current=${currentVoiceChannelId} user=${voiceChannel.id}`,
			);
			await message.reply(
				"ボットが別のボイスチャンネルに参加しています。 `/join` コマンドでチャンネルを移動してください",
			);
			return;
		}

		for (const youtubeUrl of youtubeUrls) {
			const response = await musicService.queueYoutubeUrl(
				youtubeUrl,
				message.guild.id,
			);
			if (response) {
				await message.reply(response);
			}

			logInfo(
				`YouTube URL検出: ${youtubeUrl}, サーバー: ${message.guild.name}`,
			);
		}

		// キューの処理を開始（再生中でなければ再生開始）
		await musicService.processQueue();
	}
};
