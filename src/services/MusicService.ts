import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	getVoiceConnection,
	joinVoiceChannel,
	NoSubscriberBehavior,
} from "@discordjs/voice";
import {
	EmbedBuilder,
	type Message,
	type TextChannel,
	type VoiceChannel,
} from "discord.js";
import { logError, logInfo } from "../../src/utils/logger";
import { streamYoutubeAudio, sanitizeYoutubeUrl } from "../utils/youtubeUtils";
import { QueueManager } from "./QueueManager";

export class MusicService {
	private static instance: MusicService;
	private player: AudioPlayer;
	private queueManager: QueueManager;
	private currentTextChannel?: TextChannel;
	private isPlaying = false;
	private currentResource: {
		volume?: { setVolume: (volume: number) => void };
	} | null = null; // 現在再生中のリソース
	private currentVolume = 0.1; // デフォルト音量10%
	private currentPlayingUrl?: string; // 現在再生中のURL
	private statusMessage?: Message; // ステータス表示用メッセージの参照
	private retryCount = 0; // 再試行カウンター
	private maxRetries = 3; // 最大再試行回数

	private failedUrls: Set<string> = new Set(); // 失敗したURLを記録

	private constructor() {
		this.player = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Play, // サブスクライバーがいなくても再生
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
			this.retryCount = 0; // 再試行カウンターをリセット
			// playNextの呼び出しを削除 - 各再生処理内で個別にハンドリングするため
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
			this.handleErrorWithRetry();
		});
	}

	public static getInstance(): MusicService {
		if (!MusicService.instance) {
			MusicService.instance = new MusicService();
		}
		return MusicService.instance;
	}

	/**
	 * ボイスチャンネルにbotだけが残っているか確認し、残っている場合は自動退出する
	 */
	public checkAndLeaveEmptyChannel(guildId: string): void {
		const connection = getVoiceConnection(guildId);
		if (!connection) return;

		const channelId = connection.joinConfig.channelId;
		const guild = this.currentTextChannel?.guild;
		if (!guild || !channelId) return;

		// ギルドからボイスチャンネルを取得
		const voiceChannel = guild.channels.cache.get(channelId) as VoiceChannel;
		if (!voiceChannel) return;

		// チャンネルにいるメンバーを取得
		const members = voiceChannel.members;

		// メンバーがbotだけかどうかを確認
		// （ボット自身以外のメンバーがいるかどうかをチェック）
		const hasHumans = members.some((member) => !member.user.bot);

		if (!hasHumans) {
			logInfo(
				`ボイスチャンネル「${voiceChannel.name}」にはボットだけが残っているため、自動退出します`,
			);
			// 自動退出時もキューを保持する
			this.leaveChannel(guildId, false);

			if (this.currentTextChannel) {
				this.updateStatusMessage(
					"ボイスチャンネルに誰もいなくなったため、自動退出しました。キューは保持されています。",
					0xffaa00,
					"自動退出",
				);
			}
		}
	}

	// ステータスメッセージを送信または更新するヘルパーメソッド
	private async updateStatusMessage(
		content: string,
		color = 0x0099ff,
		title?: string,
		forceNewMessage = false, // 新しいメッセージを強制的に作成するフラグ
	): Promise<void> {
		if (!this.currentTextChannel) return;

		const embed = new EmbedBuilder().setColor(color).setDescription(content);

		if (title) {
			embed.setTitle(title);
		}

		try {
			if (this.statusMessage && !forceNewMessage) {
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
					const stateChangeHandler = (
						_oldState: { status: string },
						newState: { status: string },
					) => {
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

	public leaveChannel(guildId: string, clearQueue = false): boolean {
		try {
			const connection = getVoiceConnection(guildId);
			if (connection) {
				logInfo(`ボイスチャンネルから退出: ${guildId}`);
				this.player.stop(true); // 再生を停止し、リソースを強制的に破棄
				connection.destroy();
				this.isPlaying = false;
				// キューをクリアするオプションを追加
				if (clearQueue) {
					this.queueManager.clearQueue(guildId);
					this.failedUrls.clear(); // 失敗記録もクリア
				}
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

			// URLをサニタイズ
			const sanitizedUrl = sanitizeYoutubeUrl(url);

			// キューに追加
			const queuePosition = this.queueManager.addToQueue(sanitizedUrl, guildId);
			const truncatedUrl = sanitizedUrl.replace("https://", "");

			// 埋め込みメッセージを作成 (常に新しいメッセージを作成)
			let statusText: string;
			if (queuePosition === 1 && !this.isPlaying) {
				statusText = `${truncatedUrl} の音声DLを開始します。\n再生キューの1番目に追加しました。すぐに再生を開始します。`;
				await this.updateStatusMessage(
					statusText,
					0x0099ff,
					"キューに追加",
					true,
				);
			} else {
				statusText = `${truncatedUrl} の音声DLを開始します。\n再生キューの${queuePosition}番目に追加しました。`;
				await this.updateStatusMessage(
					statusText,
					0x0099ff,
					"キューに追加",
					true,
				);
			}
			return ""; // 実際のメッセージはすでに送信済みなので空文字を返す
		} catch (error) {
			logError(`キュー追加エラー: ${error}`);
			await this.updateStatusMessage(
				"キューへの追加中にエラーが発生しました",
				0xff0000,
				"エラー",
				true,
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
		let nextItem = this.queueManager.getNextInQueue(guildId);

		// 失敗したURLをスキップして有効な次のアイテムを探す
		while (nextItem && this.failedUrls.has(nextItem)) {
			logInfo(`失敗したURLをスキップ: ${nextItem}`);
			nextItem = this.queueManager.getNextInQueue(guildId);
		}

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

			// まずストリーミングを試みる
			logInfo(`playNext: ストリーミング再生を試みます: ${nextItem}`);
			const streamingSuccess = await this.playWithStreaming(nextItem, guildId);

			if (streamingSuccess) {
				// ストリーミング成功時のイベントハンドリング
				this.player.once(AudioPlayerStatus.Idle, () => {
					logInfo("playNext: ストリーミング再生完了");
					this.isPlaying = false;
					this.currentPlayingUrl = undefined;
					this.retryCount = 0;

					this.updateStatusMessage(
						`再生完了: ${nextItem}`,
						0xffaa00,
						"再生完了",
					);

					// 少し待ってから次の曲へ（重複呼び出し防止）
					setTimeout(() => {
						if (!this.isPlaying) {
							this.playNext();
						}
					}, 1000);
				});

				this.player.once("error", (error) => {
					logError(`playNext: ストリーミング再生エラー: ${error.message}`);
					this.isPlaying = false;
					this.handleErrorWithRetry();
				});

				return;
			}

			// ストリーミング失敗時は従来のダウンロード方式にフォールバック
			logInfo(
				`playNext: ストリーミング失敗、ダウンロード方式にフォールバック: ${nextItem}`,
			);
			await this.updateStatusMessage(
				"ストリーミングに失敗しました。ダウンロード方式で再生します...",
				0xffaa00,
				"準備中",
			);

			// ステータス更新
			await this.updateStatusMessage(
				"音声リソースを準備中...",
				0xffaa00,
				"準備中",
			);

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
				this.handleErrorWithRetry();
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
			logInfo("playNext: 音声の再生を開始しました");

			// 再生終了後にファイルを削除するため、ステータス監視
			this.player.once(AudioPlayerStatus.Idle, () => {
				logInfo("playNext: AudioPlayerStatus.Idle イベント発生");
				this.isPlaying = false;
				this.currentPlayingUrl = undefined;
				this.retryCount = 0;

				// 再生完了メッセージの更新
				this.updateStatusMessage(
					`再生完了: ${nextItem}`,
					0xffaa00, // オレンジ色
					"再生完了",
				);
				// 少し待ってから次の曲へ（重複呼び出し防止）
				setTimeout(() => {
					if (!this.isPlaying) {
						this.playNext();
					}
				}, 1000);
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
				this.handleErrorWithRetry();
			});
		} catch (error) {
			logError(`playNext: 再生エラー全体: ${error}`);
			await this.updateStatusMessage(
				`再生中にエラーが発生しました: ${error}`,
				0xff0000,
				"エラー",
			);
			this.isPlaying = false;
			this.handleErrorWithRetry();
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
			}
			logError("音量を設定できる再生リソースがありません");
			return false;
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

	public async processQueue(): Promise<void> {
		if (this.isPlaying) return;

		await this.playNext();
	}

	public skip(): boolean {
		if (!this.isPlaying) return false;

		// 現在の再生を停止すると自動的に次の曲へ
		this.player.stop();
		return true;
	}

	public isCurrentlyPlaying(): boolean {
		return this.isPlaying;
	}

	// 音楽を一時停止
	public pauseMusic(): boolean {
		if (this.isPlaying) {
			this.player.pause();
			logInfo("音楽を一時停止しました");
			return true;
		}
		return false;
	}

	// 音楽を再開
	public resumeMusic(): boolean {
		if (this.player.state.status === AudioPlayerStatus.Paused) {
			this.player.unpause();
			logInfo("音楽を再開しました");
			return true;
		}
		return false;
	}

	// AudioPlayerを取得（TTSとの共有用）
	public getPlayer(): AudioPlayer {
		return this.player;
	}

	// 現在のテキストチャンネルIDを取得するメソッド
	public getCurrentTextChannelId(): string | undefined {
		return this.currentTextChannel?.id;
	}

	// テキストチャンネルを更新するメソッド
	public updateTextChannel(textChannel: TextChannel): void {
		this.currentTextChannel = textChannel;
	}

	// エラーハンドリングと再試行メソッド
	private async handleErrorWithRetry(): Promise<void> {
		if (!this.currentTextChannel || !this.currentPlayingUrl) {
			this.playNext();
			return;
		}

		const guildId = this.currentTextChannel.guild.id;

		if (this.retryCount < this.maxRetries) {
			this.retryCount++;
			logInfo(
				`再生エラー: ${this.retryCount}回目の再試行 - ${this.currentPlayingUrl}`,
			);

			await this.updateStatusMessage(
				`再生エラーが発生しました。${this.retryCount}回目の再試行中... (${this.currentPlayingUrl})`,
				0xffaa00,
				"再試行中",
				true,
			);

			// 少し待ってから再試行
			setTimeout(() => {
				this.playNext();
			}, 2000 * this.retryCount); // 再試行回数に応じて待機時間を増やす
			return;
		}

		logError(`最大再試行回数に達しました: ${this.currentPlayingUrl}`);
		await this.updateStatusMessage(
			`再生エラー: ${this.currentPlayingUrl} の再生に失敗しました。次の曲に進みます。`,
			0xff0000,
			"再生失敗",
			true,
		);

		// 失敗したURLを記録
		this.failedUrls.add(this.currentPlayingUrl);
		this.retryCount = 0;

		// キューから削除して次へ
		this.queueManager.removeFromQueue(guildId, this.currentPlayingUrl);
		this.playNext();
	}

	// ストリーミング再生メソッド
	private async playWithStreaming(
		url: string,
		guildId: string,
	): Promise<boolean> {
		try {
			logInfo(`ストリーミング再生開始: ${url}`);

			await this.updateStatusMessage(
				"ストリーミング再生を準備中...",
				0xffaa00,
				"準備中",
			);

			// YouTubeストリームを取得（ffmpeg経由でwav形式に変換）
			const stream = await streamYoutubeAudio(url);
			if (!stream) {
				logError(`ストリーム取得失敗: ${url}`);

				// ユーザーにエラーを通知
				if (this.currentTextChannel) {
					await this.updateStatusMessage(
						"❌ YouTube動画の読み込みに失敗しました。",
						0xff0000,
						"エラー",
						true,
					);
				}

				return false;
			}

			// @discordjs/voiceが自動的にffmpegで変換するので、inputTypeを指定しない
			const resource = createAudioResource(stream, {
				inlineVolume: true,
			});

			// 現在のリソースとURLを保存
			this.currentResource = resource;
			this.currentPlayingUrl = url;

			// 音量設定
			if (this.currentResource?.volume) {
				this.currentResource.volume.setVolume(this.currentVolume);
			}

			const connection = getVoiceConnection(guildId);
			if (!connection) {
				logError("ストリーミング再生中にボイス接続が失われました");
				return false;
			}

			// プレイヤーを接続にサブスクライブ
			connection.subscribe(this.player);

			await this.updateStatusMessage(
				`ストリーミング再生開始: ${url}`,
				0x00ff00,
				"再生中",
			);

			// 再生開始
			this.player.play(resource);
			logInfo("ストリーミング再生を開始しました");

			return true;
		} catch (error) {
			logError(`ストリーミング再生エラー: ${error}`);
			return false;
		}
	}
}
