import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { logInfo, logError } from "../utils/logger";

/**
 * 音声コマンドを受け付けるチャンネルを管理するサービス
 */
export class ChannelRegistryService {
	private static instance: ChannelRegistryService;
	private registeredChannels: Map<string, string[]> = new Map(); // guildId -> channelIds[]
	private dbFilePath: string;

	private constructor() {
		this.dbFilePath = path.join(process.cwd(), "data/registeredChannels.json");
		this.loadFromDisk();
	}

	public static getInstance(): ChannelRegistryService {
		if (!ChannelRegistryService.instance) {
			ChannelRegistryService.instance = new ChannelRegistryService();
		}
		return ChannelRegistryService.instance;
	}

	/**
	 * チャンネルを登録する
	 * @param guildId サーバーID
	 * @param channelId チャンネルID
	 * @returns 成功した場合は true、既に登録されている場合は false
	 */
	public registerChannel(guildId: string, channelId: string): boolean {
		if (!this.registeredChannels.has(guildId)) {
			this.registeredChannels.set(guildId, []);
		}

		const channels = this.registeredChannels.get(guildId)!;
		if (channels.includes(channelId)) {
			return false; // 既に登録済み
		}

		channels.push(channelId);
		logInfo(`チャンネル登録: guildId=${guildId}, channelId=${channelId}`);
		this.saveToDisk();
		return true;
	}

	/**
	 * チャンネルの登録を解除する
	 * @param guildId サーバーID
	 * @param channelId チャンネルID
	 * @returns 成功した場合は true、登録されていなかった場合は false
	 */
	public unregisterChannel(guildId: string, channelId: string): boolean {
		if (!this.registeredChannels.has(guildId)) {
			return false;
		}

		const channels = this.registeredChannels.get(guildId)!;
		const index = channels.indexOf(channelId);
		if (index === -1) {
			return false; // 登録されていない
		}

		channels.splice(index, 1);
		logInfo(`チャンネル登録解除: guildId=${guildId}, channelId=${channelId}`);
		this.saveToDisk();
		return true;
	}

	/**
	 * チャンネルが登録されているかチェックする
	 * @param guildId サーバーID
	 * @param channelId チャンネルID
	 * @returns 登録されている場合は true
	 */
	public isRegistered(guildId: string, channelId: string): boolean {
		if (!this.registeredChannels.has(guildId)) {
			return false;
		}

		const channels = this.registeredChannels.get(guildId)!;
		return channels.includes(channelId);
	}

	/**
	 * サーバーの登録チャンネル一覧を取得する
	 * @param guildId サーバーID
	 * @returns 登録されているチャンネルIDの配列
	 */
	public getRegisteredChannels(guildId: string): string[] {
		return this.registeredChannels.get(guildId) || [];
	}

	/**
	 * データをディスクに保存する
	 */
	private saveToDisk(): void {
		try {
			// Map を JSON シリアライズ可能なオブジェクトに変換
			const data: Record<string, string[]> = {};
			this.registeredChannels.forEach((channels, guildId) => {
				data[guildId] = channels;
			});

			// データディレクトリが存在することを確認
			const dirPath = path.dirname(this.dbFilePath);
			if (!existsSync(dirPath)) {
				mkdirSync(dirPath, { recursive: true });
			}

			writeFileSync(this.dbFilePath, JSON.stringify(data, null, 2));
			logInfo("登録チャンネルデータをディスクに保存しました");
		} catch (error) {
			logError(`登録チャンネルの保存に失敗: ${error}`);
		}
	}

	/**
	 * ディスクからデータを読み込む
	 */
	private loadFromDisk(): void {
		try {
			if (existsSync(this.dbFilePath)) {
				const data = JSON.parse(readFileSync(this.dbFilePath, "utf8"));
				this.registeredChannels.clear();

				// JSON オブジェクトを Map に変換
				Object.entries(data).forEach(([guildId, channels]) => {
					this.registeredChannels.set(guildId, channels as string[]);
				});

				logInfo("登録チャンネルデータをディスクから読み込みました");
			} else {
				logInfo(
					"登録チャンネルのデータファイルが見つかりません。新規作成します。",
				);
			}
		} catch (error) {
			logError(`登録チャンネルの読み込みに失敗: ${error}`);
		}
	}
}
