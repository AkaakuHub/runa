import type { VoiceChannel } from "discord.js";
import { logInfo, logError } from "../utils/logger";
import { TTSService } from "../services/TTSService";

interface TTSQueueItem {
	id: string;
	text: string;
	voiceChannel: VoiceChannel;
	audioFiles: string[];
	resolve: (value: boolean) => void;
	reject: (reason?: unknown) => void;
}

export class TTSQueue {
	private static instance: TTSQueue;
	private queue: TTSQueueItem[] = [];
	private isProcessing = false;

	private constructor() {}

	public static getInstance(): TTSQueue {
		if (!TTSQueue.instance) {
			TTSQueue.instance = new TTSQueue();
		}
		return TTSQueue.instance;
	}

	public async addToQueue(
		text: string,
		voiceChannel: VoiceChannel,
	): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const id = `tts_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
			const item: TTSQueueItem = {
				id,
				text,
				voiceChannel,
				audioFiles: [],
				resolve,
				reject,
			};

			this.queue.push(item);
			logInfo(`TTSキューに追加: ${id} (全キュー:${this.queue.length})`);

			if (!this.isProcessing) {
				this.processQueue();
			}
		});
	}

	private async processQueue(): Promise<void> {
		if (this.isProcessing) return;

		this.isProcessing = true;
		logInfo("TTSキューの処理を開始");

		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift();
				if (!item) continue;
				logInfo(`TTS処理開始: ${item.id} (残り:${this.queue.length})`);

				try {
					// TTSServiceに直接処理を任せる（接続管理も含めて）
					const ttsService = TTSService.getInstance();
					const success = await ttsService.speakDirect(
						item.text,
						item.voiceChannel,
					);

					item.resolve(success);
					logInfo(`TTS処理完了: ${item.id} (成功:${success})`);
				} catch (error) {
					logError(`TTS処理失敗: ${item.id}, ${error}`);
					item.reject(error);
				}
			}
		} catch (error) {
			logError(`TTSキュー処理エラー: ${error}`);
		} finally {
			this.isProcessing = false;
			logInfo("TTSキューの処理が完了");
		}
	}

	public getQueueLength(): number {
		return this.queue.length;
	}

	public clearQueue(): void {
		// 全てのアイテムをreject
		for (const item of this.queue) {
			try {
				item.reject(new Error("キューがクリアされました"));
			} catch {
				// rejectがすでに呼ばれている場合は無視
			}
		}

		this.queue = [];
		this.isProcessing = false;
		logInfo("TTSキューをクリアしました");
	}
}
