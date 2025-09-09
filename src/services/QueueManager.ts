import { logInfo } from "../../src/utils/logger";

export class QueueManager {
	private static instance: QueueManager;
	private queues: Map<string, string[]> = new Map();
	private queueHistory: Map<string, string[]> = new Map(); // キューの履歴を保存
	private maxHistoryLength = 10; // 履歴の最大長

	private constructor() {}

	public static getInstance(): QueueManager {
		if (!QueueManager.instance) {
			QueueManager.instance = new QueueManager();
		}
		return QueueManager.instance;
	}

	/**
	 * キューにURLを追加し、そのキュー内の位置を返す
	 */
	public addToQueue(url: string, guildId: string): number {
		if (!this.queues.has(guildId)) {
			this.queues.set(guildId, []);
		}

		const queue = this.queues.get(guildId) ?? [];

		// 重複チェック
		if (queue.includes(url)) {
			logInfo(
				`重複URLを検出、キューに追加しません: ${url}, ギルド: ${guildId}`,
			);
			return queue.length;
		}

		queue.push(url);

		logInfo(`キューに追加: ${url}, ギルド: ${guildId}, 位置: ${queue.length}`);
		return queue.length;
	}

	/**
	 * キューの次のアイテムを取得し、キューから削除
	 */
	public getNextInQueue(guildId: string): string | undefined {
		const queue = this.queues.get(guildId);
		if (!queue || queue.length === 0) {
			return undefined;
		}

		const nextItem = queue.shift();

		// 履歴に追加
		if (nextItem) {
			this.addToHistory(guildId, nextItem);
		}

		return nextItem;
	}

	/**
	 * 履歴に追加
	 */
	private addToHistory(guildId: string, url: string): void {
		if (!this.queueHistory.has(guildId)) {
			this.queueHistory.set(guildId, []);
		}

		const history = this.queueHistory.get(guildId) ?? [];
		history.push(url);

		// 履歴の長さを制限
		if (history.length > this.maxHistoryLength) {
			history.shift();
		}
	}

	/**
	 * キューから特定のURLを削除する
	 * @param guildId ギルドID
	 * @param url 削除するURL
	 * @returns 削除された場合は true, 見つからなかった場合は false
	 */
	public removeFromQueue(guildId: string, url: string): boolean {
		const queue = this.queues.get(guildId);
		if (!queue) {
			return false;
		}
		const index = queue.indexOf(url);
		if (index > -1) {
			queue.splice(index, 1);
			logInfo(`キューから削除: ${url}, ギルド: ${guildId}`);
			return true;
		}
		return false;
	}

	/**
	 * キューをクリア（オプションで履歴もクリア）
	 */
	public clearQueue(guildId: string, clearHistory = false): void {
		this.queues.set(guildId, []);
		if (clearHistory) {
			this.queueHistory.set(guildId, []);
		}
		logInfo(
			`キューをクリア: ギルド ${guildId}${clearHistory ? " (履歴もクリア)" : ""}`,
		);
	}

	/**
	 * キューの長さを取得
	 */
	public getQueueLength(guildId: string): number {
		const queue = this.queues.get(guildId);
		return queue ? queue.length : 0;
	}

	/**
	 * キューの内容を取得
	 */
	public getQueue(guildId: string): string[] {
		return this.queues.get(guildId) || [];
	}

	/**
	 * キューの履歴を取得
	 */
	public getQueueHistory(guildId: string): string[] {
		return this.queueHistory.get(guildId) || [];
	}

	/**
	 * キューを復元（履歴から現在のキューに追加）
	 */
	public restoreFromHistory(guildId: string): boolean {
		const history = this.queueHistory.get(guildId);
		if (!history || history.length === 0) {
			return false;
		}

		const queue = this.queues.get(guildId) || [];

		// 履歴の最新の項目からキューに追加（重複を避ける）
		for (let i = history.length - 1; i >= 0; i--) {
			const url = history[i];
			if (!queue.includes(url)) {
				queue.unshift(url); // 先頭に追加
			}
		}

		this.queues.set(guildId, queue);
		logInfo(`キューを履歴から復元: ギルド ${guildId}, ${queue.length}曲`);
		return true;
	}

	/**
	 * キューの状態を取得（デバッグ用）
	 */
	public getQueueStatus(guildId: string): {
		queue: string[];
		history: string[];
		queueLength: number;
		historyLength: number;
	} {
		const queue = this.queues.get(guildId) || [];
		const history = this.queueHistory.get(guildId) || [];

		return {
			queue,
			history,
			queueLength: queue.length,
			historyLength: history.length,
		};
	}
}
