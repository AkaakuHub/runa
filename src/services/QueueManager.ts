import { logInfo } from "../../src/utils/logger";

export class QueueManager {
	private static instance: QueueManager;
	private queues: Map<string, string[]> = new Map();

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

		const queue = this.queues.get(guildId)!;
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

		return queue.shift();
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
	 * キューをクリア
	 */
	public clearQueue(guildId: string): void {
		this.queues.set(guildId, []);
		logInfo(`キューをクリア: ギルド ${guildId}`);
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
}
