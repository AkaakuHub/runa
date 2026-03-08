import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioResource,
	getVoiceConnection,
} from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import { readJsonFileSync, writeJsonFileSync } from "../utils/jsonFile";
import { logDebug, logError, logInfo } from "../utils/logger";
import { parseSimpleSingScore } from "../utils/ttsSing/format";
import { synthesizeSingVoice } from "../utils/ttsSing/synthesis";
import { TTSQueue } from "./TTSQueue";

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

interface TTSPersistedSettings {
	speed: number;
	speaker: number;
	userSpeakers: Record<string, number>;
	guildSpeeds: Record<string, number>;
}

export class TTSService {
	private static instance: TTSService;
	private config: TTSConfig;
	private voiceCharacters: VoiceCharacter[] = [];
	private isPlaying = false;
	private currentAudioFile: string | null = null;
	private skipCurrentPlayback = false;
	private ttsQueue: TTSQueue;
	private userSpeakers: Map<string, number> = new Map();
	private guildSpeeds: Map<string, number> = new Map();
	private settingsPath = join(process.cwd(), "data", "tts-settings.json");
	private readonly singSpeaker = "6000";

	private constructor() {
		// デフォルト設定
		this.config = {
			voicevoxUrl: process.env.VOICEVOX_URL || "http://127.0.0.1:50021",
			speaker: 3, // ずんだもん
			speed: 1.0,
			volume: 0.8,
			pitch: 0.0,
			enabled: false,
		};
		this.loadPersistedSettings();

		this.ttsQueue = TTSQueue.getInstance();
		this.setupEventListeners();
		this.loadVoiceCharacters();
	}

	private setupEventListeners(): void {
		// TTSは独自のプレイヤーを持たないため、イベントリスナーは不要
	}

	public static getInstance(): TTSService {
		if (!TTSService.instance) {
			TTSService.instance = new TTSService();
		}
		return TTSService.instance;
	}

	private loadPersistedSettings(): void {
		const persisted = readJsonFileSync<Partial<TTSPersistedSettings>>(
			this.settingsPath,
			{},
		);

		if (typeof persisted.speed === "number") {
			this.config.speed = Math.max(0.5, Math.min(2.0, persisted.speed));
		}
		if (typeof persisted.speaker === "number") {
			this.config.speaker = persisted.speaker;
		}
		if (persisted.userSpeakers && typeof persisted.userSpeakers === "object") {
			for (const [userId, speaker] of Object.entries(persisted.userSpeakers)) {
				if (typeof speaker === "number") {
					this.userSpeakers.set(userId, speaker);
				}
			}
		}
		if (persisted.guildSpeeds && typeof persisted.guildSpeeds === "object") {
			for (const [guildId, speed] of Object.entries(persisted.guildSpeeds)) {
				if (typeof speed === "number") {
					this.guildSpeeds.set(guildId, Math.max(0.5, Math.min(2.0, speed)));
				}
			}
		}
	}

