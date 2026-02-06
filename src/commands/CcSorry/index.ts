import {
	type ChatInputCommandInteraction,
	AttachmentBuilder,
} from "discord.js";
import sharp from "sharp";
import * as d3 from "d3";
import { JSDOM } from "jsdom";
import type { CommandDefinition } from "../../types";
import { getCurrentJSTDate, getLocalDateString } from "../../utils/dateUtils";
import { generateAiText } from "../../utils/useAI";

// Geminiを使って反省文を株式会社Anthropicの謝罪文に整形
const formatApologyText = async (originalText: string): Promise<string> => {
	const prompt = `以下の反省文をもとに、株式会社Anthropicが実際に発表する謝罪プレスリリースを作成してください。

重要な制約：
- 文字数は絶対に1200文字以内に収める
- 文章は、マークダウン形式ではなく、プレーンテキストのみで出力する
- 日付や、人名のヘッダー等も不要。謝罪文の中身の文章のみを出力する
- 人間が書いたような自然で簡潔な文章にする
- AI感のある過度に丁寧な表現は避ける
- 企業の公式謝罪文として適切だが、堅すぎない文体で、ユーモアをもたせる(ダジャレ、謎掛け、なぞなぞなども可能だが30%程度の確率で使用し、毎回は使用しないこと)
- 改善策では、簡潔に1-2項目のみで、ナンバリングを数字で行う
- 段落は5-6個以内

元の反省文：
${originalText}

1200文字以内の謝罪文：`;

	try {
		return await generateAiText(prompt);
	} catch (error) {
		console.error("Gemini API呼び出しエラー:", error);
		throw new Error("謝罪文の整形に失敗しました");
	}
};

const fontFamily = "Noto Serif CJK JP, IPAexMincho, IPAMincho, serif";

