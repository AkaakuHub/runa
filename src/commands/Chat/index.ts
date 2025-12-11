import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError } from "../../utils/logger";
import { editAndFollowUpLongMessage } from "../../utils/messageUtils";
import { chatWithAssistant } from "../../utils/useAI";

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
		// 進捗表示を更新
		await interaction.editReply({
			content: "回答を生成中...",
		});

		// チャット用のシステムプロンプト
		const systemPrompt =
			"あなたは親切で有用なAIアシスタントです。以下のユーザーのメッセージに丁寧に回答してください。";

		const response = await chatWithAssistant(message, systemPrompt);

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
