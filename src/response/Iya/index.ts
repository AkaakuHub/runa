import type { Message } from "discord.js";
import type { IYAKind } from "../../types";
import { logError, logInfo } from "../../utils/logger";

export const IyaResponse = async (
	message: Message,
	kind: IYAKind,
): Promise<void> => {
	try {
		const dict = {
			"寝る！": "assets/images/iya/sleep.png",
			"起きる！": "assets/images/iya/awake.png",
			"遊ぶ！": "assets/images/iya/play.png",
			"ご飯を食べる！": "assets/images/iya/eat.png",
		};
		await message.reply({
			content: kind,
			files: [dict[kind]],
		});
		logInfo(`Replied to Iya message from ${message.author.username}`);
	} catch (error) {
		logError(`Error sending Iya response: ${error}`);
	}
};
