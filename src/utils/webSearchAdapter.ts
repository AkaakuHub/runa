import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEnvConfig } from "../config/env";

const execFileAsync = promisify(execFile);
const CRAWL4AI_MODULE_NAME = "runa_web_tools.crawl4ai_extract";

interface SearxngResult {
	title: string;
	url: string;
	content: string;
}

interface SearxngResponse {
	results: SearxngResult[];
}

interface Crawl4AiResult {
	status: "ok";
	url: string;
	title: string;
	markdown: string;
}

interface Crawl4AiFailedResult {
	status: "empty" | "error";
	url: string;
	error: string;
}

type Crawl4AiExtractionResult = Crawl4AiResult | Crawl4AiFailedResult;

export interface WebSearchSource {
	title: string;
	url: string;
	snippet: string;
	markdown: string;
}

interface SearchWebOptions {
	onProgress?: (content: string) => Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isSearxngResult = (value: unknown): value is SearxngResult => {
	if (!isRecord(value)) return false;

	return (
		typeof value.title === "string" &&
		typeof value.url === "string" &&
		typeof value.content === "string"
	);
};

const parseSearxngResponse = (value: unknown): SearxngResponse => {
	if (!isRecord(value) || !Array.isArray(value.results)) {
		throw new Error("SearXNGのレスポンス形式が不正です。");
	}

	return {
		results: value.results.filter(isSearxngResult),
	};
};

const parseCrawl4AiResult = (value: unknown): Crawl4AiExtractionResult => {
	if (!isRecord(value)) {
		throw new Error("Crawl4AIのレスポンス形式が不正です。");
	}

	if (value.status === "empty" || value.status === "error") {
		if (typeof value.url !== "string" || typeof value.error !== "string") {
			throw new Error("Crawl4AIのレスポンス形式が不正です。");
		}

		return {
			status: value.status,
			url: value.url,
			error: value.error,
		};
	}

	if (value.status !== "ok") {
		throw new Error("Crawl4AIのレスポンス形式が不正です。");
	}

	if (typeof value.url !== "string" || typeof value.markdown !== "string") {
		throw new Error("Crawl4AIのレスポンス形式が不正です。");
	}

	return {
		status: value.status,
		url: value.url,
		title: typeof value.title === "string" ? value.title : "",
		markdown: value.markdown,
	};
};

const getRequiredWebSearchConfig = () => {
	const envConfig = getEnvConfig();

	if (!envConfig.SEARXNG_BASE_URL) {
		throw new Error("SEARXNG_BASE_URLが設定されていません。");
	}

	return {
		searxngBaseUrl: envConfig.SEARXNG_BASE_URL,
		crawl4AiUvCommand: envConfig.CRAWL4AI_UV_COMMAND,
		crawl4AiUvProjectDir: envConfig.CRAWL4AI_UV_PROJECT_DIR,
		maxResults: envConfig.WEB_SEARCH_MAX_RESULTS,
		maxCandidates: envConfig.WEB_SEARCH_MAX_CANDIDATES,
		maxMarkdownLength: envConfig.WEB_SEARCH_MAX_MARKDOWN_LENGTH,
		concurrency: envConfig.WEB_SEARCH_CONCURRENCY,
	};
};

const searchSearxngPage = async (
	query: string,
	searxngBaseUrl: string,
	pageNumber: number,
): Promise<SearxngResult[]> => {
	const searchUrl = new URL("/search", searxngBaseUrl);
	searchUrl.searchParams.set("q", query);
	searchUrl.searchParams.set("format", "json");
	searchUrl.searchParams.set("pageno", pageNumber.toString());

	const response = await fetch(searchUrl, {
		headers: {
			Accept: "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(`SearXNG検索に失敗しました。status=${response.status}`);
	}

	const parsed = parseSearxngResponse(await response.json());
	return parsed.results;
};

const searchSearxng = async (
	query: string,
	searxngBaseUrl: string,
	maxCandidateResults: number,
): Promise<SearxngResult[]> => {
	const uniqueResults: SearxngResult[] = [];
	const seenUrls = new Set<string>();
	let pageNumber = 1;

	while (uniqueResults.length < maxCandidateResults) {
		const pageResults = await searchSearxngPage(
			query,
			searxngBaseUrl,
			pageNumber,
		);

		if (pageResults.length === 0) {
			break;
		}

		const beforeCount = uniqueResults.length;
		for (const result of pageResults) {
			if (seenUrls.has(result.url)) continue;

			seenUrls.add(result.url);
			uniqueResults.push(result);

			if (uniqueResults.length >= maxCandidateResults) {
				break;
			}
		}

		if (uniqueResults.length === beforeCount) {
			break;
		}

		pageNumber++;
	}

	if (uniqueResults.length === 0) {
		throw new Error("SearXNGの検索結果が0件でした。");
	}

	return uniqueResults;
};

const extractMarkdownWithCrawl4Ai = async (
	url: string,
	uvCommand: string,
	uvProjectDir: string,
): Promise<Crawl4AiExtractionResult> => {
	const { stdout } = await execFileAsync(
		uvCommand,
		["run", "python", "-m", CRAWL4AI_MODULE_NAME, url],
		{
			cwd: uvProjectDir,
			maxBuffer: 1024 * 1024 * 8,
			timeout: 60000,
		},
	);
	const outputLines = stdout.trim().split("\n");
	let jsonLine: string | undefined;

	for (let index = outputLines.length - 1; index >= 0; index--) {
		const line = outputLines[index].trim();
		if (line.startsWith("{")) {
			jsonLine = line;
			break;
		}
	}

	if (!jsonLine) {
		throw new Error("Crawl4AIのJSON出力が見つかりませんでした。");
	}

	return parseCrawl4AiResult(JSON.parse(jsonLine));
};

const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) {
		return text;
	}

	return text.slice(0, maxLength);
};

const formatProgressTarget = (result: SearxngResult): string =>
	`${result.title}\n<${result.url}>`;

const extractSearchResult = async (
	result: SearxngResult,
	index: number,
	total: number,
	config: ReturnType<typeof getRequiredWebSearchConfig>,
	options: SearchWebOptions,
): Promise<WebSearchSource | null> => {
	await options.onProgress?.(
		`Crawl4AIで本文を抽出しています (${index + 1}/${total}): ${formatProgressTarget(result)}`,
	);

	const extracted = await extractMarkdownWithCrawl4Ai(
		result.url,
		config.crawl4AiUvCommand,
		config.crawl4AiUvProjectDir,
	);

	if (extracted.status !== "ok") {
		await options.onProgress?.(
			`本文を抽出できなかったため除外します (${index + 1}/${total}): ${formatProgressTarget(result)}`,
		);
		return null;
	}

	await options.onProgress?.(
		`本文を抽出しました (${index + 1}/${total}): ${formatProgressTarget(result)}`,
	);

	return {
		title: extracted.title || result.title,
		url: result.url,
		snippet: result.content,
		markdown: truncateText(extracted.markdown, config.maxMarkdownLength),
	};
};

const extractSourcesConcurrently = async (
	searchResults: SearxngResult[],
	config: ReturnType<typeof getRequiredWebSearchConfig>,
	options: SearchWebOptions,
): Promise<WebSearchSource[]> => {
	const sources: Array<{ index: number; source: WebSearchSource }> = [];
	let nextIndex = 0;

	const worker = async (): Promise<void> => {
		while (sources.length < config.maxResults) {
			const currentIndex = nextIndex;
			nextIndex++;

			const result = searchResults[currentIndex];
			if (!result) {
				return;
			}

			try {
				const source = await extractSearchResult(
					result,
					currentIndex,
					searchResults.length,
					config,
					options,
				);
				if (source && sources.length < config.maxResults) {
					sources.push({ index: currentIndex, source });
				}
			} catch {
				await options.onProgress?.(
					`本文抽出でエラーになったため除外します (${currentIndex + 1}/${searchResults.length}): ${formatProgressTarget(result)}`,
				);
			}
		}
	};

	await Promise.all(
		Array.from(
			{ length: Math.min(config.concurrency, searchResults.length) },
			() => worker(),
		),
	);

	return sources
		.sort((left, right) => left.index - right.index)
		.map((source) => source.source);
};

export const searchWeb = async (
	query: string,
	options: SearchWebOptions = {},
): Promise<WebSearchSource[]> => {
	const config = getRequiredWebSearchConfig();
	await options.onProgress?.(`SearXNGで検索しています: ${query}`);
	const searchResults = await searchSearxng(
		query,
		config.searxngBaseUrl,
		config.maxCandidates,
	);
	await options.onProgress?.(
		`SearXNGで${searchResults.length}件の候補を見つけました。最大${config.maxResults}件の本文を並列${config.concurrency}で抽出します。`,
	);
	const sources = await extractSourcesConcurrently(
		searchResults,
		config,
		options,
	);

	if (sources.length === 0) {
		throw new Error(
			"Crawl4AIで本文を抽出できる検索結果が見つかりませんでした。",
		);
	}

	return sources;
};
