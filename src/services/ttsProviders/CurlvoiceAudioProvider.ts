import { logError } from "../../utils/logger";
import type { TTSAudioProvider, TTSSynthesisOptions } from "./types";

const RETRY_DELAYS_MS = [300, 1000, 3000] as const;
const REQUEST_TIMEOUT_MS = 10_000;

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFetchError(error: unknown): string {
	if (!(error instanceof Error)) {
		return "unknown";
	}

	const cause = (error as { cause?: unknown }).cause;
	if (cause instanceof Error && "code" in cause) {
		return `${error.name}:${String(cause.code)}`;
	}

	return error.name;
}

export class CurlvoiceAudioProvider implements TTSAudioProvider {
	public constructor(
		private readonly baseUrl: string,
		private readonly apiToken: string | undefined,
	) {}

	public async synthesize(options: TTSSynthesisOptions): Promise<ArrayBuffer> {
		if (!this.baseUrl) {
			throw new Error("CURLVOICE_URLが設定されていません");
		}
		if (!this.apiToken) {
			throw new Error("CURLVOICE_API_TOKENが設定されていません");
		}

		const response = await this.fetchSpeech(
			`${this.baseUrl}/v1/render/speech`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ message: options.text }),
			},
		);

		if (!response.ok) {
			throw new Error(`音声合成エラー: ${response.status}`);
		}

		return response.arrayBuffer();
	}

	private async fetchSpeech(url: string, init: RequestInit): Promise<Response> {
		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			try {
				const response = await this.fetchSpeechOnce(url, init);
				if (
					response.ok ||
					!this.shouldRetryResponse(response) ||
					attempt === RETRY_DELAYS_MS.length
				) {
					return response;
				}

				logError(
					`TTS音声合成を再試行します: status=${response.status}, retry=${attempt + 1}`,
				);
			} catch (error) {
				if (
					!this.shouldRetryError(error) ||
					attempt === RETRY_DELAYS_MS.length
				) {
					throw error;
				}

				logError(
					`TTS音声合成を再試行します: error=${formatFetchError(error)}, retry=${attempt + 1}`,
				);
			}

			await wait(RETRY_DELAYS_MS[attempt]);
		}

		return this.fetchSpeechOnce(url, init);
	}

	private async fetchSpeechOnce(
		url: string,
		init: RequestInit,
	): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			return await fetch(url, {
				...init,
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeout);
		}
	}

	private shouldRetryResponse(response: Response): boolean {
		return response.status >= 500;
	}

	private shouldRetryError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}

		if (error.name === "AbortError") {
			return true;
		}

		return error.message === "fetch failed";
	}
}
