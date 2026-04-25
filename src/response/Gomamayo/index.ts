import type { Message } from "discord.js";
import { GomamayoService } from "../../services/GomamayoService";
import { hasJapanese } from "../../utils/kana";
import { logError } from "../../utils/logger";

const shouldCheckGomamayo = (content: string): boolean => {
	if (!content.trim()) {
		return false;
	}
	if (content.startsWith("/")) {
		return false;
	}
	return hasJapanese(content);
};

export const handleGomamayoResponse = async (
	message: Message,
): Promise<void> => {
	if (!shouldCheckGomamayo(message.content)) {
		return;
	}

	try {
		const result = await GomamayoService.getInstance().judge(message.content);
		if (result.kind === "none") {
			return;
		}

		await message.react("⁉️");
	} catch (error) {
		logError(`Gomamayo detection failed: ${error}`);
	}
};
