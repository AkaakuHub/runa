import type { Morpheme } from "../services/MorphologyService";

const formatSudachiToken = (token: Morpheme, index: number): string => {
	const pos = token.partOfSpeech.filter((item) => item && item !== "*");
	const posText = pos.length > 0 ? pos.join("・") : "品詞情報なし";
	return `${index + 1}. ${token.surface} / ${token.dictionaryForm} / 読み: ${token.reading || "-"} / ${posText}`;
};

export const formatSudachiTokens = (
	tokens: Morpheme[],
	limit = tokens.length,
): string => {
	return tokens
		.slice(0, limit)
		.map((token, index) => formatSudachiToken(token, index))
		.join("\n");
};
