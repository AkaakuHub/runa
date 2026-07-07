import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { getEnvConfig } from "../config/env";
import { logError, logInfo } from "./logger";

type ReasoningEffort = "none" | "default" | "low" | "medium" | "high";

const OVERLOADED_RETRY_DELAYS_MS = [60000, 90000, 120000, 180000];

interface AiConfig {
	apiKey?: string;
	defaultModel?: string;
	lightModel?: string;
	fallbackModels?: string[];
	maxRetries?: number;
	baseDelay?: number;
}

interface GenerateTextOptions {
	maxCompletionTokens?: number;
	reasoningEffort?: ReasoningEffort;
	temperature?: number;
	responseMimeType?: string;
	responseJsonSchema?: unknown;
	maxRetries?: number;
	model?: string;
}

interface AiUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	thoughts_tokens?: number;
	total_tokens?: number;
}

class AiClient {
	private client: GoogleGenAI;
	private config: Required<AiConfig>;

	constructor(config: AiConfig = {}) {
		const envConfig = getEnvConfig();
		const apiKey = config.apiKey || envConfig.GOOGLE_API_KEY;
		if (!apiKey) {
			throw new Error(
				"Google AI API key not found. Please set GOOGLE_API_KEY environment variable.",
			);
		}

		this.client = new GoogleGenAI({ apiKey });
		this.config = {
			apiKey,
			defaultModel:
				config.defaultModel ||
				envConfig.GOOGLE_AI_DEFAULT_MODEL ||
				"gemini-3-flash-preview",
			lightModel:
				config.lightModel ||
				envConfig.GOOGLE_AI_LIGHT_MODEL ||
				"gemini-3-flash-preview",
			fallbackModels:
				config.fallbackModels && config.fallbackModels.length > 0
					? config.fallbackModels
					: envConfig.GOOGLE_AI_FALLBACK_MODELS,
			maxRetries: config.maxRetries || 5,
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

	private isRetryableError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}

		const message = error.message || "";
		const isOverloaded =
			message.includes("503") || message.toLowerCase().includes("overloaded");
		const isRateLimited =
			message.includes("429") || message.toLowerCase().includes("quota");

		return isOverloaded || isRateLimited;
	}

	private async waitBeforeRetry(
		error: unknown,
		attempt: number,
		maxRetries: number,
	): Promise<boolean> {
		if (!this.isRetryableError(error)) {
			return false;
		}
		if (attempt >= maxRetries) {
			return false;
		}

		const message = error instanceof Error ? error.message : "";
		let waitTime = 0;
		if (message.includes("429") || message.toLowerCase().includes("quota")) {
			const parsed = this.parseRetryAfterMs(message);
			waitTime = parsed ? parsed + 3000 : 60000;
		} else {
			waitTime =
				OVERLOADED_RETRY_DELAYS_MS[attempt - 1] ??
				OVERLOADED_RETRY_DELAYS_MS[OVERLOADED_RETRY_DELAYS_MS.length - 1];
		}

		logInfo(`Waiting ${waitTime}ms before retry...`);
		await new Promise((resolve) => setTimeout(resolve, waitTime));
		return true;
	}

	private getModelCandidates(requestedModel: string): string[] {
		const candidates = [
			requestedModel,
			this.config.lightModel,
			this.config.defaultModel,
			...this.config.fallbackModels,
		];
		const uniqueCandidates: string[] = [];

		for (const model of candidates) {
			if (!model || uniqueCandidates.includes(model)) continue;
			uniqueCandidates.push(model);
		}

		return uniqueCandidates;
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
				responseMimeType: options?.responseMimeType,
				responseJsonSchema: options?.responseJsonSchema,
				thinkingConfig:
					options?.reasoningEffort === "none"
						? {
								thinkingBudget: 0,
							}
						: thinkingLevel
							? {
									thinkingLevel,
								}
							: undefined,
			},
		});
	}

	async estimateTextTokens(text: string): Promise<number> {
		const response = await this.client.models.countTokens({
			model: this.config.defaultModel,
			contents: text,
		});

		if (typeof response.totalTokens !== "number") {
			throw new Error(
				`Gemini token count unavailable for ${this.config.defaultModel}`,
			);
		}

		return response.totalTokens;
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

		const maxRetries = options?.maxRetries ?? this.config.maxRetries;
		const requestedModel = options?.model ?? this.config.defaultModel;
		const modelCandidates = this.getModelCandidates(requestedModel);

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			for (const model of modelCandidates) {
				try {
					const response = await this.generateContent(prompt, model, options);
					const usage = response.usageMetadata
						? {
								prompt_tokens: response.usageMetadata.promptTokenCount,
								completion_tokens: response.usageMetadata.candidatesTokenCount,
								thoughts_tokens: response.usageMetadata.thoughtsTokenCount,
								total_tokens: response.usageMetadata.totalTokenCount,
							}
						: undefined;
					const finishReason = this.toFinishReason(
						response.candidates?.[0]?.finishReason,
					);
					const text = response.text ?? "";

					if (usage) {
						logInfo(
							`Gemini usage (${model}) - prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, thoughts: ${usage.thoughts_tokens ?? 0}, total: ${usage.total_tokens}`,
						);
					}
					if (!text.trim()) {
						logInfo(
							`Gemini returned empty visible text (model: ${model}, finish_reason: ${finishReason})`,
						);
					}

					return { text, finishReason, usage };
				} catch (error: unknown) {
					lastError = error;
					logError(`Attempt ${attempt} with ${model} failed: ${error}`);

					if (!this.isRetryableError(error)) {
						throw error;
					}
				}
			}

			const waited = await this.waitBeforeRetry(lastError, attempt, maxRetries);
			if (!waited) {
				break;
			}
		}

		throw lastError;
	}

	/**
	 * チャット用のプロンプトを生成して実行
	 */
	getLightModel(): string {
		return this.config.lightModel;
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

export const estimateAiTextTokens = (text: string) =>
	sharedAiClient.estimateTextTokens(text);

export const getLightAiModel = () => sharedAiClient.getLightModel();
