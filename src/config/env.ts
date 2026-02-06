/**
 * 環境変数の型安全な管理
 */
interface EnvConfig {
	// Discord関連
	TOKEN: string;
	CLIENT_ID: string;
	GUILD_ID: string;

	// Google AI関連
	GOOGLE_API_KEY: string;
	GROQ_API_KEY: string;

	// その他
	NG_WORDS: string[];
	SUDACHI_PYTHON_PATH: string;
	SUDACHI_MODE: string;
	SUDACHI_SCRIPT_PATH: string;
}

/**
 * 環境変数を検証して取得する
 */
export function getEnvConfig(): EnvConfig {
	const {
		TOKEN,
		CLIENT_ID,
		GUILD_ID,
		GOOGLE_API_KEY,
		GROQ_API_KEY,
		NG_WORDS,
		SUDACHI_PYTHON_PATH,
		SUDACHI_MODE,
		SUDACHI_SCRIPT_PATH,
	} = process.env;

	// 必須項目の検証
	const requiredEnvVars = {
		TOKEN,
		CLIENT_ID,
		GUILD_ID,
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

	// NG_WORDSをパース
	let ngWords: string[] = [];
	if (NG_WORDS) {
		ngWords = NG_WORDS.split(",")
			.map((word) => word.trim())
			.filter((word) => word.length > 0);
	}

	return {
		TOKEN: TOKEN as string,
		CLIENT_ID: CLIENT_ID as string,
		GUILD_ID: GUILD_ID as string,
		GOOGLE_API_KEY: GOOGLE_API_KEY as string,
		GROQ_API_KEY: GROQ_API_KEY as string,
		NG_WORDS: ngWords,
		SUDACHI_PYTHON_PATH: SUDACHI_PYTHON_PATH || "sudachi/.venv/bin/python3",
		SUDACHI_MODE: SUDACHI_MODE || "C",
		SUDACHI_SCRIPT_PATH: SUDACHI_SCRIPT_PATH || "scripts/sudachi_tokenize.py",
	};
}
