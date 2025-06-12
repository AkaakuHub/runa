import fs from "node:fs/promises";
import path from "node:path";
import { logError, logInfo } from "../utils/logger";

interface DailyChannelConfig {
	[guildId: string]: string[];
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
			this.config = JSON.parse(data);
			logInfo("Daily channel config loaded");
		} catch {
			logInfo("No existing daily channel config found, starting with empty config");
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

	public async addChannel(guildId: string, channelId: string): Promise<boolean> {
		if (!this.config[guildId]) {
			this.config[guildId] = [];
		}

		if (this.config[guildId].includes(channelId)) {
			return false;
		}

		this.config[guildId].push(channelId);
		await this.saveConfig();
		return true;
	}

	public async removeChannel(guildId: string, channelId: string): Promise<boolean> {
		if (!this.config[guildId]) {
			return false;
		}

		const index = this.config[guildId].indexOf(channelId);
		if (index === -1) {
			return false;
		}

		this.config[guildId].splice(index, 1);
		await this.saveConfig();
		return true;
	}

	public getChannels(guildId: string): string[] {
		return this.config[guildId] || [];
	}

	public async clearChannels(guildId: string): Promise<void> {
		this.config[guildId] = [];
		await this.saveConfig();
	}
}

export const dailyChannelService = new DailyChannelService();