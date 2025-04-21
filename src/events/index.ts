import type { Client, VoiceState } from "discord.js";
import { MusicService } from "../services/MusicService";
import { logInfo } from "../utils/logger";
import { interactionCreateHandler } from "./interactionCreate";
import { messageCreateHandler } from "./messageCreate";

export const setupEventListeners = (client: Client): void => {
	// メッセージイベントのリスナー
	client.on("messageCreate", messageCreateHandler);

	// インタラクション（スラッシュコマンド）イベントのリスナー
	client.on("interactionCreate", interactionCreateHandler);

	// ボイスチャンネルの状態変更イベント
	client.on(
		"voiceStateUpdate",
		(oldState: VoiceState, newState: VoiceState) => {
			// ユーザーがボイスチャンネルから退出した場合のみチェック
			if (
				oldState.channelId &&
				(!newState.channelId || oldState.channelId !== newState.channelId)
			) {
				// botの移動は無視
				if (oldState.member?.user.bot) return;

				// しばらく待ってからチェック（他のユーザーの移動が完了するのを待つ）
				setTimeout(() => {
					const musicService = MusicService.getInstance();
					musicService.checkAndLeaveEmptyChannel(oldState.guild.id);
				}, 500); // 500ミリ秒待機
			}
		},
	);

	logInfo("Event listeners have been set up");
};
