import type {
	GuildMember,
	Message,
	TextChannel,
	VoiceChannel,
} from "discord.js";
import { IyaResponse } from "../response/Iya";
import type { IYAKind } from "../types";
import { logInfo } from "../utils/logger";
import { isValidYoutubeUrl } from "../utils/youtubeUtils";
import { MusicService } from "../services/MusicService";

const iyaHandler = (message: Message, kind: IYAKind): void => {
	logInfo(`Iya! trigger detected from ${message.author.username}`);
	IyaResponse(message, kind);
};

export const messageCreateHandler = async (message: Message): Promise<void> => {
	// ボットのメッセージは無視
	if (message.author.bot) return;

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

	// YouTubeリンクの検出
	if (isValidYoutubeUrl(message.content)) {
		const member = message.member as GuildMember;
		const voiceChannel = member?.voice.channel as VoiceChannel;

		if (!voiceChannel) {
			await message.reply(
				"YouTubeの音声を再生するにはボイスチャンネルに接続してください",
			);
			return;
		}

		const musicService = MusicService.getInstance();

		// ボットがまだボイスチャンネルに入っていない場合は参加
		const textChannel = message.channel as TextChannel;
		await musicService.joinChannel(voiceChannel, textChannel);

		// URLをキューに追加
		const response = await musicService.queueYoutubeUrl(
			message.content,
			message.guild.id,
		);
		await message.reply(response);

		// キューの処理を開始（再生中でなければ再生開始）
		await musicService.processQueue(message.guild.id);

		logInfo(
			`YouTube URL検出: ${message.content}, サーバー: ${message.guild.name}`,
		);
		return;
	}
};
