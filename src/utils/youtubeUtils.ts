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
			"bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio",
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

		let hasError = false;

		// エラーハンドリングを追加
		childProcess.stderr?.on("data", (data) => {
			// 重要なエラーのみログ出力
			const errorMsg = data.toString();
			if (errorMsg.includes("ERROR") || errorMsg.includes("error")) {
				logError(`yt-dlp stderr: ${errorMsg}`);
				hasError = true;
			}
		});

		childProcess.on("error", (error) => {
			logError(`yt-dlp process error: ${error}`);
			hasError = true;
		});

		childProcess.on("exit", (code) => {
			if (code !== 0 && !hasError) {
				logError(`yt-dlp exited with code ${code}`);
				hasError = true;
			}
		});

		logInfo(`ストリーミング開始成功: ${url}`);

		// エラー情報をストリームに追加
		if (hasError) {
			// エラーがある場合はnullを返してエラーを伝達
			return null;
		}

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

/**
 * YouTube URLをサニタイズして不要なパラメータを削除
 * @param url YouTube URL
 * @returns サニタイズされたURL
 */
export function sanitizeYoutubeUrl(url: string): string {
	try {
		const urlObj = new URL(url);

		// YouTube関連のドメインのみ処理
		if (
			!urlObj.hostname.includes("youtube.com") &&
			!urlObj.hostname.includes("youtu.be")
		) {
			return url;
		}

		// 削除するパラメータのリスト
		const paramsToRemove = [
			"list", // プレイリストパラメータ
			"start_radio", // ラジオ開始パラメータ
			"index", // インデックスパラメータ
			"pp", // プレイリストパラメータ
			"t", // 時間パラメータ
			"feature", // 機能パラメータ
			"ab_channel", // チャンネルパラメータ
			"utm_source", // UTMパラメータ
			"utm_medium", // UTMパラメータ
			"utm_campaign", // UTMパラメータ
			"utm_term", // UTMパラメータ
			"utm_content", // UTMパラメータ
			"fbclid", // Facebookパラメータ
			"gclid", // Googleパラメータ
			"feature", // 機能パラメータ
			"lc", // コメントパラメータ
			"continue", // 続行パラメータ
			"hl", // 言語パラメータ
		];

		// URLSearchParamsを使用して安全にパラメータを操作
		const searchParams = new URLSearchParams(urlObj.search);

		// 削除対象のパラメータを削除
		for (const param of paramsToRemove) {
			searchParams.delete(param);
		}

		// クリーンな検索パラメータを再構築
		urlObj.search = searchParams.toString();

		// サニタイズされたURLを返す
		const sanitizedUrl = urlObj.toString();

		// 元のURLと変更がある場合のみログ
		if (sanitizedUrl !== url) {
			logInfo(`YouTube URLサニタイズ: ${url} -> ${sanitizedUrl}`);
		}

		return sanitizedUrl;
	} catch (error) {
		// URLパースに失敗した場合は元のURLを返す
		logError(`YouTube URLサニタイズエラー: ${url}, エラー: ${error}`);
		return url;
	}
}
