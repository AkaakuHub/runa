import { REST, Routes } from "discord.js";
import { config } from "./config/config";
import { logError, logInfo } from "./utils/logger";
import { getCommandBuilders } from "./utils/useCommands";
import "./commands";

if (!config.token || !config.clientId || !config.guildId) {
	console.error(
		"環境変数が設定されていません。.env ファイルを確認してください。",
	);
	process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(config.token);

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
		// リセットフラグが指定されている場合、既存のコマンドをすべて削除
		if (shouldReset) {
			logInfo("既存のコマンドをリセットします...");
			await rest.put(
				Routes.applicationGuildCommands(config.clientId, config.guildId),
				{ body: [] },
			);
			logInfo("コマンドのリセットが完了しました");
		}

		if (shouldResetGlobal) {
			logInfo("既存のグローバルコマンドをリセットします...");
			await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
			logInfo("グローバルコマンドのリセットが完了しました");
		}

		if (shouldResetOnly) {
			logInfo("リセットのみが指定されました。登録処理はスキップします。");
			return;
		}

		// 新しいコマンドを登録
		const commands = getCommandBuilders();

		// 登録されようとしているコマンドの内容を確認
		console.log(
			"登録しようとしているコマンド:",
			JSON.stringify(commands, null, 2),
		);

		logInfo(`${commands.length}個のスラッシュコマンドを登録しています...`);

		// 特定のギルドにのみコマンドを登録（即時反映、テスト用）
		await rest.put(
			Routes.applicationGuildCommands(config.clientId, config.guildId),
			{ body: commands },
		);

		logInfo("スラッシュコマンドの登録が完了しました！");
	} catch (error) {
		logError(`コマンドの登録中にエラーが発生しました: ${error}`);
		// エラーの詳細情報を出力
		console.error("詳細:", error);
	}
})();
