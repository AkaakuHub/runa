import { spawn } from "node:child_process";
import { logError, logInfo } from "../../src/utils/logger";
import type { Readable } from "node:stream";

// 一時的な音声ファイルを保存するディレクトリ
/**
 * YouTubeの動画から音声をストリーミング
 */
export async function streamYoutubeAudio(
	url: string,
): Promise<Readable | null> {
	try {
		logInfo(`YouTubeオーディオのストリーミング開始: ${url}`);

		// spawnを使用してバイナリストリームを正しく処理
		const args = [
			url,
			"-f",
			"bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
			"-o",
			"-",
			"--no-mtime",
			"--force-keyframes-at-cuts",
		];

		const childProcess = spawn("yt-dlp", args);

		if (!childProcess.stdout) {
			logError("ストリーミング: stdoutがありません");
			return null;
		}

		// エラーハンドリングを追加
		childProcess.stderr?.on("data", (data) => {
			// 重要なエラーのみログ出力
			const errorMsg = data.toString();
			if (errorMsg.includes("ERROR") || errorMsg.includes("error")) {
				logError(`yt-dlp stderr: ${errorMsg}`);
			}
		});

		childProcess.on("error", (error) => {
			logError(`yt-dlp process error: ${error}`);
		});

		logInfo(`ストリーミング開始成功: ${url}`);
		return childProcess.stdout;
	} catch (error) {
		logError(`YouTubeストリーミングエラー: ${error}`);
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
