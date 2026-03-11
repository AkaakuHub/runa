import { spawn } from "node:child_process";
import { logError, logInfo } from "../../src/utils/logger";

const YOUTUBE_AUDIO_FORMAT_SELECTOR =
	"bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best*[acodec!=none]/best";

/**
 * YouTube動画の再生用メディアURLを解決
 */
export async function resolveYoutubeAudioUrl(
	url: string,
): Promise<string | null> {
	try {
		logInfo(`YouTubeオーディオURLの解決開始: ${url}`);

		const args = [
			"--get-url",
			"-f",
			YOUTUBE_AUDIO_FORMAT_SELECTOR,
			"--no-playlist",
			"--no-progress",
			url,
		];

		const childProcess = spawn("yt-dlp", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderrBuffer = "";

		childProcess.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		childProcess.stderr?.on("data", (data) => {
			const errorMsg = data.toString();
			stderrBuffer = `${stderrBuffer}${errorMsg}`.slice(-4000);
			if (errorMsg.includes("ERROR") || errorMsg.includes("error")) {
				logError(`yt-dlp stderr: ${errorMsg}`);
			}
		});

		return await new Promise<string | null>((resolve) => {
			childProcess.once("error", (error) => {
				logError(`yt-dlp process error: ${error}`);
				resolve(null);
			});

			childProcess.once("close", (code, signal) => {
				if (
					code !== 0 ||
					(signal && signal !== "SIGTERM" && signal !== "SIGKILL")
				) {
					const detail = stderrBuffer.trim();
					logError(
						`yt-dlp exited before media url resolve code=${code} signal=${signal}${detail ? ` stderr=${detail}` : ""}`,
					);
					resolve(null);
					return;
				}

				const mediaUrl = stdout
					.split(/\r?\n/)
					.map((line) => line.trim())
					.find((line) => line.length > 0);

				if (!mediaUrl) {
					const detail = stderrBuffer.trim();
					logError(
						`yt-dlp returned empty media url${detail ? ` stderr=${detail}` : ""}`,
					);
					resolve(null);
					return;
				}

				logInfo(`YouTubeオーディオURLの解決成功: ${url}`);
				resolve(mediaUrl);
			});
		});
	} catch (error) {
		logError(`YouTubeオーディオURL解決エラー: ${error}`);
		return null;
	}
}

/**
 * yt-dlpをアップデートする
 */
export async function updateYtdlp(): Promise<void> {
	try {
		logInfo("yt-dlpのアップデートを開始します");

		const childProcess = spawn("pip", ["install", "-U", "yt-dlp"], {
			stdio: "pipe",
		});

		let output = "";
		let errorOutput = "";

		childProcess.stdout?.on("data", (data) => {
			output += data.toString();
		});

		childProcess.stderr?.on("data", (data) => {
			errorOutput += data.toString();
		});

		return new Promise((resolve, reject) => {
			childProcess.on("close", (code) => {
				if (code === 0) {
					logInfo(`yt-dlpアップデート成功: ${output.trim()}`);
					resolve();
				} else {
					logError(
						`yt-dlpアップデート失敗 (code: ${code}): ${errorOutput.trim()}`,
					);
					reject(new Error(`yt-dlp update failed with code ${code}`));
				}
			});

			childProcess.on("error", (error) => {
				logError(`yt-dlpアップデートプロセスエラー: ${error}`);
				reject(error);
			});
		});
	} catch (error) {
		logError(`yt-dlpアップデートエラー: ${error}`);
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
