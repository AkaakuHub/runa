import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";
import { logError } from "../../utils/logger";
import { analyzeSenryu } from "../../utils/senryuDetector";
import { formatSudachiTokens } from "../../utils/sudachiFormatter";

const formatSenryuResult = (
	text: string,
	analysis: Awaited<ReturnType<typeof analyzeSenryu>>,
): string => {
	if (analysis.isSenryu && analysis.result) {
		return [
			"✅ 川柳です。",
			"",
			`入力: ${text}`,
			`区切り: ${analysis.result.segments.join(" / ")}`,
			`読み: ${analysis.result.reading}`,
			`品質点: ${analysis.result.qualityScore}`,
			`評価: ${analysis.result.qualityReasons.join("、") || "なし"}`,
		].join("\n");
	}

	return [
		"❌ 川柳ではありません。",
		"",
		`入力: ${text}`,
		`理由: ${analysis.reason ?? "5・7・5 として判定できませんでした。"}`,
		analysis.result ? `候補: ${analysis.result.segments.join(" / ")}` : null,
		analysis.qualityScore !== null ? `品質点: ${analysis.qualityScore}` : null,
		analysis.qualityReasons.length > 0
			? `評価: ${analysis.qualityReasons.join("、")}`
			: null,
		`モーラ数: ${analysis.totalMora}`,
		analysis.tokens.length > 0
			? `Sudachi解析:\n${formatSudachiTokens(analysis.tokens)}`
			: null,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
};

export const IsSenryuCommand: CommandDefinition = {
	name: "is-senryu",
	description: "入力が川柳かどうかを判定します",
	options: [
		{
			name: "text",
			description: "判定したい文章",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		await interaction.deferReply({});

		try {
			const text = interaction.options.getString("text", true);
			const analysis = await analyzeSenryu(text);
			await interaction.editReply(formatSenryuResult(text, analysis));
		} catch (error) {
			logError(`is-senryu command failed: ${error}`);
			await interaction.editReply(
				`川柳判定に失敗しました: ${(error as Error).message}`,
			);
		}
	},
};
