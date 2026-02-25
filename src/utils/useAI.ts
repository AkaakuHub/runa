import { logError, logInfo } from "./logger";
import { getEnvConfig } from "../config/env";
import Groq from "groq-sdk";

interface AiConfig {
	apiKey?: string;
	defaultModel?: string;
	fallbackModel?: string;
	maxRetries?: number;
	baseDelay?: number;
}

class AiClient {
	private client;
	private config;

	constructor(config: AiConfig = {}) {
		const apiKey = config.apiKey || getEnvConfig().GROQ_API_KEY;
		if (!apiKey) {
			throw new Error(
				"Groq API key not found. Please set GROQ_API_KEY environment variable.",
			);
		}

		this.client = new Groq({ apiKey });
		this.config = {
			apiKey,
			maxRetries: config.maxRetries || 3,
			baseDelay: config.baseDelay || 1000,
		};
	}

	private parseRetryAfterMs(errorMessage?: string): number | null {
		if (!errorMessage) return null;

		const match = errorMessage.match(
			/Please try again in\s+((\d+)m)?([\d.]+)s/i,
		);
		if (!match) return null;

		const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
		const seconds = Number.parseFloat(match[3]);
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
			message.includes("503") || message.includes("overloaded");
		const isRateLimited =
			message.includes("429") || message.includes("rate_limit_exceeded");

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

	async getGroqChatCompletion(
		content: string,
		options?: {
			maxCompletionTokens?: number;
			reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
		},
	) {
		return this.client.chat.completions.create({
			messages: [
				{
					role: "user",
					content: content,
				},
			],
			model: "openai/gpt-oss-20b",
			max_completion_tokens: options?.maxCompletionTokens,
			reasoning_effort: options?.reasoningEffort,
			response_format: { type: "text" },
		});
	}

	private extractTextFromCompletionMessage(
		message:
			| { content?: string | Array<{ type?: string; text?: string }> | null }
			| undefined,
	): string {
		if (typeof message?.content === "string") {
			return message.content;
		}

		if (Array.isArray(message?.content)) {
			return message.content
				.map((part) => (part?.type === "text" ? (part.text ?? "") : ""))
				.join("");
		}

		return "";
	}

	/**
	 * 指定されたモデルでテキスト生成を行う
	 * リトライ機能とフォールバックモデル対応付き
	 */
	async generateText(prompt: string): Promise<string> {
		const generateWithRetry = async (
			promptText: string,
			maxRetries: number,
		): Promise<string> => {
			let lastError: unknown;

			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					const chatCompletion = await this.getGroqChatCompletion(promptText);
					const message = chatCompletion.choices[0]?.message as
						| {
								content?:
									| string
									| Array<{ type?: string; text?: string }>
									| null;
						  }
						| undefined;
					return this.extractTextFromCompletionMessage(message);
				} catch (error: unknown) {
					lastError = error;
					logError(`Attempt ${attempt} failed: ${error}`);

					const waited = await this.waitBeforeRetry(error, attempt, maxRetries);
					if (!waited) {
						break;
					}
				}
			}

			throw lastError;
		};
		// まず指定されたモデルで試行
		return await generateWithRetry(prompt, this.config.maxRetries);
	}

	/**
	 * テキスト生成結果とusageを返す
	 */
	async generateTextWithUsage(
		prompt: string,
		options?: {
			maxCompletionTokens?: number;
			reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
		},
	): Promise<{
		text: string;
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			total_tokens?: number;
		};
	}> {
		const generateWithRetry = async (
			promptText: string,
			maxRetries: number,
		): Promise<{
			text: string;
			usage?: {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
			};
		}> => {
			let lastError: unknown;

			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					const chatCompletion = await this.getGroqChatCompletion(
						promptText,
						options,
					);
					const message = chatCompletion.choices[0]?.message as
						| {
								content?:
									| string
									| Array<{ type?: string; text?: string }>
									| null;
						  }
						| undefined;
					const text = this.extractTextFromCompletionMessage(message);
					const usage = chatCompletion.usage
						? {
								prompt_tokens: chatCompletion.usage.prompt_tokens,
								completion_tokens: chatCompletion.usage.completion_tokens,
								total_tokens: chatCompletion.usage.total_tokens,
							}
						: undefined;

					if (usage) {
						logInfo(
							`Groq usage - prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, total: ${usage.total_tokens}`,
						);
					}
					if (!text.trim()) {
						const finishReason = chatCompletion.choices[0]?.finish_reason;
						logInfo(
							`Groq returned empty visible text (finish_reason: ${finishReason})`,
						);
					}

					return { text, usage };
				} catch (error: unknown) {
					lastError = error;
					logError(`Attempt ${attempt} failed: ${error}`);

					const waited = await this.waitBeforeRetry(error, attempt, maxRetries);
					if (!waited) {
						break;
					}
				}
			}

			throw lastError;
		};

		return generateWithRetry(prompt, this.config.maxRetries);
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
	options?: {
		maxCompletionTokens?: number;
		reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
	},
) => sharedAiClient.generateTextWithUsage(prompt, options);