	private savePersistedSettings(): void {
		const persisted: TTSPersistedSettings = {
			speed: this.config.speed,
			speaker: this.config.speaker,
			userSpeakers: Object.fromEntries(this.userSpeakers),
			guildSpeeds: Object.fromEntries(this.guildSpeeds),
		};
		writeJsonFileSync(this.settingsPath, persisted);
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
	public cleanupAudioFile(audioFile: string): void {
		try {
			if (existsSync(audioFile)) {
				rmSync(audioFile);
				logDebug(`音声ファイルを削除しました: ${audioFile}`);
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
			logDebug(
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
	public setSpeaker(speaker: number, userId?: string): boolean {
		if (this.voiceCharacters.length === 0) {
			return false;
		}

		// 指定された話者が存在するか確認
		const exists = this.voiceCharacters.some((char) =>
			char.styles.some((style) => style.id === speaker),
		);

		if (exists) {
			if (userId) {
				this.userSpeakers.set(userId, speaker);
				logInfo(
					`音声キャラクターを${speaker}に設定しました (userId=${userId})`,
				);
			} else {
				this.config.speaker = speaker;
				logInfo(`デフォルト音声キャラクターを${speaker}に設定しました`);
			}
			this.savePersistedSettings();
			return true;
		}

		return false;
	}

	/**
	 * 読み上げ速度を設定
	 */
	public setSpeed(speed: number, guildId?: string): void {
		const normalizedSpeed = Math.max(0.5, Math.min(2.0, speed));
		if (guildId) {
			this.guildSpeeds.set(guildId, normalizedSpeed);
		} else {
			this.config.speed = normalizedSpeed;
		}
		this.savePersistedSettings();
		logInfo(`読み上げ速度を${normalizedSpeed}に設定しました`);
	}

	public getSpeakerForUser(userId: string): number {
		return this.userSpeakers.get(userId) ?? this.config.speaker;
	}

	public getSpeedForGuild(guildId: string): number {
		return this.guildSpeeds.get(guildId) ?? this.config.speed;
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
		userId?: string,
		isSing?: boolean,
	): Promise<boolean> {
		if (!this.config.enabled) {
			logDebug("TTS機能が無効のため、音声再生をスキップします");
			return false;
		}

		// キューに追加
		return this.ttsQueue.addToQueue(text, voiceChannel, userId, isSing);
	}

	/**
	 * 直接音声を再生（キューを使わない）
	 */
	public async speakDirect(
		text: string,
		voiceChannel: VoiceChannel,
		userId?: string,
		isSing = false,
	): Promise<boolean> {
		if (!this.config.enabled) {
			logDebug("TTS機能が無効のため、音声再生をスキップします");
			return false;
		}

		try {
			if (isSing) {
				const singAudio = await this.generateSingAudio(text);
				if (!singAudio) {
					return false;
				}
				const playbackSuccess = await this.playAudioAndWait(
					singAudio,
					voiceChannel.guild.id,
				);
				this.cleanupAudioFile(singAudio);
				return playbackSuccess;
			}

			// テキストの前処理
			const processedText = this.preprocessText(text);
			if (!processedText) {
				return false;
			}

			// 長いテキストを分割
			const textChunks = this.splitText(processedText, 30);
			if (textChunks.length === 0) {
				return false;
			}

			// 音声ファイルを生成して再生
			const speaker = userId
				? this.getSpeakerForUser(userId)
				: this.config.speaker;
			const speed = this.getSpeedForGuild(voiceChannel.guild.id);
			let success = true;
			for (const chunk of textChunks) {
				const audioFile = await this.generateAudio(chunk, speaker, speed);
				if (audioFile) {
					const playbackSuccess = await this.playAudioAndWait(
						audioFile,
						voiceChannel.guild.id,
					);
					this.cleanupAudioFile(audioFile);
					if (this.skipCurrentPlayback) {
						this.skipCurrentPlayback = false;
						logDebug("現在のTTSをスキップしました");
						break;
					}
					if (!playbackSuccess) {
						success = false;
					}
				}
			}

			return success;
		} catch (error) {
			logError(`直接音声再生エラー: ${error}`);
			return false;
		}
	}

	private async generateSingAudio(text: string): Promise<string | null> {
		const score = parseSimpleSingScore(text);
		if (!score) {
			logError("歌声スコアの解析に失敗しました");
			return null;
		}

		try {
			const voicevoxBaseUrl = new URL(this.config.voicevoxUrl);
			const result = await synthesizeSingVoice({
				host: voicevoxBaseUrl.hostname,
				port: voicevoxBaseUrl.port || "80",
				requestedSpeaker: this.singSpeaker,
				score,
				request: async (url, option) => {
					const response = await fetch(url.toString(), option);
					if (!response.ok) {
						return undefined;
					}
					return response;
				},
			});

			if (!result.audioData) {
				logError(`歌声生成エラー: ${result.error ?? "unknown error"}`);
				return null;
			}

			const timestamp = Date.now();
			const tempFile = join(
				process.cwd(),
				"tts-cache",
				`tts-temp-sing-${timestamp}.wav`,
			);
			writeFileSync(tempFile, Buffer.from(result.audioData));
			logDebug(`歌声音声ファイルを生成しました: ${tempFile}`);
			return tempFile;
		} catch (error) {
			logError(`歌声生成エラー: ${error}`);
			return null;
		}
	}

	/**
	 * テキストの前処理
	 */
	public preprocessText(text: string): string {
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
	public splitText(text: string, maxLength = 30): string[] {
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
	public async generateAudio(
		text: string,
		speaker: number,
		speed: number,
	): Promise<string | null> {
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
			params.append("speaker", speaker.toString());

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
			audioQuery.speedScale = speed;
			audioQuery.pitchScale = this.config.pitch;
			audioQuery.volumeScale = this.config.volume;

			// 音声を合成
			const synthesisParams = new URLSearchParams();
			synthesisParams.append("speaker", speaker.toString());

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
			logDebug(`音声ファイルを生成しました: ${tempFile}`);

			return tempFile;
		} catch (error) {
			logError(`音声生成エラー: ${error}`);
			return null;
		}
	}

	/**
	 * 音声を再生（再生完了を待機）
	 */
	public async playAudioAndWait(
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

			// MusicServiceを取得して現在の再生状態を確認
			const { MusicService } = await import("../services/MusicService");
			const musicService = MusicService.getInstance();
			const wasMusicPlaying = musicService.isCurrentlyPlaying();

			// 音楽が再生中の場合は一時停止
			if (wasMusicPlaying) {
				logDebug("TTS: 音楽を一時停止します");
				musicService.pauseMusic();
			}

			const resource = createAudioResource(audioFile, {
				inlineVolume: true,
			});

			if (resource.volume) {
				resource.volume.setVolume(this.config.volume);
			}

			// 音楽が再生中の場合は一時停止
			if (wasMusicPlaying) {
				logDebug("TTS: 音楽を一時停止します");
				musicService.pauseMusic();
			}

			// MusicServiceのAudioPlayerを一時的に使用
			const musicPlayer = musicService.getPlayer();
			connection.subscribe(musicPlayer);
			musicPlayer.play(resource);
			this.isPlaying = true;
			this.currentAudioFile = audioFile;

			logDebug("TTS音声の再生を開始しました");

			// 再生完了を待機
			const result = await this.waitForPlaybackComplete(musicPlayer);

			// TTS再生終了後に音楽を再開
			if (wasMusicPlaying) {
				logDebug("TTS: 音楽を再開します");
				await new Promise((resolve) => setTimeout(resolve, 300)); // 少し待ってから再開
				musicService.resumeMusic();
			}

			return result;
		} catch (error) {
			logError(`音声再生エラー: ${error}`);
			return false;
		}
	}

	/**
	 * 再生完了を待機
	 */
	private async waitForPlaybackComplete(player: AudioPlayer): Promise<boolean> {
		return new Promise((resolve) => {
			const finishHandler = () => {
				this.isPlaying = false;
				player.off(AudioPlayerStatus.Idle, finishHandler);
				player.off("error", errorHandler);
				resolve(true);
			};

			const errorHandler = () => {
				this.isPlaying = false;
				player.off(AudioPlayerStatus.Idle, finishHandler);
				player.off("error", errorHandler);
				resolve(true);
			};

			player.on(AudioPlayerStatus.Idle, finishHandler);
			player.on("error", errorHandler);
		});
	}

	/**
	 * ボイスチャンネルから切断
	 */
	public leaveChannel(guildId: string): boolean {
		try {
			const connection = getVoiceConnection(guildId);
			if (connection) {
				// TTSServiceは独自のプレイヤーを持たないため、接続のみ破棄
				connection.destroy();
				this.isPlaying = false;

				// 切断時に音声ファイルを削除
				if (this.currentAudioFile) {
					this.cleanupAudioFile(this.currentAudioFile);
					this.currentAudioFile = null;
				}

				logDebug("TTS用ボイスチャンネルから切断しました");
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
	 * 現在再生中のTTSを1件だけスキップ
	 */
	public async skipCurrent(): Promise<boolean> {
		if (!this.isPlaying) {
			return false;
		}

		try {
			this.skipCurrentPlayback = true;

			const { MusicService } = await import("../services/MusicService");
			const musicService = MusicService.getInstance();
			musicService.getPlayer().stop();
			return true;
		} catch (error) {
			this.skipCurrentPlayback = false;
			logError(`TTSスキップエラー: ${error}`);
			return false;
		}
	}
}
