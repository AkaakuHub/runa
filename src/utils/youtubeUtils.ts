import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { logError, logInfo } from "../../src/utils/logger";
import { getCurrentTimestamp } from "./dateUtils";

const execAsync = promisify(exec);

// 一時的な音声ファイルを保存するディレクトリ
const TEMP_DIR = path.join(process.cwd(), "temp");

/**
 * YouTubeの動画から音声をダウンロード
 */
export async function downloadYoutubeAudio(
	url: string,
	guildId: string,
): Promise<string | null> {
	try {
		// 一時ディレクトリの作成
		if (!fs.existsSync(TEMP_DIR)) {
			fs.mkdirSync(TEMP_DIR, { recursive: true });
		}

		// 出力ファイル名の生成
		const fileName = `${guildId}_${getCurrentTimestamp()}.m4a`;
		const outputPath = path.join(TEMP_DIR, fileName);

		logInfo(`YouTubeオーディオのダウンロード開始: ${url}`);

		// yt-dlpを使用して音声をダウンロード
		const command = `yt-dlp ${url} -o "${outputPath}" -f bestaudio[ext=m4a] --no-mtime`;

		await execAsync(command);

		logInfo(`ダウンロード完了: ${outputPath}`);
		return outputPath;
	} catch (error) {
		logError(`YouTubeダウンロードエラー: ${error}`);
		return null;
	}
}

/**
 * YouTube URLを検証
 */
export function isValidYoutubeUrl(url: string): boolean {
	const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
	return youtubeRegex.test(url);
}
