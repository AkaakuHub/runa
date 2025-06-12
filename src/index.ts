import { Client, GatewayIntentBits } from "discord.js";
import * as dotenv from "dotenv";
import { config } from "./config/config";
import { setupEventListeners } from "./events";
import { logInfo } from "./utils/logger";
import { setupDailySummaryScheduler } from "./utils/scheduler";

// 環境変数の読み込みを確実に行う
dotenv.config();

// クライアントの作成
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.MessageContent,
	],
});

// 起動時のイベントハンドラ
client.once("ready", () => {
	logInfo(`起動完了！ログイン: ${client.user?.tag}`);
	logInfo(
		`環境変数: TOKEN=${config.token ? "設定済み" : "未設定"}, CLIENT_ID=${config.clientId ? "設定済み" : "未設定"}`,
	);
	
	setupDailySummaryScheduler(client);
});

// イベントリスナーのセットアップ
setupEventListeners(client);

// ボットのログイン
if (!config.token) {
	console.error(
		"トークンが設定されていません。.env ファイルを確認してください。",
	);
	process.exit(1);
}

client.login(config.token);
