/**
 * Twitter/X リンクを fxtwitter に変換するユーティリティ
 */

/**
 * URLがTwitter/Xのものであるかを判定
 */
const isTwitterLike = (url: string): boolean =>
	/(^https?:\/\/)(?:www\.)?(x\.com|twitter\.com)\b/i.test(url);

/**
 * Twitter/X リンクを fxtwitter に変換
 */
const convertToFxTwitter = (url: string): string =>
	url
		.replace(/(^https?:\/\/)(?:www\.)?x\.com\b/i, "$1fxtwitter.com")
		.replace(/(^https?:\/\/)(?:www\.)?twitter\.com\b/i, "$1fxtwitter.com");

/**
 * マークダウンリンクを作成（表示用）
 */
const mkMdLink = (url: string): string => `[.](${url})`;

/**
 * アングルブラケットリンクを作成（元URL用）
 */
const mkAngleLink = (url: string): string => `<${url}>`;

/**
 * テキスト内のTwitter/Xリンクをすべて抽出し、fxtwitterに変換したペアを生成
 */
export const convertTwitterLinks = (content: string): string[] => {
	const urls = content.match(/https?:\/\/\S+/g) ?? [];

	const pairs = urls
		.filter(isTwitterLike)
		.map((originalUrl): string | null => {
			const convertedUrl = convertToFxTwitter(originalUrl);
			if (convertedUrl === originalUrl) {
				return null;
			}
			return `${mkMdLink(convertedUrl)} ${mkAngleLink(originalUrl)}`;
		})
		.filter((v): v is string => v !== null);

	return pairs;
};
