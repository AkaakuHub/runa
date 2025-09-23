import fs from "node:fs/promises";
import path from "node:path";
import { logError, logInfo } from "../utils/logger";

interface DailyChannelConfig {
	[guildId: string]: {
		channels: string[];
		summaryChannel?: string;
	};
}

class DailyChannelService {
	private configPath: string;
	private config: DailyChannelConfig = {};

	constructor() {
		this.configPath = path.join(process.cwd(), "data", "daily-channels.json");
		this.loadConfig();
	}

	private async loadConfig(): Promise<void> {
		try {
			const data = await fs.readFile(this.configPath, "utf-8");
			const rawConfig = JSON.parse(data);

			// 古い形式（string[]）から新しい形式への変換
			for (const [guildId, value] of Object.entries(rawConfig)) {
				if (Array.isArray(value)) {
					this.config[guildId] = { channels: value };
				} else {
					this.config[guildId] = value as {
						channels: string[];
						summaryChannel?: string;
					};
				}
			}

			logInfo("Daily channel config loaded");
		} catch {
			logInfo(
				"No existing daily channel config found, starting with empty config",
			);
			this.config = {};
		}
	}

	private async saveConfig(): Promise<void> {
		try {
			await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
			logInfo("Daily channel config saved");
		} catch (error) {
			logError(`Failed to save daily channel config: ${error}`);
		}
	}

	public async addChannel(
		guildId: string,
		channelId: string,
	): Promise<boolean> {
		if (!this.config[guildId]) {
			this.config[guildId] = { channels: [] };
		}

		if (this.config[guildId].channels.includes(channelId)) {
			return false;
		}

		this.config[guildId].channels.push(channelId);
		await this.saveConfig();
		return true;
	}

	public async removeChannel(
		guildId: string,
		channelId: string,
	): Promise<boolean> {
		if (!this.config[guildId]) {
			return false;
		}

		const index = this.config[guildId].channels.indexOf(channelId);
		if (index === -1) {
			return false;
		}

		this.config[guildId].channels.splice(index, 1);
		await this.saveConfig();
		return true;
	}

	public getChannels(guildId: string): string[] {
		return this.config[guildId]?.channels || [];
	}

	public async clearChannels(guildId: string): Promise<void> {
		if (!this.config[guildId]) {
			this.config[guildId] = { channels: [] };
		}
		this.config[guildId].channels = [];
		await this.saveConfig();
	}

	public async setSummaryChannel(
		guildId: string,
		channelId: string,
	): Promise<void> {
		if (!this.config[guildId]) {
			this.config[guildId] = { channels: [] };
		}
		this.config[guildId].summaryChannel = channelId;
		await this.saveConfig();
	}

	public getSummaryChannel(guildId: string): string | undefined {
		return this.config[guildId]?.summaryChannel;
	}

	public async clearSummaryChannel(guildId: string): Promise<void> {
		if (this.config[guildId]) {
			this.config[guildId].summaryChannel = undefined;
			await this.saveConfig();
		}
	}
}

export const dailyChannelService = new DailyChannelService();
