import { Client } from "discord.js";
import { messageCreateHandler } from "./messageCreate";
import { interactionCreateHandler } from "./interactionCreate";
import { logInfo } from "../utils/logger";

export const setupEventListeners = (client: Client): void => {
	// メッセージイベントのリスナー
	client.on("messageCreate", messageCreateHandler);

	// インタラクション（スラッシュコマンド）イベントのリスナー
	client.on("interactionCreate", interactionCreateHandler);

	logInfo("Event listeners have been set up");
};
