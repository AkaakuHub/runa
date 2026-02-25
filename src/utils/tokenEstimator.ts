import { logError, logInfo } from "./logger";

const GPT_OSS_20B_TOKENIZER_ID = "openai/gpt-oss-20b";

let tokenizerPromise: Promise<unknown> | null = null;

type TokenizerLike = {
	encode: (text: string) => number[] | Promise<number[]>;
};

async function loadTokenizer(): Promise<TokenizerLike> {
	if (!tokenizerPromise) {
		tokenizerPromise = (async () => {
			// @ts-ignore Current tsconfig module resolution cannot locate bundled types here.
			const { AutoTokenizer } = await import("@huggingface/transformers");
			return AutoTokenizer.from_pretrained(GPT_OSS_20B_TOKENIZER_ID);
		})();
	}

	return tokenizerPromise;
}

export async function estimateTokensGptOss20bFromText(
	text: string,
): Promise<number> {
	try {
		const tokenizer = await loadTokenizer();
		const ids = await Promise.resolve(tokenizer.encode(text));
		return ids.length;
	} catch (error) {
		logError(`Tokenizer estimation failed: ${error}`);
		throw new Error(
			`Tokenizer estimation failed for model ${GPT_OSS_20B_TOKENIZER_ID}`,
		);
	}
}

export async function warmupTokenEstimator(): Promise<void> {
	try {
		await loadTokenizer();
		logInfo("Tokenizer loaded for gpt-oss-20b token estimation");
	} catch (error) {
		logError(`Tokenizer warmup failed: ${error}`);
	}
}
