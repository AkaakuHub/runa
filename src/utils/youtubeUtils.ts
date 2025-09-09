import { exec, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { logError, logInfo } from "../../src/utils/logger";
import { getCurrentTimestamp } from "./dateUtils";
import type { Readable } from "node:stream";

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
		const command = `yt-dlp ${url} -o "${outputPath}" -f bestaudio --no-mtime`;

		await execAsync(command);

		logInfo(`ダウンロード完了: ${outputPath}`);
		return outputPath;
	} catch (error) {
		logError(`YouTubeダウンロードエラー: ${error}`);
		return null;
	}
}

/**
 * YouTubeの動画から音声をストリーミング
 */
export async function streamYoutubeAudio(url: string): Promise<Readable | null> {
	try {
		logInfo(`YouTubeオーディオのストリーミング開始: ${url}`);

		// spawnを使用してバイナリストリームを正しく処理
		const args = [
			url,
			'-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
			'-o', '-',
			'--no-mtime',
			'--force-keyframes-at-cuts'
		];
		
		const childProcess = spawn('yt-dlp', args);
		
		if (!childProcess.stdout) {
			logError("ストリーミング: stdoutがありません");
			return null;
		}

		// エラーハンドリングを追加
		childProcess.stderr?.on('data', (data) => {
			logError(`yt-dlp stderr: ${data.toString()}`);
		});

		childProcess.on('error', (error) => {
			logError(`yt-dlp process error: ${error}`);
		});

		childProcess.on('close', (code) => {
			logInfo(`yt-dlp process closed with code: ${code}`);
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
