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
	GROQ_API_KEY: string;

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
		GROQ_API_KEY,
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
		GROQ_API_KEY: GROQ_API_KEY as string,
		SUDACHI_PYTHON_PATH: SUDACHI_PYTHON_PATH || "sudachi/.venv/bin/python3",
		SUDACHI_MODE: SUDACHI_MODE || "C",
		SUDACHI_SCRIPT_PATH: SUDACHI_SCRIPT_PATH || "scripts/sudachi_tokenize.py",
	};
}
