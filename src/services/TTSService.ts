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
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
	private cacheDir: string;
	private voiceCharacters: VoiceCharacter[] = [];
	private isPlaying = false;

	private constructor() {
		this.player = createAudioPlayer({
			behaviors: {
				noSubscriber: NoSubscriberBehavior.Play,
				maxMissedFrames: 50,
			},
		});

		// キャッシュディレクトリの設定
		this.cacheDir = join(process.cwd(), "tts-cache");
		if (!existsSync(this.cacheDir)) {
			mkdirSync(this.cacheDir, { recursive: true });
		}

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
		});

		this.player.on(AudioPlayerStatus.Buffering, () => {
			logInfo("TTSプレイヤー状態: バッファリング中");
		});

		this.player.on("error", (error) => {
			logError(`TTS音声再生エラー: ${error.message}`);
			this.isPlaying = false;
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

		try {
			// 音声ファイルを生成
			const audioFile = await this.generateAudio(processedText);
			if (!audioFile) {
				return false;
			}

			// ボイスチャンネルに接続
			const connection = await this.connectToVoiceChannel(voiceChannel);
			if (!connection) {
				return false;
			}

			// 音声を再生
			return await this.playAudio(audioFile, voiceChannel.guild.id);
		} catch (error) {
			logError(`TTS再生エラー: ${error}`);
			return false;
		}
	}

	/**
	 * テキストの前処理
	 */
	private preprocessText(text: string): string {
		// URLを除去
		let processed = text.replace(/https?:\/\/[^\s]+/g, "");

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

		// 長すぎるテキストは制限
		if (processed.length > 200) {
			processed = `${processed.substring(0, 200)}…`;
		}

		return processed;
	}

	/**
	 * 音声ファイルを生成
	 */
	private async generateAudio(text: string): Promise<string | null> {
		try {
			// キャッシュファイル名を生成
			const cacheKey = `${text}_${this.config.speaker}_${this.config.speed}_${this.config.pitch}`;
			const hash = Buffer.from(cacheKey)
				.toString("base64")
				.replace(/[^a-zA-Z0-9]/g, "");
			const cacheFile = join(this.cacheDir, `${hash}.wav`);

			// キャッシュが存在する場合はそれを使用
			if (existsSync(cacheFile)) {
				logInfo("キャッシュされた音声ファイルを使用します");
				return cacheFile;
			}

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

			// ファイルに保存
			writeFileSync(cacheFile, Buffer.from(audioData));
			logInfo(`音声ファイルを生成しました: ${cacheFile}`);

			return cacheFile;
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
	 * 音声を再生
	 */
	private async playAudio(
		audioFile: string,
		guildId: string,
	): Promise<boolean> {
		try {
			if (this.isPlaying) {
				logInfo("TTS再生中のため、新しい音声は再生しません");
				return false;
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

			logInfo("TTS音声の再生を開始しました");
			return true;
		} catch (error) {
			logError(`音声再生エラー: ${error}`);
			return false;
		}
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
				// this.currentTextChannel = undefined; // 未使用のため削除
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

	/**
	 * キャッシュをクリア
	 */
	public clearCache(): void {
		try {
			if (existsSync(this.cacheDir)) {
				const files = readdirSync(this.cacheDir);
				for (const file of files) {
					rmSync(join(this.cacheDir, file));
				}
				logInfo("TTSキャッシュをクリアしました");
			}
		} catch (error) {
			logError(`キャッシュクリアエラー: ${error}`);
		}
	}
}
