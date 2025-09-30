import type { ChatInputCommandInteraction } from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CommandDefinition } from "../../types";
import { logError, logInfo } from "../../utils/logger";
import { editAndFollowUpLongMessage } from "../../utils/messageUtils";

export const ChatCommand: CommandDefinition = {
	name: "chat",
	description: "Gemini 2.0 Flashとチャットします",
	options: [
		{
			name: "message",
			description: "Geminiに送信するメッセージ",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		try {
			await interaction.deferReply({
				ephemeral: false,
			});

			const message = interaction.options.getString("message", true);

			const response = await performChat(interaction, message);

			// 少し遅延を入れて進捗表示が確実に更新されるようにする
			await new Promise((resolve) => setTimeout(resolve, 500));
			await editAndFollowUpLongMessage(interaction, response);
		} catch (error) {
			logError(`Error executing chat command: ${error}`);
			try {
				await interaction.editReply({
					content: "チャット中にエラーが発生しました。",
				});
			} catch (replyError) {
				logError(`Failed to send error message: ${replyError}`);
			}
		}
	},
};

async function performChat(
	interaction: ChatInputCommandInteraction,
	message: string,
): Promise<string> {
	try {
		// Google API キーを確認
		const googleApiKey = process.env.GOOGLE_API_KEY;
		if (!googleApiKey) {
			throw new Error("Google API key not found");
		}

		const genAI = new GoogleGenerativeAI(googleApiKey);

		// リトライ機能付きでモデル取得・実行
		const generateWithRetry = async (
			prompt: string,
			maxRetries = 3,
			fallbackModel = "gemini-1.5-flash",
		): Promise<string> => {
			let lastError: unknown;

			// まず優先モデルで試行
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
					const result = await model.generateContent(prompt);
					return result.response.text();
				} catch (error: unknown) {
					lastError = error;
					logError(`Attempt ${attempt} with gemini-2.0-flash failed: ${error}`);

					// 503エラー（overloaded）の場合は指数バックオフで待機
					if (
						error instanceof Error &&
						(error.message?.includes("503") ||
							error.message?.includes("overloaded"))
					) {
						if (attempt < maxRetries) {
							const waitTime = Math.min(1000 * 2 ** (attempt - 1), 8000); // 1s, 2s, 4s, max 8s
							logInfo(`Waiting ${waitTime}ms before retry...`);
							await new Promise((resolve) => setTimeout(resolve, waitTime));
						}
					} else {
						// 503以外のエラーは即座にフォールバックへ
						break;
					}
				}
			}

			// フォールバックモデルで試行
			try {
				logInfo(`Falling back to ${fallbackModel} model`);
				const fallbackModelInstance = genAI.getGenerativeModel({
					model: fallbackModel,
				});
				const result = await fallbackModelInstance.generateContent(prompt);
				return result.response.text();
			} catch (fallbackError) {
				logError(
					`Fallback model ${fallbackModel} also failed: ${fallbackError}`,
				);
				throw lastError; // 元のエラーを投げる
			}
		};

		// 進捗表示を更新
		await interaction.editReply({
			content: "回答を生成中...",
		});

		// チャット用のプロンプト
		const prompt = `あなたは親切で有用なAIアシスタントです。以下のユーザーのメッセージに丁寧に回答してください。

ユーザーのメッセージ: ${message}
回答:`;

		const response = await generateWithRetry(prompt);

		// 回答を整形
		const formattedResponse = `
${response}

-# AIによって生成されました`;

		return formattedResponse;
	} catch (error) {
		logError(`Error performing chat: ${error}`);
		throw error;
	}
}
