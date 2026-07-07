import {
	type ChatContextMessage,
	chatContextRepository,
} from "../db/chatContextRepository";
import { logError } from "./logger";
import { generateAiTextWithUsage, getLightAiModel } from "./useAI";
import { searchWeb, type WebSearchSource } from "./webSearchAdapter";

const DEFAULT_CHAT_SYSTEM_PROMPT =
	"あなたは親切で有用なAIアシスタントです。以下のユーザーのメッセージに丁寧に回答してください。否定だけの返答はしないでください。応答は、特に指示のない限り、日本語で行ってください。";

const CHAT_PROGRESS_MESSAGE = "回答方針を確認しています。";
const ANSWER_PROGRESS_MESSAGE = "回答を生成しています。";

interface GenerateChatResponseOptions {
	contextScopeId?: string;
	systemPrompt?: string;
	onProgress?: (content: string) => Promise<void>;
}

interface WebSearchDecision {
	needsSearch: boolean;
	query: string;
	maxCandidates: number;
	maxResults: number;
	concurrency: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseWebSearchDecision = (text: string): WebSearchDecision => {
	const parsed: unknown = JSON.parse(text);

	if (!isRecord(parsed)) {
		throw new Error("Web検索判定のレスポンス形式が不正です。");
	}

	if (
		typeof parsed.needsSearch !== "boolean" ||
		typeof parsed.query !== "string" ||
		typeof parsed.maxCandidates !== "number" ||
		typeof parsed.maxResults !== "number" ||
		typeof parsed.concurrency !== "number"
	) {
		throw new Error("Web検索判定のレスポンス形式が不正です。");
	}

	return {
		needsSearch: parsed.needsSearch,
		query: parsed.query,
		maxCandidates: parsed.maxCandidates,
		maxResults: parsed.maxResults,
		concurrency: parsed.concurrency,
	};
};

const decideWebSearch = async (message: string): Promise<WebSearchDecision> => {
	const prompt = `ユーザーのメッセージに回答する前にWeb検索が必要か判定してください。

検索が必要な条件:
- 最新情報、現在の状態、ニュース、価格、仕様、法律、API、ライブラリ、人物、会社、予定など、変化する可能性がある情報を含む場合
- URL、出典、正確な根拠が必要な場合
- 手元の知識だけでは事実確認できない場合

検索が不要な条件:
- 一般的な説明、文章作成、翻訳、計算、創作、相談など、外部情報が不要な場合

JSONのみで返してください。
{
  "needsSearch": true,
  "query": "検索語",
  "maxCandidates": 5,
  "maxResults": 2,
  "concurrency": 2
}

検索量の基準:
- 発売日、価格、公式ページ確認など答えが1つの軽い確認: maxCandidates=5, maxResults=2, concurrency=2
- 仕様、人物、会社、用語など複数根拠が必要な通常調査: maxCandidates=12, maxResults=4, concurrency=3
- 複数観点の比較、炎上、ニュース経緯、網羅的調査: maxCandidates=25, maxResults=6, concurrency=4
- ユーザーが「詳しく」「徹底的に」「全部」など広い調査を求めた場合だけ: maxCandidates=50, maxResults=10, concurrency=5

検索しない場合はqueryを空文字、maxCandidates=0、maxResults=0、concurrency=0にしてください。

ユーザーのメッセージ:
${message}`;

	const result = await generateAiTextWithUsage(prompt, {
		model: getLightAiModel(),
		responseMimeType: "application/json",
		reasoningEffort: "none",
		temperature: 0,
	});

	return parseWebSearchDecision(result.text);
};

const formatSourcesForPrompt = (sources: WebSearchSource[]): string =>
	sources
		.map(
			(source, index) => `# Source ${index + 1}
Title: ${source.title}
URL: ${source.url}
Snippet: ${source.snippet}
Body:
${source.markdown}`,
		)
		.join("\n\n");

const formatContextForPrompt = (messages: ChatContextMessage[]): string => {
	if (messages.length === 0) {
		return "";
	}

	return messages
		.map((message) => {
			const roleLabel = message.role === "user" ? "ユーザー" : "runa";
			return `${roleLabel}: ${message.content}`;
		})
		.join("\n");
};

const buildWebGroundedPrompt = (
	message: string,
	systemPrompt: string,
	sources: WebSearchSource[],
	contextMessages: ChatContextMessage[],
): string => {
	const context = formatContextForPrompt(contextMessages);

	return `${systemPrompt}

以下の検索結果のURLと本文に基づいて回答してください。
検索結果に書かれていないことは推測しないでください。
回答には根拠にしたURLを含めてください。URLは必ず<https://example.com/>の形式で囲ってください。
${context ? `\n直近の会話履歴:\n${context}\n` : ""}

${formatSourcesForPrompt(sources)}

ユーザーのメッセージ: ${message}
回答:`;
};

const buildStandardPrompt = (
	message: string,
	systemPrompt: string,
	contextMessages: ChatContextMessage[],
): string => {
	const context = formatContextForPrompt(contextMessages);

	return `${systemPrompt}
${context ? `\n直近の会話履歴:\n${context}\n` : ""}

ユーザーのメッセージ: ${message}
回答:`;
};

export async function generateChatResponse(
	message: string,
	options: GenerateChatResponseOptions = {},
): Promise<string> {
	try {
		await options.onProgress?.(CHAT_PROGRESS_MESSAGE);
		const systemPrompt = options.systemPrompt ?? DEFAULT_CHAT_SYSTEM_PROMPT;
		const contextMessages = options.contextScopeId
			? chatContextRepository.list(options.contextScopeId)
			: [];
		const searchDecision = await decideWebSearch(message);
		let prompt = buildStandardPrompt(message, systemPrompt, contextMessages);

		if (searchDecision.needsSearch) {
			const sources = await searchWeb(searchDecision.query, {
				concurrency: searchDecision.concurrency,
				maxCandidates: searchDecision.maxCandidates,
				maxResults: searchDecision.maxResults,
				onProgress: options.onProgress,
			});
			prompt = buildWebGroundedPrompt(
				message,
				systemPrompt,
				sources,
				contextMessages,
			);
		}

		await options.onProgress?.(ANSWER_PROGRESS_MESSAGE);
		const response = await generateAiTextWithUsage(prompt, {
			model: getLightAiModel(),
		}).then((result) => result.text);

		if (options.contextScopeId) {
			chatContextRepository.add(options.contextScopeId, "user", message);
			chatContextRepository.add(options.contextScopeId, "assistant", response);
		}

		return `
> ${message}

${response}`;
	} catch (error) {
		logError(`Error generating chat response: ${error}`);
		throw error;
	}
}
