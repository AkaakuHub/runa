const HIRAGANA_PATTERN = /^[ぁ-ん]+$/;
const KANA_PATTERN = /[ァ-ヶーぁ-ゖ]/;
const JAPANESE_PATTERN = /[ぁ-んァ-ヶー一-龠々]/;

const SMALL_KANA = new Set([
	"ァ",
	"ィ",
	"ゥ",
	"ェ",
	"ォ",
	"ャ",
	"ュ",
	"ョ",
	"ヮ",
	"ヵ",
	"ヶ",
	"ぁ",
	"ぃ",
	"ぅ",
	"ぇ",
	"ぉ",
	"ゃ",
	"ゅ",
	"ょ",
	"ゎ",
]);

export const isHiragana = (text: string): boolean => {
	return HIRAGANA_PATTERN.test(text);
};

export const hasJapanese = (text: string): boolean => {
	return JAPANESE_PATTERN.test(text);
};

export const isAscii = (text: string): boolean => {
	return (
		text.length > 0 && [...text].every((char) => char.charCodeAt(0) <= 0x7f)
	);
};

export const isKana = (text: string): boolean => {
	return KANA_PATTERN.test(text);
};

export const isSmallKana = (text: string): boolean => {
	return SMALL_KANA.has(text);
};

export const katakanaToHiragana = (text: string): string => {
	return text.replace(/[\u30a1-\u30f6]/g, (char) =>
		String.fromCharCode(char.charCodeAt(0) - 0x60),
	);
};

export const hiraganaToKatakana = (text: string): string => {
	return text.replace(/[ぁ-ゖ]/g, (char) =>
		String.fromCharCode(char.charCodeAt(0) + 0x60),
	);
};
