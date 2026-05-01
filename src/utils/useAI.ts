import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { getEnvConfig } from "../config/env";
import { logError, logInfo } from "./logger";

type ReasoningEffort = "none" | "default" | "low" | "medium" | "high";

interface AiConfig {
	apiKey?: string;
	defaultModel?: string;
	maxRetries?: number;
	baseDelay?: number;
}

interface GenerateTextOptions {
	maxCompletionTokens?: number;
	reasoningEffort?: ReasoningEffort;
	temperature?: number;
}

interface AiUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
}

class AiClient {
	private client: GoogleGenAI;
	private config: Required<AiConfig>;

	constructor(config: AiConfig = {}) {
		const apiKey = config.apiKey || getEnvConfig().GOOGLE_API_KEY;
		if (!apiKey) {
			throw new Error(
				"Google AI API key not found. Please set GOOGLE_API_KEY environment variable.",
			);
		}

		this.client = new GoogleGenAI({ apiKey });
		this.config = {
			apiKey,
			defaultModel: config.defaultModel || "gemini-3-flash-preview",
			maxRetries: config.maxRetries || 3,
			baseDelay: config.baseDelay || 1000,
		};
	}

	private parseRetryAfterMs(errorMessage?: string): number | null {
		if (!errorMessage) return null;

		const retryInfoMatch = errorMessage.match(
			/retryDelay["']?\s*:\s*["']?(\d+)s/i,
		);
		if (retryInfoMatch) {
			return Number.parseInt(retryInfoMatch[1], 10) * 1000;
		}

		const retryAfterMatch = errorMessage.match(
			/Please try again in\s+((\d+)m)?([\d.]+)s/i,
		);
		if (!retryAfterMatch) return null;

		const minutes = retryAfterMatch[2]
			? Number.parseInt(retryAfterMatch[2], 10)
			: 0;
		const seconds = Number.parseFloat(retryAfterMatch[3]);
		if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;

		return Math.ceil((minutes * 60 + seconds) * 1000);
	}

	private async waitBeforeRetry(
		error: unknown,
		attempt: number,
		maxRetries: number,
	): Promise<boolean> {
		if (!(error instanceof Error)) {
			return false;
		}

		const message = error.message || "";
		const isOverloaded =
			message.includes("503") || message.toLowerCase().includes("overloaded");
		const isRateLimited =
			message.includes("429") || message.toLowerCase().includes("quota");

		if (!isOverloaded && !isRateLimited) {
			return false;
		}

		if (attempt >= maxRetries) {
			return false;
		}

		let waitTime = 0;
		if (isRateLimited) {
			const parsed = this.parseRetryAfterMs(message);
			waitTime = parsed ? parsed + 3000 : 60000;
		} else {
			waitTime = Math.min(this.config.baseDelay * 2 ** (attempt - 1), 8000);
		}

		logInfo(`Waiting ${waitTime}ms before retry...`);
		await new Promise((resolve) => setTimeout(resolve, waitTime));
		return true;
	}

	private toThinkingLevel(
		reasoningEffort?: ReasoningEffort,
	): ThinkingLevel | undefined {
		switch (reasoningEffort) {
			case "none":
				return ThinkingLevel.MINIMAL;
			case "low":
				return ThinkingLevel.LOW;
			case "medium":
				return ThinkingLevel.MEDIUM;
			case "high":
				return ThinkingLevel.HIGH;
			default:
				return undefined;
		}
	}

	private toFinishReason(reason?: string): string | null {
		if (!reason) return null;
		return reason === "MAX_TOKENS" ? "length" : reason.toLowerCase();
	}

	private async generateContent(
		prompt: string,
		model: string,
		options?: GenerateTextOptions,
	) {
		const thinkingLevel = this.toThinkingLevel(options?.reasoningEffort);

		return this.client.models.generateContent({
			model,
			contents: prompt,
			config: {
				maxOutputTokens: options?.maxCompletionTokens,
				temperature: options?.temperature,
				thinkingConfig: thinkingLevel
					? {
							thinkingLevel,
						}
					: undefined,
			},
		});
	}

	/**
	 * 指定されたモデルでテキスト生成を行う
	 * リトライ機能付き
	 */
	async generateText(prompt: string): Promise<string> {
		const result = await this.generateTextWithUsage(prompt);
		return result.text;
	}

	/**
	 * テキスト生成結果とusageを返す
	 */
	async generateTextWithUsage(
		prompt: string,
		options?: GenerateTextOptions,
	): Promise<{
		text: string;
		finishReason?: string | null;
		usage?: AiUsage;
	}> {
		let lastError: unknown;

		for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
			try {
				const response = await this.generateContent(
					prompt,
					this.config.defaultModel,
					options,
				);
				const usage = response.usageMetadata
					? {
							prompt_tokens: response.usageMetadata.promptTokenCount,
							completion_tokens: response.usageMetadata.candidatesTokenCount,
							total_tokens: response.usageMetadata.totalTokenCount,
						}
					: undefined;
				const finishReason = this.toFinishReason(
					response.candidates?.[0]?.finishReason,
				);
				const text = response.text ?? "";

				if (usage) {
					logInfo(
						`Gemini usage (${this.config.defaultModel}) - prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, total: ${usage.total_tokens}`,
					);
				}
				if (!text.trim()) {
					logInfo(
						`Gemini returned empty visible text (model: ${this.config.defaultModel}, finish_reason: ${finishReason})`,
					);
				}

				return { text, finishReason, usage };
			} catch (error: unknown) {
				lastError = error;
				logError(
					`Attempt ${attempt} with ${this.config.defaultModel} failed: ${error}`,
				);

				const waited = await this.waitBeforeRetry(
					error,
					attempt,
					this.config.maxRetries,
				);
				if (!waited) {
					break;
				}
			}
		}

		throw lastError;
	}

	/**
	 * チャット用のプロンプトを生成して実行
	 */
	async chat(message: string, systemPrompt?: string): Promise<string> {
		const fullPrompt = systemPrompt
			? `${systemPrompt}\n\nユーザーのメッセージ: ${message}\n回答:`
			: `あなたは親切で有用なAIアシスタントです。以下のユーザーのメッセージに丁寧に回答してください。\n\nユーザーのメッセージ: ${message}\n回答:`;

		return this.generateText(fullPrompt);
	}

	/**
	 * 現在の設定情報を取得
	 */
	getConfig(): Readonly<Required<AiConfig>> {
		return { ...this.config };
	}
}

// シングルトンで共有し、呼び出し側には関数APIだけを公開する
const sharedAiClient = new AiClient();

/** 任意のプロンプトで汎用テキスト生成 */
export const generateAiText = (prompt: string) =>
	sharedAiClient.generateText(prompt);

export const generateAiTextWithUsage = (
	prompt: string,
	options?: GenerateTextOptions,
) => sharedAiClient.generateTextWithUsage(prompt, options);

/** シンプルなチャット用API（モデル名は隠蔽） */
export const chatWithAssistant = (message: string, systemPrompt?: string) =>
	sharedAiClient.chat(message, systemPrompt);