const generateApologyImage = async (text: string): Promise<Buffer> => {
	const width = 1190; // A4サイズ（144dpi - 高解像度）
	const height = 1684;

	// JSDOMで仮想DOM環境を作成
	const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
	global.document = dom.window.document;

	// SVGコンテナを作成
	const svg = d3
		.select(dom.window.document.body)
		.append("svg")
		.attr("width", width)
		.attr("height", height)
		.attr("xmlns", "http://www.w3.org/2000/svg");

	// 背景を白に設定
	svg
		.append("rect")
		.attr("width", width)
		.attr("height", height)
		.attr("fill", "white");

	// 日付（右上）
	const today = getCurrentJSTDate();
	const dateStr = getLocalDateString(today);
	svg
		.append("text")
		.attr("x", width - 100)
		.attr("y", 80)
		.attr("font-family", fontFamily)
		.attr("font-size", 20)
		.attr("fill", "black")
		.attr("text-anchor", "end")
		.text(dateStr);

	// ヘッダー（会社名）
	svg
		.append("text")
		.attr("x", 100)
		.attr("y", 140)
		.attr("font-family", fontFamily)
		.attr("font-size", 28)
		.attr("fill", "black")
		.text("株式会社Anthropic");

	svg
		.append("text")
		.attr("x", 100)
		.attr("y", 180)
		.attr("font-family", fontFamily)
		.attr("font-size", 24)
		.attr("fill", "black")
		.text("Claude Code事業部");

	// タイトル
	svg
		.append("text")
		.attr("x", width / 2)
		.attr("y", 280)
		.attr("font-family", fontFamily)
		.attr("font-size", 36)
		.attr("fill", "black")
		.attr("text-anchor", "middle")
		.text("お詫び");

	// 拝啓
	svg
		.append("text")
		.attr("x", 100)
		.attr("y", 340)
		.attr("font-family", fontFamily)
		.attr("font-size", 24)
		.attr("fill", "black")
		.text("拝啓");

	// 本文を段落に分けて配置
	const paragraphs = text.split("\n").filter((p) => p.trim());
	let currentY = 400;
	const lineHeight = 36;
	const maxWidth = width - 200; // 余裕を持たせる
	const leftMargin = 100; // 通常の左マージン
	const indentMargin = 140; // 段落最初の行のインデント

	for (const paragraph of paragraphs) {
		if (paragraph.trim()) {
			// 文字数で行を分割（日本語文字を考慮）
			const chars = paragraph.split("");
			let currentLine = "";
			let charIndex = 0;
			let isFirstLineOfParagraph = true; // 段落の最初の行かどうかのフラグ

			while (charIndex < chars.length) {
				const char = chars[charIndex];
				const testLine = currentLine + char;

				// より厳密な文字幅制御（日本語は全角で約24px、英数字は約12px）
				const estimatedWidth = testLine.split("").reduce((width, char) => {
					// ASCIIコード範囲外は日本語として扱う
					const charCode = char.charCodeAt(0);
					return width + (charCode > 127 ? 24 : 12);
				}, 0);

				if (estimatedWidth > maxWidth && currentLine.length > 0) {
					// 現在の行を描画（段落の最初の行のみインデント）
					svg
						.append("text")
						.attr("x", isFirstLineOfParagraph ? indentMargin : leftMargin)
						.attr("y", currentY)
						.attr("font-family", fontFamily)
						.attr("font-size", 24)
						.attr("fill", "black")
						.text(currentLine);

					currentY += lineHeight;
					currentLine = char;
					isFirstLineOfParagraph = false; // 2行目以降はインデントしない

					// ページからはみ出さないようにチェック
					if (currentY > height - 300) break;
				} else {
					currentLine = testLine;
				}
				charIndex++;
			}

			// 残りの文字を描画
			if (currentLine && currentY <= height - 300) {
				svg
					.append("text")
					.attr("x", isFirstLineOfParagraph ? indentMargin : leftMargin)
					.attr("y", currentY)
					.attr("font-family", fontFamily)
					.attr("font-size", 24)
					.attr("fill", "black")
					.text(currentLine);

				currentY += lineHeight + 20; // 段落間の余白
			}
		}
	}

	// 署名
	svg
		.append("text")
		.attr("x", width - 100)
		.attr("y", height - 200)
		.attr("font-family", fontFamily)
		.attr("font-size", 24)
		.attr("fill", "black")
		.attr("text-anchor", "end")
		.text("敬具");

	// ページ番号
	svg
		.append("text")
		.attr("x", width / 2)
		.attr("y", height - 60)
		.attr("font-family", fontFamily)
		.attr("font-size", 24)
		.attr("fill", "black")
		.attr("text-anchor", "middle")
		.text("1");

	// SVGの内容を取得
	const svgContent = dom.window.document.body.innerHTML;

	// SVGをPNGに変換
	return sharp(Buffer.from(svgContent)).png().toBuffer();
};

const CcSorryCommand: CommandDefinition = {
	name: "ccsorry",
	description:
		"反省文を株式会社Anthropicの謝罪プレスリリース形式の画像として生成",
	options: [
		{
			name: "text",
			description: "謝罪文の内容",
			type: "STRING",
			required: true,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction) => {
		try {
			await interaction.deferReply();

			const text = interaction.options.getString("text");
			if (!text) {
				await interaction.editReply("テキストが提供されていません。");
				return;
			}

			// Geminiで謝罪文を整形
			const formattedText = await formatApologyText(text);

			// 変な文字を消す
			// **, ##などをすべて削除
			const cleanText = formattedText
				.replace(/\*\*/g, "")
				.replace(/##/g, "")
				.trim();

			// 画像生成
			const imageBuffer = await generateApologyImage(cleanText);

			// 画像をDiscordに送信
			const attachment = new AttachmentBuilder(imageBuffer, {
				name: "apology.png",
			});

			await interaction.editReply({
				content: "株式会社Anthropicの謝罪プレスリリースを生成しました。",
				files: [attachment],
			});
		} catch (error) {
			console.error("CcSorryコマンドでエラーが発生しました:", error);
			await interaction.editReply("画像の生成中にエラーが発生しました。");
		}
	},
};

export default CcSorryCommand;
