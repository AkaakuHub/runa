import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";
import { MorphologyService } from "../../services/MorphologyService";
import { logError } from "../../utils/logger";
import { editAndFollowUpLongMessage } from "../../utils/messageUtils";

const formatTokens = (tokensLength: number, body: string): string => {
	return `解析結果\n- トークン数: ${tokensLength}\n\n${body}`;
};

export const SudachiCommand: CommandDefinition = {
	name: "sudachi",
	description: "SudachiPy を使って日本語の文章を形態素解析します",
	options: [
		{
			name: "text",
			description: "解析したい日本語の文章",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		const inputText = interaction.options.getString("text", true);
		const limit = 2000;
		const morphologyService = MorphologyService.getInstance();

		await interaction.deferReply({});

		try {
			const tokens = await morphologyService.analyze(inputText);
			if (tokens.length === 0) {
				await interaction.editReply(
					"トークン化結果が空でした。別の文章を試してください。",
				);
				return;
			}

			const body = tokens
				.slice(0, limit)
				.map((token, index) => {
					const pos = token.partOfSpeech.filter((item) => item && item !== "*");
					const posText = pos.length > 0 ? pos.join("・") : "品詞情報なし";
					return `${index + 1}. ${token.surface} / ${token.dictionaryForm} / 読み: ${token.reading || "-"} / ${posText}`;
				})
				.join("\n");

			await editAndFollowUpLongMessage(
				interaction,
				formatTokens(tokens.length, body),
			);
		} catch (error) {
			logError(`Sudachi command failed: ${error}`);
			await interaction.editReply(
				`Sudachi の実行に失敗しました: ${(error as Error).message}\n 環境を整えてください。`,
			);
		}
	},
};
