import { config as dotenvConfig } from "dotenv";

dotenvConfig();

interface BotConfig {
	token: string;
	clientId: string;
	guildId: string;
}

export const config: BotConfig = {
	token: process.env.TOKEN || "",
	clientId: process.env.CLIENT_ID || "",
	guildId: process.env.GUILD_ID || "",
};
