import type { SimpleSingScore, TalkRequest } from "./types";

type SingParams = {
	host: string;
	port: string;
	requestedSpeaker: string;
	score: SimpleSingScore;
	request: TalkRequest;
};

type SingSynthesisResult = {
	audioData?: ArrayBuffer;
	error?: string;
};

const SING_READ_RETRY_COUNT = 2;

export async function synthesizeSingVoice(
	params: SingParams,
): Promise<SingSynthesisResult> {
	const singSpeaker = params.requestedSpeaker;

	const queryUrl = new URL(
		`http://${params.host}:${params.port}/sing_frame_audio_query`,
	);
	queryUrl.search = new URLSearchParams({ speaker: singSpeaker }).toString();
	const queryResponse = await params.request(queryUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(params.score),
	});
	if (!queryResponse) {
		return {
			error: `歌唱クエリの生成に失敗しました（speaker=${singSpeaker}）。`,
		};
	}

	let frameAudioQuery: unknown;
	try {
		frameAudioQuery = await queryResponse.json();
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return { error: `歌唱クエリ応答の解析に失敗しました: ${text}` };
	}

	const synthesisUrl = new URL(
		`http://${params.host}:${params.port}/frame_synthesis`,
	);
	synthesisUrl.search = new URLSearchParams({
		speaker: singSpeaker,
	}).toString();

	for (let attempt = 0; attempt <= SING_READ_RETRY_COUNT; attempt += 1) {
		const synthesisResponse = await params.request(synthesisUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(frameAudioQuery),
		});
		if (!synthesisResponse) {
			return {
				error: `歌唱音声の合成に失敗しました（speaker=${singSpeaker}）。`,
			};
		}

		try {
			return { audioData: await synthesisResponse.arrayBuffer() };
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			const retryable = isRetryableReadError(error);
			const canRetry = retryable && attempt < SING_READ_RETRY_COUNT;
			if (!canRetry) {
				return { error: `歌唱音声レスポンスの受信に失敗しました: ${text}` };
			}
			await sleep(200 * (attempt + 1));
		}
	}

	return { error: "歌唱音声レスポンスの受信に失敗しました。" };
}

function isRetryableReadError(error: unknown): boolean {
	const text = error instanceof Error ? error.message : String(error);
	const cause =
		error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
	const code =
		typeof cause === "object" && cause !== null && "code" in cause
			? String((cause as { code?: unknown }).code)
			: "";
	if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
		return true;
	}
	return /terminated|socket|network|reset/i.test(text);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
