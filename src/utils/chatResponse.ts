import { logError } from "./logger";
import { chatWithAssistant } from "./useAI";

const DEFAULT_CHAT_SYSTEM_PROMPT =
	"あなたは親切で有用なAIアシスタントです。以下のユーザーのメッセージに丁寧に回答してください。否定だけの返答はしないでください。応答は、特に指示のない限り、日本語で行ってください。";

export const CHAT_PROGRESS_MESSAGE = "回答を生成中...";

interface GenerateChatResponseOptions {
	systemPrompt?: string;
	onProgress?: (content: string) => Promise<void>;
}

export async function generateChatResponse(
	message: string,
	options: GenerateChatResponseOptions = {},
): Promise<string> {
	try {
		await options.onProgress?.(CHAT_PROGRESS_MESSAGE);

		const response = await chatWithAssistant(
			message,
			options.systemPrompt ?? DEFAULT_CHAT_SYSTEM_PROMPT,
		);

		return `
> ${message}

${response}`;
	} catch (error) {
		logError(`Error generating chat response: ${error}`);
		throw error;
	}
}
