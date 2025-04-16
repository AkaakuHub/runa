import * as fs from "node:fs";
import {
	type AudioPlayer,
	AudioPlayerStatus,
	StreamType,
	createAudioPlayer,
	createAudioResource,
	getVoiceConnection,
	joinVoiceChannel,
} from "@discordjs/voice";
import {
	EmbedBuilder,
	type Message,
	type TextChannel,
	type VoiceChannel,
} from "discord.js";
import { logError, logInfo } from "../../src/utils/logger";
import { downloadYoutubeAudio } from "../utils/youtubeUtils";
import { QueueManager } from "./QueueManager";

export class MusicService {
	private static instance: MusicService;
	private player: AudioPlayer;
	private queueManager: QueueManager;
	private currentTextChannel?: TextChannel;
	private isPlaying = false;
	private currentResource: any; // 現在再生中のリソース
	private currentVolume = 0.2; // デフォルト音量20%
	private currentPlayingUrl?: string; // 現在再生中のURL
	private statusMessage?: Message; // ステータス表示用メッセージの参照

	private constructor() {
		this.player = createAudioPlayer({
			behaviors: {
				noSubscriber: "play", // サブスクライバーがいなくても再生
				maxMissedFrames: 50, // 失敗フレーム許容値を増やす
			},
		});
		this.queueManager = QueueManager.getInstance();

		// 詳細なイベントリスナー追加
		this.player.on(AudioPlayerStatus.Playing, () => {
			logInfo("プレイヤー状態: 再生中");
		});

		this.player.on(AudioPlayerStatus.Idle, () => {
			logInfo("プレイヤー状態: アイドル状態");
			this.isPlaying = false;
			this.playNext();
		});

		this.player.on(AudioPlayerStatus.Buffering, () => {
			logInfo("プレイヤー状態: バッファリング中");
		});

		this.player.on(AudioPlayerStatus.Paused, () => {
			logInfo("プレイヤー状態: 一時停止中");
		});

		this.player.on(AudioPlayerStatus.AutoPaused, () => {
			logInfo("プレイヤー状態: 自動一時停止");
		});

		this.player.on("error", (error) => {
			logError(`音声再生エラー: ${error.message}`);
			this.isPlaying = false;
			this.playNext();
		});
	}

	public static getInstance(): MusicService {
		if (!MusicService.instance) {
			MusicService.instance = new MusicService();
		}
		return MusicService.instance;
	}

	// ステータスメッセージを送信または更新するヘルパーメソッド
	private async updateStatusMessage(
		content: string,
		color = 0x0099ff,
		title?: string,
	): Promise<void> {
		if (!this.currentTextChannel) return;

		const embed = new EmbedBuilder().setColor(color).setDescription(content);

		if (title) {
			embed.setTitle(title);
		}

		try {
			if (this.statusMessage) {
				// 既存のメッセージを編集
				await this.statusMessage.edit({ embeds: [embed] });
			} else {
				// 新しいメッセージを送信
				this.statusMessage = await this.currentTextChannel.send({
					embeds: [embed],
				});
			}
		} catch (error) {
			logError(`メッセージ更新エラー: ${error}`);
			// エラーが発生した場合は新しいメッセージを送信
			try {
				this.statusMessage = await this.currentTextChannel.send({
					embeds: [embed],
				});
			} catch (innerError) {
				logError(`メッセージ送信エラー: ${innerError}`);
			}
		}
	}

