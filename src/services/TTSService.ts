import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	getVoiceConnection,
	joinVoiceChannel,
	NoSubscriberBehavior,
	type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import { logError, logInfo } from "../utils/logger";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface TTSConfig {
	voicevoxUrl: string;
	speaker: number;
	speed: number;
	volume: number;
	pitch: number;
	enabled: boolean;
}

interface VoiceCharacter {
	id: number;
	name: string;
	styles: Array<{
		name: string;
		id: number;
	}>;
}

export class TTSService {
	private static instance: TTSService;
	private config: TTSConfig;
	private player: AudioPlayer;
	private voiceCharacters: VoiceCharacter[] = [];
	private isPlaying = false;
	private currentAudioFile: string | null = null;

	private constructor() {
		this.player = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Play,
				maxMissedFrames: 50,
			},
		});

		// デフォルト設定
		this.config = {
			voicevoxUrl: process.env.VOICEVOX_URL || "http://127.0.0.1:50021",
			speaker: 3, // ずんだもん
			speed: 1.0,
			volume: 0.8,
			pitch: 0.0,
			enabled: false,
		};

		this.setupEventListeners();
		this.loadVoiceCharacters();
	}

	private setupEventListeners(): void {
		this.player.on(AudioPlayerStatus.Playing, () => {
			logInfo("TTSプレイヤー状態: 再生中");
		});

		this.player.on(AudioPlayerStatus.Idle, () => {
			logInfo("TTSプレイヤー状態: アイドル状態");
			this.isPlaying = false;

			// 再生終了後に音声ファイルを削除
			if (this.currentAudioFile) {
				this.cleanupAudioFile(this.currentAudioFile);
				this.currentAudioFile = null;
			}
		});

		this.player.on(AudioPlayerStatus.Buffering, () => {
			logInfo("TTSプレイヤー状態: バッファリング中");
		});

		this.player.on("error", (error) => {
			logError(`TTS音声再生エラー: ${error.message}`);
			this.isPlaying = false;

			// エラー時にも音声ファイルを削除
			if (this.currentAudioFile) {
				this.cleanupAudioFile(this.currentAudioFile);
				this.currentAudioFile = null;
			}
		});
	}

	public static getInstance(): TTSService {
		if (!TTSService.instance) {
			TTSService.instance = new TTSService();
		}
		return TTSService.instance;
	}

	/**
	 * 利用可能な音声キャラクター一覧を取得
	 */
	public async getVoiceCharacters(): Promise<VoiceCharacter[]> {
		try {
			if (this.voiceCharacters.length > 0) {
				return this.voiceCharacters;
			}

			const response = await fetch(`${this.config.voicevoxUrl}/speakers`);
			if (!response.ok) {
				throw new Error(`VOICEVOX APIエラー: ${response.status}`);
			}

			this.voiceCharacters = await response.json();
			return this.voiceCharacters;
		} catch (error) {
			logError(`音声キャラクター取得エラー: ${error}`);
			return [];
		}
	}

	/**
	 * 音声ファイルをクリーンアップ
	 */
	private cleanupAudioFile(audioFile: string): void {
		try {
			if (existsSync(audioFile)) {
				rmSync(audioFile);
				logInfo(`音声ファイルを削除しました: ${audioFile}`);
			}
		} catch (error) {
			logError(`音声ファイル削除エラー: ${error}`);
		}
	}

	/**
	 * 音声キャラクター一覧を読み込む
	 */
	private async loadVoiceCharacters(): Promise<void> {
		try {
			await this.getVoiceCharacters();
			logInfo(
				`${this.voiceCharacters.length}個の音声キャラクターを読み込みました`,
			);
		} catch (error) {
			logError(`音声キャラクター読み込みエラー: ${error}`);
		}
	}

	/**
	 * TTS機能の有効/無効を設定
	 */
	public setEnabled(enabled: boolean): void {
		this.config.enabled = enabled;
		logInfo(`TTS機能を${enabled ? "有効" : "無効"}にしました`);
	}

	/**
	 * TTS機能が有効かどうかを取得
	 */
	public isEnabled(): boolean {
		return this.config.enabled;
	}

	/**
	 * 音声キャラクターを設定
	 */
	public setSpeaker(speaker: number): boolean {
		if (this.voiceCharacters.length === 0) {
			return false;
		}

		// 指定された話者が存在するか確認
		const exists = this.voiceCharacters.some((char) =>
			char.styles.some((style) => style.id === speaker),
		);

		if (exists) {
			this.config.speaker = speaker;
			logInfo(`音声キャラクターを${speaker}に設定しました`);
			return true;
		}

		return false;
	}

	/**
	 * 読み上げ速度を設定
	 */
	public setSpeed(speed: number): void {
		this.config.speed = Math.max(0.5, Math.min(2.0, speed));
		logInfo(`読み上げ速度を${this.config.speed}に設定しました`);
	}

	/**
	 * 音量を設定
	 */
	public setVolume(volume: number): void {
		this.config.volume = Math.max(0.0, Math.min(1.0, volume));
		logInfo(`TTS音量を${this.config.volume}に設定しました`);
	}

	/**
	 * 音高を設定
	 */
	public setPitch(pitch: number): void {
		this.config.pitch = Math.max(-10.0, Math.min(10.0, pitch));
		logInfo(`音高を${this.config.pitch}に設定しました`);
	}

	/**
	 * 現在の設定を取得
	 */
	public getConfig(): TTSConfig {
		return { ...this.config };
	}

	/**
	 * テキストを音声に変換して再生
	 */
	public async speak(
		text: string,
		voiceChannel: VoiceChannel,
	): Promise<boolean> {
		if (!this.config.enabled) {
			logInfo("TTS機能が無効のため、音声再生をスキップします");
			return false;
		}

		// テキストの前処理
		const processedText = this.preprocessText(text);
		if (!processedText) {
			return false;
		}

		// 長いテキストを分割
		const textChunks = this.splitText(processedText, 30);

		try {
			// 分割されたテキストを順番に再生
			for (const chunk of textChunks) {
				// 音声ファイルを生成
				const audioFile = await this.generateAudio(chunk);
				if (!audioFile) {
					continue;
				}

				// ボイスチャンネルに接続
				const connection = await this.connectToVoiceChannel(voiceChannel);
				if (!connection) {
					return false;
				}

				// 音声を再生（前の音声が終わるのを待つ）
				await this.playAudioAndWait(audioFile, voiceChannel.guild.id);
			}

			return true;
		} catch (error) {
			logError(`TTS再生エラー: ${error}`);
			return false;
		}
	}

	/**
	 * テキストの前処理
	 */
	private preprocessText(text: string): string {
		// URLを除去（www付きも含む）
		let processed = text.replace(/(https?:\/\/\S+)|(www\.\S+)/g, "");

		// メンションを除去
		processed = processed.replace(/<@!?[0-9]+>/g, "");
		processed = processed.replace(/<#[0-9]+>/g, "");
		processed = processed.replace(/<@&[0-9]+>/g, "");

		// カスタム絵文字を除去
		processed = processed.replace(/<a?:[^\s]+:[0-9]+>/g, "");

		// 過剰な空白を整理
		processed = processed.replace(/\s+/g, " ").trim();

		// 空文字になった場合は null を返す
		if (!processed) {
			return "";
		}

		return processed;
	}

	/**
	 * 長いテキストを分割する
	 */
	private splitText(text: string, maxLength = 30): string[] {
		const chunks: string[] = [];

		// 句読点や改行で分割を試みる
		const sentences = text.split(/[。！？.!?\n]+/);

		for (const sentence of sentences) {
			if (!sentence.trim()) continue;

			if (sentence.length <= maxLength) {
				chunks.push(sentence.trim());
			} else {
				// 長い文はさらに単語で分割
				const words = sentence.split(/\s+/);
				let currentChunk = "";

				for (const word of words) {
					if (currentChunk.length + word.length + 1 <= maxLength) {
						currentChunk += (currentChunk ? " " : "") + word;
					} else {
						if (currentChunk) {
							chunks.push(currentChunk.trim());
						}
						currentChunk = word;
					}
				}

				if (currentChunk) {
					chunks.push(currentChunk.trim());
				}
			}
		}

		return chunks.filter((chunk) => chunk.length > 0);
	}

	/**
	 * 音声ファイルを生成
	 */
	private async generateAudio(text: string): Promise<string | null> {
		try {
			// 一時ファイル名を生成（タイムスタンプベース）
			const timestamp = Date.now();
			const tempFile = join(
				process.cwd(),
				"tts-cache",
				`tts-temp-${timestamp}.wav`,
			);

			// 音声クエリを作成
			const params = new URLSearchParams();
			params.append("text", text);
			params.append("speaker", this.config.speaker.toString());

			const queryResponse = await fetch(
				`${this.config.voicevoxUrl}/audio_query?${params.toString()}`,
				{
					method: "POST",
				},
			);

			if (!queryResponse.ok) {
				throw new Error(`音声クエリ作成エラー: ${queryResponse.status}`);
			}

			const audioQuery = await queryResponse.json();

			// パラメータを設定
			audioQuery.speedScale = this.config.speed;
			audioQuery.pitchScale = this.config.pitch;
			audioQuery.volumeScale = this.config.volume;

			// 音声を合成
			const synthesisParams = new URLSearchParams();
			synthesisParams.append("speaker", this.config.speaker.toString());

			const synthesisResponse = await fetch(
				`${this.config.voicevoxUrl}/synthesis?${synthesisParams.toString()}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(audioQuery),
				},
			);

			if (!synthesisResponse.ok) {
				throw new Error(`音声合成エラー: ${synthesisResponse.status}`);
			}

			const audioData = await synthesisResponse.arrayBuffer();

			// 一時ファイルに保存
			writeFileSync(tempFile, Buffer.from(audioData));
			logInfo(`音声ファイルを生成しました: ${tempFile}`);

			return tempFile;
		} catch (error) {
			logError(`音声生成エラー: ${error}`);
			return null;
		}
	}

	/**
	 * ボイスチャンネルに接続
	 */
	private async connectToVoiceChannel(
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
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			const connection = joinVoiceChannel({
				channelId: voiceChannel.id,
				guildId: voiceChannel.guild.id,
				adapterCreator: voiceChannel.guild.voiceAdapterCreator,
				selfDeaf: true,
				selfMute: false,
			});

			// 接続準備完了を待機
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("ボイス接続タイムアウト"));
				}, 10000);

				const stateChangeHandler = (
					_oldState: { status: string },
					newState: { status: string },
				) => {
					if (newState.status === "ready") {
						clearTimeout(timeout);
						connection.off("stateChange", stateChangeHandler);
						resolve();
					}
				};

				connection.on("stateChange", stateChangeHandler);
			});

			// this.currentTextChannel = textChannel; // 未使用のためコメントアウト
			return connection;
		} catch (error) {
			logError(`ボイスチャンネル接続エラー: ${error}`);
			return null;
		}
	}

	/**
	 * 音声を再生（再生完了を待機）
	 */
	private async playAudioAndWait(
		audioFile: string,
		guildId: string,
	): Promise<boolean> {
		try {
			// 前の音声が終わるのを待つ
			while (this.isPlaying) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			const connection = getVoiceConnection(guildId);
			if (!connection) {
				logError("ボイス接続が見つかりません");
				return false;
			}

			const resource = createAudioResource(audioFile, {
				inlineVolume: true,
			});

			if (resource.volume) {
				resource.volume.setVolume(this.config.volume);
			}

			connection.subscribe(this.player);
			this.player.play(resource);
			this.isPlaying = true;
			this.currentAudioFile = audioFile;

			logInfo("TTS音声の再生を開始しました");

			// 再生完了を待機
			return await this.waitForPlaybackComplete();
		} catch (error) {
			logError(`音声再生エラー: ${error}`);
			return false;
		}
	}

	/**
	 * 再生完了を待機
	 */
	private async waitForPlaybackComplete(): Promise<boolean> {
		return new Promise((resolve) => {
			const checkCompletion = () => {
				if (!this.isPlaying) {
					resolve(true);
				} else {
					setTimeout(checkCompletion, 100);
				}
			};
			checkCompletion();
		});
	}

	/**
	 * ボイスチャンネルから切断
	 */
	public leaveChannel(guildId: string): boolean {
		try {
			const connection = getVoiceConnection(guildId);
			if (connection) {
				this.player.stop(true);
				connection.destroy();
				this.isPlaying = false;

				// 切断時に音声ファイルを削除
				if (this.currentAudioFile) {
					this.cleanupAudioFile(this.currentAudioFile);
					this.currentAudioFile = null;
				}

				logInfo("TTS用ボイスチャンネルから切断しました");
				return true;
			}
			return false;
		} catch (error) {
			logError(`TTS切断エラー: ${error}`);
			return false;
		}
	}

	/**
	 * 現在再生中かどうかを取得
	 */
	public isCurrentlyPlaying(): boolean {
		return this.isPlaying;
	}
}
