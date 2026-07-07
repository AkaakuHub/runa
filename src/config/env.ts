import * as dotenv from "dotenv";

dotenv.config({ quiet: true });

/**
 * 環境変数の型安全な管理
 */
interface EnvConfig {
	// Google AI関連
	GOOGLE_API_KEY: string;
	GOOGLE_AI_DEFAULT_MODEL?: string;
	GOOGLE_AI_LIGHT_MODEL?: string;
	GOOGLE_AI_FALLBACK_MODELS: string[];
	GROQ_API_KEY: string;

	SEARXNG_BASE_URL?: string;
	CRAWL4AI_UV_COMMAND: string;
	CRAWL4AI_UV_PROJECT_DIR: string;
	WEB_SEARCH_MAX_RESULTS: number;
	WEB_SEARCH_MAX_CANDIDATES: number;
	WEB_SEARCH_MAX_MARKDOWN_LENGTH: number;
	WEB_SEARCH_CONCURRENCY: number;

	SUDACHI_PYTHON_PATH: string;
	SUDACHI_MODE: string;
	SUDACHI_SCRIPT_PATH: string;
}

/**
 * 環境変数を検証して取得する
 */
export function getEnvConfig(): EnvConfig {
	const {
		GOOGLE_API_KEY,
		GOOGLE_AI_DEFAULT_MODEL,
		GOOGLE_AI_LIGHT_MODEL,
		GOOGLE_AI_FALLBACK_MODELS,
		GROQ_API_KEY,
		SEARXNG_BASE_URL,
		CRAWL4AI_UV_COMMAND,
		CRAWL4AI_UV_PROJECT_DIR,
		WEB_SEARCH_MAX_RESULTS,
		WEB_SEARCH_MAX_CANDIDATES,
		WEB_SEARCH_MAX_MARKDOWN_LENGTH,
		WEB_SEARCH_CONCURRENCY,
		SUDACHI_PYTHON_PATH,
		SUDACHI_MODE,
		SUDACHI_SCRIPT_PATH,
	} = process.env;

	// 必須項目の検証
	const requiredEnvVars = {
		GOOGLE_API_KEY,
		GROQ_API_KEY,
	};

	const missingVars = Object.entries(requiredEnvVars)
		.filter(([, value]) => !value)
		.map(([key]) => key);

	if (missingVars.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missingVars.join(", ")}`,
		);
	}

	return {
		GOOGLE_API_KEY: GOOGLE_API_KEY as string,
		GOOGLE_AI_DEFAULT_MODEL,
		GOOGLE_AI_LIGHT_MODEL,
		GOOGLE_AI_FALLBACK_MODELS: GOOGLE_AI_FALLBACK_MODELS
			? GOOGLE_AI_FALLBACK_MODELS.split(",")
					.map((model) => model.trim())
					.filter(Boolean)
			: ["gemini-3-flash-preview", "gemini-2.5-flash-lite", "gemini-2.5-flash"],
		GROQ_API_KEY: GROQ_API_KEY as string,
		SEARXNG_BASE_URL,
		CRAWL4AI_UV_COMMAND: CRAWL4AI_UV_COMMAND || "uv",
		CRAWL4AI_UV_PROJECT_DIR: CRAWL4AI_UV_PROJECT_DIR || ".",
		WEB_SEARCH_MAX_RESULTS: WEB_SEARCH_MAX_RESULTS
			? Number.parseInt(WEB_SEARCH_MAX_RESULTS, 10)
			: 10,
		WEB_SEARCH_MAX_CANDIDATES: WEB_SEARCH_MAX_CANDIDATES
			? Number.parseInt(WEB_SEARCH_MAX_CANDIDATES, 10)
			: 50,
		WEB_SEARCH_MAX_MARKDOWN_LENGTH: WEB_SEARCH_MAX_MARKDOWN_LENGTH
			? Number.parseInt(WEB_SEARCH_MAX_MARKDOWN_LENGTH, 10)
			: 4000,
		WEB_SEARCH_CONCURRENCY: WEB_SEARCH_CONCURRENCY
			? Number.parseInt(WEB_SEARCH_CONCURRENCY, 10)
			: 5,
		SUDACHI_PYTHON_PATH: SUDACHI_PYTHON_PATH || "sudachi/.venv/bin/python3",
		SUDACHI_MODE: SUDACHI_MODE || "C",
		SUDACHI_SCRIPT_PATH: SUDACHI_SCRIPT_PATH || "scripts/sudachi_tokenize.py",
	};
}
