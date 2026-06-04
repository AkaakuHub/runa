import { REST, Routes } from "discord.js";
import { botClientRepository } from "./db/botClientRepository";
import { logDebug, logError, logInfo } from "./utils/logger";
import { getCommandBuilders } from "./utils/useCommands";
import "./commands";

const botClients = botClientRepository.listEnabled();

if (botClients.length === 0) {
	logError("起動対象のbotクライアントがDBに登録されていません。");
	process.exit(1);
}

// コマンドラインパラメータでリセットフラグを確認
const shouldReset = process.argv.includes("--reset");
const shouldResetGlobal = process.argv.includes("--reset-global");
const shouldResetOnly = process.argv.includes("--reset-only");

// リセットフラグが指定されていない場合、通常の登録処理のみ実行
if (!shouldReset && !shouldResetGlobal && !shouldResetOnly) {
	logInfo(
		"コマンドのリセットは指定されていません。通常の登録処理を実行します。",
	);
}

(async () => {
	try {
		// 新しいコマンドを登録
		const commands = getCommandBuilders();

		// 登録されようとしているコマンドの内容を確認
		logDebug("登録しようとしているコマンド:");
		logDebug(JSON.stringify(commands, null, 2));

		for (const botClient of botClients) {
			const rest = new REST({ version: "10" }).setToken(botClient.token);

			// リセットフラグが指定されている場合、既存のコマンドをすべて削除
			if (shouldReset) {
				logInfo(`既存のコマンドをリセットします: ${botClient.name}`);
				await rest.put(
					Routes.applicationGuildCommands(
						botClient.clientId,
						botClient.guildId,
					),
					{ body: [] },
				);
				logInfo(`コマンドのリセットが完了しました: ${botClient.name}`);
			}

			if (shouldResetGlobal) {
				logInfo(`既存のグローバルコマンドをリセットします: ${botClient.name}`);
				await rest.put(Routes.applicationCommands(botClient.clientId), {
					body: [],
				});
				logInfo(
					`グローバルコマンドのリセットが完了しました: ${botClient.name}`,
				);
			}

			if (shouldResetOnly) {
				continue;
			}

			logInfo(
				`${commands.length}個のスラッシュコマンドを登録しています: ${botClient.name}`,
			);

			await rest.put(
				Routes.applicationGuildCommands(botClient.clientId, botClient.guildId),
				{ body: commands },
			);

			logInfo(`スラッシュコマンドの登録が完了しました: ${botClient.name}`);
		}
	} catch (error) {
		logError(`コマンドの登録中にエラーが発生しました: ${error}`);
		// エラーの詳細情報を出力
		logError(`詳細: ${error}`);
	}
})();
