import { Client, Events, GatewayIntentBits } from "discord.js";
import * as dotenv from "dotenv";
import { botClientRepository } from "./db/botClientRepository";
import { setupEventListeners } from "./events";
import { logError, logInfo } from "./utils/logger";
import {
	setupDailySummaryScheduler,
	setupReminderScheduler,
} from "./utils/scheduler";

// 環境変数の読み込みを確実に行う
dotenv.config({ quiet: true });

const botClients = botClientRepository.listEnabled();

if (botClients.length === 0) {
	logError("起動対象のbotクライアントがDBに登録されていません。");
	process.exit(1);
}

for (const botClient of botClients) {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.MessageContent,
		],
	});

	client.once(Events.ClientReady, () => {
		const message = `起動完了: ${botClient.name} (${client.user?.tag})`;
		console.log(message);
		logInfo(message);
		setupDailySummaryScheduler(client);
		setupReminderScheduler(client);
	});

	setupEventListeners(client);

	void client.login(botClient.token).catch((error) => {
		logError(
			`botクライアントのログインに失敗しました: ${botClient.name}, ${error}`,
		);
	});
}