	public async joinChannel(
		voiceChannel: VoiceChannel,
		textChannel: TextChannel,
	): Promise<boolean> {
		try {
			// すでに接続済みの場合の処理
			const existingConnection = getVoiceConnection(voiceChannel.guild.id);
			if (existingConnection) {
				// 同じチャンネルに既に接続している場合は、再接続せずにテキストチャンネルの更新のみを行う
				if (existingConnection.joinConfig.channelId === voiceChannel.id) {
					logInfo("既に同じボイスチャンネルに接続済みです");
					this.currentTextChannel = textChannel;
					await this.updateStatusMessage(
						`ボイスチャンネル「${voiceChannel.name}」に接続済みです`,
						0x00ff00, // 緑色
						"接続状態",
					);
					return true;
				}

				// 別のチャンネルに接続している場合は切断してから再接続
				logInfo("別のボイスチャンネルに再接続します");
				existingConnection.destroy();
				// 接続が完全に破棄されるまで少し待機
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			// 新しい接続を確立
			const connection = joinVoiceChannel({
				channelId: voiceChannel.id,
				guildId: voiceChannel.guild.id,
				adapterCreator: voiceChannel.guild.voiceAdapterCreator,
				selfDeaf: true,
				selfMute: false,
			});

			// 接続時のイベントハンドラを詳細化
			connection.on("stateChange", (oldState, newState) => {
				logInfo(`接続状態の変更: ${oldState.status} -> ${newState.status}`);
			});

			// 接続エラー時のハンドラ
			connection.on("error", (error) => {
				logError(`ボイス接続エラー: ${error.message}`);
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
					const stateChangeHandler = (oldState: any, newState: any) => {
						if (newState.status === "ready") {
							clearTimeout(timeout);
							connection.off("stateChange", stateChangeHandler);
							logInfo("ボイス接続の準備完了");
							ready = true;
							resolve();
						}
					};

					connection.on("stateChange", stateChangeHandler);
				});
			} catch (error) {
				logError(`接続タイムアウト: ${error}`);
				// 接続に失敗した場合は破棄
				connection.destroy();
				await textChannel.send(
					"ボイスチャンネルへの接続がタイムアウトしました",
				);
				return false;
			}

			if (!ready) {
				connection.destroy();
				await textChannel.send("ボイスチャンネルへの接続に失敗しました");
				return false;
			}

			// プレイヤーを接続に登録
			connection.subscribe(this.player);

			this.currentTextChannel = textChannel;
			await this.updateStatusMessage(
				`ボイスチャンネル「${voiceChannel.name}」に接続しました`,
				0x00ff00, // 緑色
				"接続成功",
			);
			return true;
		} catch (error) {
			logError(`ボイスチャンネル接続エラー: ${error}`);
			await this.updateStatusMessage(
				"ボイスチャンネルへの接続に失敗しました",
				0xff0000, // 赤色
				"接続エラー",
			);
			return false;
		}
	}

	public leaveChannel(guildId: string): boolean {
		try {
			const connection = getVoiceConnection(guildId);
			if (connection) {
				logInfo(`ボイスチャンネルから退出: ${guildId}`);
				this.player.stop(true); // 再生を停止し、リソースを強制的に破棄
				connection.destroy();
				this.isPlaying = false;
				this.queueManager.clearQueue(guildId); // キューもクリア
				this.currentTextChannel = undefined; // テキストチャンネルもクリア
				return true;
			}
			logInfo(`ボイスチャンネル退出試行、接続なし: ${guildId}`);
			return false;
		} catch (error) {
			logError(`ボイスチャンネル切断エラー: ${error}`);
			return false;
		}
	}

