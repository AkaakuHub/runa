import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import { logError, logInfo } from "../../src/utils/logger";

const YOUTUBE_STREAM_BUFFER_BYTES = 1024 * 1024;

// 一時的な音声ファイルを保存するディレクトリ
/**
 * YouTubeの動画から音声をストリーミング
 */
export async function streamYoutubeAudio(
	url: string,
): Promise<Readable | null> {
	try {
		logInfo(`YouTubeオーディオのストリーミング開始: ${url}`);

		// 音声専用フォーマットが存在しない動画向けに、音声付き通常動画までフォールバックする
		const args = [
			"-f",
			"bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best*[acodec!=none]/best",
			"-o",
			"-",
			"--no-playlist",
			"--no-mtime",
			"--no-progress",
			url,
		];

		const childProcess = spawn("yt-dlp", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (!childProcess.stdout) {
			logError("ストリーミング: stdoutがありません");
			return null;
		}

		let startupResolved = false;
		let stderrBuffer = "";
		const output = new PassThrough({
			highWaterMark: YOUTUBE_STREAM_BUFFER_BYTES,
		});

		childProcess.stdout.on("error", (error) => {
			logInfo(`yt-dlp stdout closed: ${error}`);
		});

		childProcess.stderr?.on("data", (data) => {
			const errorMsg = data.toString();
			stderrBuffer = `${stderrBuffer}${errorMsg}`.slice(-4000);
			if (errorMsg.includes("ERROR") || errorMsg.includes("error")) {
				logError(`yt-dlp stderr: ${errorMsg}`);
			}
		});

		return await new Promise<Readable | null>((resolve) => {
			const cleanupStartupListeners = () => {
				childProcess.stdout?.off("data", onFirstChunk);
				childProcess.off("error", onProcessError);
				childProcess.off("close", onProcessClose);
			};

			const failStartup = (reason: string) => {
				if (startupResolved) {
					return;
				}
				startupResolved = true;
				cleanupStartupListeners();
				output.destroy();
				if (childProcess.exitCode === null && !childProcess.killed) {
					childProcess.kill("SIGKILL");
				}
				logError(reason);
				resolve(null);
			};

			const onFirstChunk = (chunk: Buffer) => {
				if (startupResolved) {
					return;
				}
				startupResolved = true;
				cleanupStartupListeners();
				output.write(chunk);
				childProcess.stdout?.pipe(output);
				logInfo(`ストリーミング開始成功: ${url}`);
				resolve(output);
			};

			const onProcessError = (error: Error) => {
				failStartup(`yt-dlp process error: ${error}`);
			};

			const onProcessClose = (
				code: number | null,
				signal: NodeJS.Signals | null,
			) => {
				if (startupResolved) {
					if (!output.destroyed) {
						output.end();
					}
					if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGKILL") {
						const detail = stderrBuffer.trim();
						logError(
							`yt-dlp exited during stream code=${code} signal=${signal}${detail ? ` stderr=${detail}` : ""}`,
						);
					}
					return;
				}

				const detail = stderrBuffer.trim();
				failStartup(
					`yt-dlp exited before stream startup code=${code} signal=${signal}${detail ? ` stderr=${detail}` : ""}`,
				);
			};

			childProcess.stdout?.once("data", onFirstChunk);
			childProcess.once("error", onProcessError);
			childProcess.once("close", onProcessClose);
		});
	} catch (error) {
		logError(`YouTubeストリーミングエラー: ${error}`);
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
