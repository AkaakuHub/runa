import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioPlayer,
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
import { logDebug, logError, logInfo, logWarn } from "../../src/utils/logger";
import { RealtimeAudioMixer } from "../utils/audioMixer";
import {
	sanitizeYoutubeUrl,
	streamYoutubeAudio,
	updateYtdlp,
} from "../utils/youtubeUtils";
import { QueueManager } from "./QueueManager";

export class MusicService {
	private static instance: MusicService;
	private player: AudioPlayer;
	private queueManager: QueueManager;
	private currentTextChannel?: TextChannel;
	private isPlaying = false;
	private currentResource: {
		volume?: { setVolume: (volume: number) => void };
	} | null = null;
	private currentVolume = 0.1;
	private currentPlayingUrl?: string;
	private statusMessage?: Message;
	private retryCount = 0;
	private maxRetries = 3;
	private failedUrls: Set<string> = new Set();
	private currentMixer?: RealtimeAudioMixer;
	private skipRequested = false;

	private constructor() {
		this.player = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Play,
				maxMissedFrames: 50,
			},
		});
		this.queueManager = QueueManager.getInstance();

		this.player.on(AudioPlayerStatus.Playing, () => {
			logDebug("プレイヤー状態: 再生中");
		});

		this.player.on(AudioPlayerStatus.Idle, () => {
			logDebug("プレイヤー状態: アイドル状態");
		});

		this.player.on(AudioPlayerStatus.Buffering, () => {
			logDebug("プレイヤー状態: バッファリング中");
		});

		this.player.on(AudioPlayerStatus.Paused, () => {
			logDebug("プレイヤー状態: 一時停止中");
		});

		this.player.on(AudioPlayerStatus.AutoPaused, () => {
			logDebug("プレイヤー状態: 自動一時停止");
		});

		this.player.on("error", (error) => {
			logError(`音声再生エラー: ${error.message}`);
		});
	}

	public static getInstance(): MusicService {
		if (!MusicService.instance) {
			MusicService.instance = new MusicService();
		}
		return MusicService.instance;
	}

	public checkAndLeaveEmptyChannel(guildId: string): void {
		const connection = getVoiceConnection(guildId);
		if (!connection) return;

		const channelId = connection.joinConfig.channelId;
		const guild = this.currentTextChannel?.guild;
		if (!guild || !channelId) return;

		const voiceChannel = guild.channels.cache.get(channelId) as VoiceChannel;
		if (!voiceChannel) return;

		const hasHumans = voiceChannel.members.some((member) => !member.user.bot);
		if (!hasHumans) {
			logInfo(
				`ボイスチャンネル「${voiceChannel.name}」にはボットだけが残っているため、自動退出します`,
			);
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

	private async updateStatusMessage(
		content: string,
		color = 0x0099ff,
		title?: string,
		forceNewMessage = false,
	): Promise<void> {
		if (!this.currentTextChannel) return;

		const embed = new EmbedBuilder().setColor(color).setDescription(content);
		if (title) {
			embed.setTitle(title);
		}

		try {
			if (this.statusMessage && !forceNewMessage) {
				await this.statusMessage.edit({ embeds: [embed] });
			} else {
				this.statusMessage = await this.currentTextChannel.send({
					embeds: [embed],
				});
			}
		} catch (error) {
			logError(`メッセージ更新エラー: ${error}`);
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
			const existingConnection = getVoiceConnection(voiceChannel.guild.id);
			if (existingConnection) {
				if (existingConnection.joinConfig.channelId === voiceChannel.id) {
					logInfo("既に同じボイスチャンネルに接続済みです");
					this.currentTextChannel = textChannel;
					await this.updateStatusMessage(
						`ボイスチャンネル「${voiceChannel.name}」に接続済みです`,
						0x00ff00,
						"接続状態",
					);
					return true;
				}

				logInfo("別のボイスチャンネルに再接続します");
				this.stopMixer();
				existingConnection.destroy();
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			const connection = joinVoiceChannel({
				channelId: voiceChannel.id,
				guildId: voiceChannel.guild.id,
				adapterCreator: voiceChannel.guild.voiceAdapterCreator,
				selfDeaf: true,
				selfMute: false,
			});

			connection.on("stateChange", (oldState, newState) => {
				logDebug(`接続状態の変更: ${oldState.status} -> ${newState.status}`);
			});

			connection.on("error", (error) => {
				logError(`ボイス接続エラー: ${error.message}`);
			});

			let ready = false;
			try {
				await new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => {
						reject(new Error("ボイス接続のタイムアウト"));
					}, 10000);

					const stateChangeHandler = (
						_oldState: { status: string },
						newState: { status: string },
					) => {
						if (newState.status === "ready") {
							clearTimeout(timeout);
							connection.off("stateChange", stateChangeHandler);
							ready = true;
							resolve();
						}
					};

					connection.on("stateChange", stateChangeHandler);
				});
			} catch (error) {
				logError(`接続タイムアウト: ${error}`);
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

			connection.subscribe(this.player);
			this.currentTextChannel = textChannel;
			await this.updateStatusMessage(
				`ボイスチャンネル「${voiceChannel.name}」に接続しました`,
				0x00ff00,
				"接続成功",
			);
			return true;
		} catch (error) {
			logError(`ボイスチャンネル接続エラー: ${error}`);
			await this.updateStatusMessage(
				"ボイスチャンネルへの接続に失敗しました",
				0xff0000,
				"接続エラー",
			);
			return false;
		}
	}

	public leaveChannel(guildId: string, clearQueue = false): boolean {
		try {
			const connection = getVoiceConnection(guildId);
			if (!connection) {
				logDebug(`ボイスチャンネル退出試行、接続なし: ${guildId}`);
				return false;
			}

			logInfo(`ボイスチャンネルから退出: ${guildId}`);
			this.stopMixer();
			this.player.stop(true);
			connection.destroy();
			this.isPlaying = false;
			this.currentPlayingUrl = undefined;
			this.currentTextChannel = undefined;

			if (clearQueue) {
				this.queueManager.clearQueue(guildId);
				this.failedUrls.clear();
			}

			return true;
		} catch (error) {
			logError(`ボイスチャンネル切断エラー: ${error}`);
			return false;
		}
	}

	public async queueYoutubeUrl(url: string, guildId: string): Promise<string> {
		try {
			if (!url.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/)) {
				return "有効なYouTube URLではありません";
			}

			const sanitizedUrl = sanitizeYoutubeUrl(url);
			const queuePosition = this.queueManager.addToQueue(sanitizedUrl, guildId);
			const truncatedUrl = sanitizedUrl.replace("https://", "");

			const statusText =
				queuePosition === 1 && !this.isPlaying
					? `${truncatedUrl} の音声DLを開始します。\n再生キューの1番目に追加しました。すぐに再生を開始します。`
					: `${truncatedUrl} の音声DLを開始します。\n再生キューの${queuePosition}番目に追加しました。`;

			await this.updateStatusMessage(
				statusText,
				0x0099ff,
				"キューに追加",
				true,
			);
			return "";
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

	public async processQueue(): Promise<void> {
		if (this.isPlaying) {
			return;
		}

		await this.playNext();
	}

	public async playNext(): Promise<void> {
		if (this.isPlaying || !this.currentTextChannel) {
			logDebug(
				`playNext中止: isPlaying=${this.isPlaying}, currentTextChannel=${!!this.currentTextChannel}`,
			);
			return;
		}

		const guildId = this.currentTextChannel.guild.id;
		let nextItem = this.queueManager.getNextInQueue(guildId);
		while (nextItem && this.failedUrls.has(nextItem)) {
			logDebug(`失敗したURLをスキップ: ${nextItem}`);
			nextItem = this.queueManager.getNextInQueue(guildId);
		}

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

		if (!nextItem) {
			await this.updateStatusMessage(
				"再生キューが空になりました",
				0xffaa00,
				"再生完了",
			);
			return;
		}

		this.isPlaying = true;
		this.skipRequested = false;
		this.currentPlayingUrl = nextItem;

		try {
			await this.updateStatusMessage(
				"ストリーミング再生を準備中...",
				0xffaa00,
				"準備中",
			);
			const success = await this.playWithStreaming(nextItem, guildId);
			this.isPlaying = false;
			this.currentPlayingUrl = undefined;

			if (!success) {
				await this.handleErrorWithRetry();
				return;
			}

			this.retryCount = 0;
			await this.updateStatusMessage(
				`再生完了: ${nextItem}`,
				0xffaa00,
				this.skipRequested ? "スキップ完了" : "再生完了",
			);

			setTimeout(() => {
				if (!this.isPlaying) {
					this.playNext();
				}
			}, 1000);
		} catch (error) {
			logError(`playNext: 再生エラー全体: ${error}`);
			this.isPlaying = false;
			await this.updateStatusMessage(
				`再生中にエラーが発生しました: ${error}`,
				0xff0000,
				"エラー",
			);
			await this.handleErrorWithRetry();
		}
	}

	public setVolume(level: number): boolean {
		try {
			if (level < 0 || level > 100) {
				logError(`無効な音量レベル: ${level}`);
				return false;
			}

			const normalizedVolume = level / 100;
			this.currentVolume = normalizedVolume;

			if (this.currentResource?.volume) {
				this.currentResource.volume.setVolume(normalizedVolume);
			}

			logDebug(`音量を${level}%に設定しました`);
			return true;
		} catch (error) {
			logError(`音量設定エラー: ${error}`);
			return false;
		}
	}

	public getCurrentPlayingUrl(): string | undefined {
		return this.currentPlayingUrl;
	}

	public getCurrentQueue(guildId: string): string[] {
		return this.queueManager.getQueue(guildId) || [];
	}

	public skip(): boolean {
		if (!this.isPlaying) {
			return false;
		}

		this.skipRequested = true;
		this.stopMixer();
		this.player.stop(true);
		return true;
	}

	public isCurrentlyPlaying(): boolean {
		return this.isPlaying;
	}

	public pauseMusic(): boolean {
		if (!this.isPlaying) {
			return false;
		}
		this.player.pause();
		logInfo("音楽を一時停止しました");
		return true;
	}

	public resumeMusic(): boolean {
		if (this.player.state.status !== AudioPlayerStatus.Paused) {
			return false;
		}
		this.player.unpause();
		logInfo("音楽を再開しました");
		return true;
	}

	public getPlayer(): AudioPlayer {
		return this.player;
	}

	public getCurrentTextChannelId(): string | undefined {
		return this.currentTextChannel?.id;
	}

	public updateTextChannel(textChannel: TextChannel): void {
		this.currentTextChannel = textChannel;
	}

	public hasActiveMixer(): boolean {
		return !!this.currentMixer;
	}

	public enqueueTtsOverlay(audioFile: string): Promise<boolean> {
		if (!this.currentMixer) {
			return Promise.resolve(false);
		}
		return this.currentMixer.enqueueTtsFile(audioFile);
	}

	public skipTtsOverlay(): boolean {
		if (!this.currentMixer) {
			return false;
		}
		return this.currentMixer.skipCurrentTts();
	}

	private async handleErrorWithRetry(): Promise<void> {
		if (!this.currentTextChannel || !this.currentPlayingUrl) {
			this.playNext();
			return;
		}

		const guildId = this.currentTextChannel.guild.id;
		if (this.retryCount < this.maxRetries) {
			this.retryCount++;
			logWarn(
				`再生エラー: ${this.retryCount}回目の再試行 - ${this.currentPlayingUrl}`,
			);

			await this.updateStatusMessage(
				`再生エラーが発生しました。${this.retryCount}回目の再試行中... (${this.currentPlayingUrl})`,
				0xffaa00,
				"再試行中",
				true,
			);

			setTimeout(() => {
				this.isPlaying = false;
				this.playNext();
			}, 2000 * this.retryCount);
			return;
		}

		logError(`最大再試行回数に達しました: ${this.currentPlayingUrl}`);
		await this.updateStatusMessage(
			`再生エラー: ${this.currentPlayingUrl} の再生に失敗しました。次の曲に進みます。`,
			0xff0000,
			"再生失敗",
			true,
		);

		this.failedUrls.add(this.currentPlayingUrl);
		this.retryCount = 0;
		this.queueManager.removeFromQueue(guildId, this.currentPlayingUrl);
		this.currentPlayingUrl = undefined;
		this.isPlaying = false;
		this.playNext();
	}

	private async playWithStreaming(
		url: string,
		guildId: string,
	): Promise<boolean> {
		try {
			logDebug(`ストリーミング再生開始: ${url}`);

			const stream = await streamYoutubeAudio(url);
			if (!stream) {
				logError(`ストリーム取得失敗: ${url}`);
				await updateYtdlp();
				await this.updateStatusMessage(
					"❌ YouTube動画の読み込みに失敗しました。\n\nyt-dlpをアップデートしました。少し時間を置いて再度お試しください。",
					0xff0000,
					"エラー",
					true,
				);
				return false;
			}

			const connection = getVoiceConnection(guildId);
			if (!connection) {
				logError("ストリーミング再生中にボイス接続が失われました");
				return false;
			}

			this.stopMixer();
			this.currentMixer = new RealtimeAudioMixer();
			const resource = this.currentMixer.createResource();
			this.currentResource = resource;
			if (resource.volume) {
				resource.volume.setVolume(this.currentVolume);
			}

			connection.subscribe(this.player);
			this.player.play(resource);

			await this.updateStatusMessage(
				`ストリーミング再生開始: ${url}`,
				0x00ff00,
				"再生中",
			);

			await this.currentMixer.playMusicStream(stream);
			await this.currentMixer.waitForTtsDrain();
			return true;
		} catch (error) {
			if (this.skipRequested) {
				return true;
			}

			logError(`ストリーミング再生エラー: ${error}`);
			return false;
		} finally {
			this.currentResource = null;
			this.stopMixer();
			this.player.stop(true);
		}
	}

	private stopMixer(): void {
		this.currentMixer?.stop();
		this.currentMixer = undefined;
	}
}