	public async queueYoutubeUrl(url: string, guildId: string): Promise<string> {
		try {
			// URLを検証
			if (!url.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/)) {
				return "有効なYouTube URLではありません";
			}

			// キューに追加
			const queuePosition = this.queueManager.addToQueue(url, guildId);
			const truncatedUrl = url.replace("https://", "");

			// 埋め込みメッセージを作成
			let statusText: string;
			if (queuePosition === 1 && !this.isPlaying) {
				statusText = `${truncatedUrl} の音声DLを開始します。\n再生キューの1番目に追加しました。すぐに再生を開始します。`;
				await this.updateStatusMessage(statusText, 0x0099ff, "キューに追加");
			} else {
				statusText = `${truncatedUrl} の音声DLを開始します。\n再生キューの${queuePosition}番目に追加しました。`;
				await this.updateStatusMessage(statusText, 0x0099ff, "キューに追加");
			}

			return ""; // 実際のメッセージはすでに送信済みなので空文字を返す
		} catch (error) {
			logError(`キュー追加エラー: ${error}`);
			await this.updateStatusMessage(
				"キューへの追加中にエラーが発生しました",
				0xff0000,
				"エラー",
			);
			return "";
		}
	}

	public async playNext(): Promise<void> {
		if (this.isPlaying || !this.currentTextChannel) {
			logInfo(
				`playNext中止: isPlaying=${this.isPlaying}, currentTextChannel=${!!this.currentTextChannel}`,
			);
			return;
		}

		const guildId = this.currentTextChannel.guild.id;
		const nextItem = this.queueManager.getNextInQueue(guildId);

		// ボイスチャンネルへの接続を確認
		const connection = getVoiceConnection(guildId);
		if (!connection) {
			logError("playNext: ボイス接続が見つかりません");
			await this.updateStatusMessage(
				"ボイスチャンネルに接続されていません。再接続してください。",
				0xff0000,
				"接続エラー",
			);
			return;
		}

		// 接続状態をログに出力
		logInfo(`playNext: 現在の接続状態: ${connection.state.status}`);
		if (connection.state.status !== "ready") {
			logError(
				`playNext: 接続が準備完了ではありません (${connection.state.status})`,
			);
		}

		if (!nextItem) {
			logInfo("playNext: 再生キューは空です");
			await this.updateStatusMessage(
				"再生キューが空になりました",
				0xffaa00, // オレンジ色
				"再生完了",
			);
			return;
		}

		try {
			this.isPlaying = true;
			await this.updateStatusMessage(
				"音声ファイルをダウンロード中...",
				0xffaa00,
				"準備中",
			);

			// YouTube音声をダウンロード
			const audioFilePath = await downloadYoutubeAudio(nextItem, guildId);

			if (!audioFilePath) {
				await this.updateStatusMessage(
					"音声ダウンロードに失敗しました",
					0xff0000,
					"エラー",
				);
				this.isPlaying = false;
				this.queueManager.removeFromQueue(guildId, nextItem);
				this.playNext();
				return;
			}

			// ステータス更新
			await this.updateStatusMessage(
				"音声ファイルを検証中...",
				0xffaa00,
				"準備中",
			);

			logInfo(`playNext: 音声ファイルのパス: ${audioFilePath}`);

			// ファイルの存在確認とサイズ確認
			if (!fs.existsSync(audioFilePath)) {
				await this.updateStatusMessage(
					"音声ファイルが見つかりません",
					0xff0000,
					"エラー",
				);
				this.isPlaying = false;
				return;
			}

			const stats = fs.statSync(audioFilePath);
			logInfo(`playNext: ファイルサイズ: ${stats.size} バイト`);

			if (stats.size === 0) {
				await this.updateStatusMessage(
					"ダウンロードしたファイルが空です",
					0xff0000,
					"エラー",
				);
				this.isPlaying = false;
				fs.unlinkSync(audioFilePath);
				return;
			}

			// ステータス更新
			await this.updateStatusMessage(
				"音声リソースを準備中...",
				0xffaa00,
				"準備中",
			);

			// 音声リソースを作成
			logInfo("playNext: 音声リソースを作成中...");
			const resource = createAudioResource(audioFilePath, {
				inputType: StreamType.Arbitrary,
				inlineVolume: true,
			});
			logInfo("playNext: 音声リソース作成完了");

			// 現在のリソースとURLを保存
			this.currentResource = resource;
			this.currentPlayingUrl = nextItem;

			// プレイヤーが接続に正しくサブスクライブされていることを確認 (再サブスクライブ)
			logInfo("playNext: プレイヤーをボイス接続にサブスクライブ中...");
			const subscription = connection.subscribe(this.player);
			if (subscription) {
				logInfo("playNext: プレイヤーのサブスクライブ成功");
			} else {
				logError("playNext: プレイヤーのサブスクライブに失敗");
				await this.updateStatusMessage(
					"音声再生の準備に失敗しました",
					0xff0000,
					"エラー",
				);
				this.isPlaying = false;
				return;
			}

			// 音量設定 (現在のリソースに対して)
			if (this.currentResource?.volume) {
				this.currentResource.volume.setVolume(this.currentVolume);
				logInfo(`playNext: 音量を${this.currentVolume * 100}%に設定しました`);
			}

			// ステータス更新
			await this.updateStatusMessage(
				`再生開始: ${nextItem}`,
				0x00ff00, // 緑色
				"再生中",
			);

			// 再生開始
			logInfo("playNext: player.play(resource) を呼び出します");
			this.player.play(resource);
			logInfo("playNext: 音声の再生を開始しました");

			// 再生終了後にファイルを削除するため、ステータス監視
			this.player.once(AudioPlayerStatus.Idle, () => {
				logInfo("playNext: AudioPlayerStatus.Idle イベント発生");
				this.isPlaying = false;
				this.currentPlayingUrl = undefined;

				// 再生完了メッセージの更新
				this.updateStatusMessage(
					`再生完了: ${nextItem}`,
					0xffaa00, // オレンジ色
					"再生完了",
				);

				try {
					if (fs.existsSync(audioFilePath)) {
						fs.unlinkSync(audioFilePath);
						logInfo(`playNext: 一時ファイルを削除しました: ${audioFilePath}`);
					}
				} catch (error) {
					logError(`playNext: 一時ファイル削除エラー: ${error}`);
				}
				// 次の曲へ
				this.playNext();
			});

			// エラーハンドリングを追加
			this.player.once("error", (error) => {
				logError(
					`playNext: AudioPlayer エラー: ${error.message} - Resource: ${error.resource?.metadata}`,
				);
				this.isPlaying = false;

				// エラーメッセージの更新
				this.updateStatusMessage(
					`再生エラー: ${error.message}`,
					0xff0000,
					"エラー",
				);

				try {
					if (fs.existsSync(audioFilePath)) {
						fs.unlinkSync(audioFilePath);
					}
				} catch (unlinkError) {
					logError(`playNext: エラー後のファイル削除エラー: ${unlinkError}`);
				}
				this.playNext();
			});
		} catch (error) {
			logError(`playNext: 再生エラー全体: ${error}`);
			await this.updateStatusMessage(
				`再生中にエラーが発生しました: ${error}`,
				0xff0000,
				"エラー",
			);
			this.isPlaying = false;
			this.playNext();
		}
	}

	// 音量設定メソッド
	public setVolume(level: number): boolean {
		try {
			// 範囲をチェック（0〜100）
			if (level < 0 || level > 100) {
				logError(`無効な音量レベル: ${level}`);
				return false;
			}

			// 0-100の値を0-1に変換
			const normalizedVolume = level / 100;

			// 現在のリソースが存在し、音量制御が可能か確認
			if (this.currentResource?.volume) {
				this.currentResource.volume.setVolume(normalizedVolume);
				this.currentVolume = normalizedVolume; // 現在の音量を保存
				logInfo(`音量を${level}%に設定しました`);
				return true;
			} else {
				logError("音量を設定できる再生リソースがありません");
				return false;
			}
		} catch (error) {
			logError(`音量設定エラー: ${error}`);
			return false;
		}
	}

	// 現在再生中のURLを取得
	public getCurrentPlayingUrl(): string | undefined {
		return this.currentPlayingUrl;
	}

	// 現在のキューを取得
	public getCurrentQueue(guildId: string): string[] {
		return this.queueManager.getQueue(guildId) || [];
	}

	public async processQueue(guildId: string): Promise<void> {
		if (this.isPlaying) return;

		await this.playNext();
	}

	public skip(guildId: string): boolean {
		if (!this.isPlaying) return false;

		// 現在の再生を停止すると自動的に次の曲へ
		this.player.stop();
		return true;
	}

	public isCurrentlyPlaying(): boolean {
		return this.isPlaying;
	}

	// 現在のテキストチャンネルIDを取得するメソッド
	public getCurrentTextChannelId(): string | undefined {
		return this.currentTextChannel?.id;
	}

	// テキストチャンネルを更新するメソッド
	public updateTextChannel(textChannel: TextChannel): void {
		this.currentTextChannel = textChannel;
	}
}