/** シンプルなチャット用API（モデル名は隠蔽） */
export const chatWithAssistant = (message: string, systemPrompt?: string) =>
	sharedAiClient.chat(message, systemPrompt);

// import { GoogleGenerativeAI } from "@google/generative-ai";
// import { logError, logInfo } from "./logger";
// import { getEnvConfig } from "../config/env";

// interface AiConfig {
// 	apiKey?: string;
// 	defaultModel?: string;
// 	fallbackModel?: string;
// 	maxRetries?: number;
// 	baseDelay?: number;
// }

// class AiClient {
// 	private client: GoogleGenerativeAI;
// 	private config: Required<AiConfig>;

// 	constructor(config: AiConfig = {}) {
// 		const apiKey = config.apiKey || getEnvConfig().GOOGLE_API_KEY;
// 		if (!apiKey) {
// 			throw new Error(
// 				"Google API key not found. Please set GOOGLE_API_KEY environment variable.",
// 			);
// 		}

// 		this.client = new GoogleGenerativeAI(apiKey);
// 		this.config = {
// 			apiKey,
// 			defaultModel: config.defaultModel || "gemini-2.0-flash",
// 			fallbackModel: config.fallbackModel || "gemini-1.5-flash",
// 			maxRetries: config.maxRetries || 3,
// 			baseDelay: config.baseDelay || 1000,
// 		};
// 	}

// 	/**
// 	 * 指定されたモデルでテキスト生成を行う
// 	 * リトライ機能とフォールバックモデル対応付き
// 	 */
// 	async generateText(prompt: string, model?: string): Promise<string> {
// 		const targetModel = model || this.config.defaultModel;

// 		const generateWithRetry = async (
// 			promptText: string,
// 			modelToUse: string,
// 			maxRetries: number,
// 		): Promise<string> => {
// 			let lastError: unknown;

// 			for (let attempt = 1; attempt <= maxRetries; attempt++) {
// 				try {
// 					const genModel = this.client.getGenerativeModel({
// 						model: modelToUse,
// 					});
// 					const result = await genModel.generateContent(promptText);
// 					return result.response.text();
// 				} catch (error: unknown) {
// 					lastError = error;
// 					logError(`Attempt ${attempt} with ${modelToUse} failed: ${error}`);

// 					// 503エラー（overloaded）の場合は指数バックオフで待機
// 					if (
// 						error instanceof Error &&
// 						(error.message?.includes("503") ||
// 							error.message?.includes("overloaded"))
// 					) {
// 						if (attempt < maxRetries) {
// 							const waitTime = Math.min(
// 								this.config.baseDelay * 2 ** (attempt - 1),
// 								8000, // max 8s
// 							);
// 							logInfo(`Waiting ${waitTime}ms before retry...`);
// 							await new Promise((resolve) => setTimeout(resolve, waitTime));
// 						}
// 					} else {
// 						// 503以外のエラーは即座にフォールバックへ
// 						break;
// 					}
// 				}
// 			}

// 			throw lastError;
// 		};

// 		try {
// 			// まず指定されたモデルで試行
// 			return await generateWithRetry(
// 				prompt,
// 				targetModel,
// 				this.config.maxRetries,
// 			);
// 		} catch (primaryError) {
// 			// フォールバックモデルが指定されたモデルと異なる場合のみ試行
// 			if (targetModel !== this.config.fallbackModel) {
// 				try {
// 					logInfo(`Falling back to ${this.config.fallbackModel} model`);
// 					return await generateWithRetry(
// 						prompt,
// 						this.config.fallbackModel,
// 						this.config.maxRetries,
// 					);
// 				} catch (fallbackError) {
// 					logError(
// 						`Fallback model ${this.config.fallbackModel} also failed: ${fallbackError}`,
// 					);
// 				}
// 			}

// 			throw primaryError;
// 		}
// 	}

// 	/**
// 	 * チャット用のプロンプトを生成して実行
// 	 */
// 	async chat(message: string, systemPrompt?: string): Promise<string> {
// 		const fullPrompt = systemPrompt
// 			? `${systemPrompt}\n\nユーザーのメッセージ: ${message}\n回答:`
// 			: `あなたは親切で有用なAIアシスタントです。以下のユーザーのメッセージに丁寧に回答してください。\n\nユーザーのメッセージ: ${message}\n回答:`;

// 		return this.generateText(fullPrompt);
// 	}

// 	/**
// 	 * 現在の設定情報を取得
// 	 */
// 	getConfig(): Readonly<Required<AiConfig>> {
// 		return { ...this.config };
// 	}
// }

// // シングルトンで共有し、呼び出し側には関数APIだけを公開する
// const sharedAiClient = new AiClient();

// /** 任意のプロンプトで汎用テキスト生成 */
// export const generateAiText = (prompt: string, model?: string) =>
// 	sharedAiClient.generateText(prompt, model);

// /** シンプルなチャット用API（モデル名は隠蔽） */
// export const chatWithAssistant = (message: string, systemPrompt?: string) =>
// 	sharedAiClient.chat(message, systemPrompt);
