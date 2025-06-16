import * as d3 from "d3";
import { JSDOM } from "jsdom";
import { Buffer } from "node:buffer";
import sharp from "sharp";

interface NewspaperConfig {
	width: number;
	height: number;
	backgroundColor: string;
	headerColor: string;
	textColor: string;
}

const DEFAULT_CONFIG: NewspaperConfig = {
	width: 1200,
	height: 1600,
	backgroundColor: "#f8f8f8",
	headerColor: "#000000",
	textColor: "#333333",
};

export class NewspaperImageGenerator {
	private config: NewspaperConfig;

	constructor(config: Partial<NewspaperConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	async generateImage(summaryText: string): Promise<Buffer> {
		const sections = this.parseSummaryText(summaryText);
		const svgString = this.generateSVG(sections);

		// SVGをPNGに変換
		return await this.svgToPng(svgString);
	}

	private parseSummaryText(text: string): Array<{ title: string; content: string }> {
		const sections: Array<{ title: string; content: string }> = [];

		console.log("Original text:", text); // デバッグ用

		// 📰 **今日のサーバーニュース** の部分を除去
		const cleanText = text.replace(/📰\s*\*\*今日のサーバーニュース\*\*\s*\n*/g, "");
		console.log("Clean text:", cleanText); // デバッグ用

		// 🔸 で始まる各セクションを抽出（改良版）
		const sectionRegex = /🔸\s*\*\*(.*?)\*\*\s*\n(.*?)(?=🔸|📌|$)/gs;
		const matches = Array.from(cleanText.matchAll(sectionRegex));
		console.log("Regex matches:", matches.length); // デバッグ用

		for (const match of matches) {
			const title = match[1].trim();
			const content = match[2].trim();
			console.log("Found section:", { title, content }); // デバッグ用
			sections.push({ title, content });
		}

		// マッチしない場合の代替パース方法
		if (sections.length === 0) {
			// 行ごとに分割して解析
			const lines = cleanText.split('\n').filter(line => line.trim());
			let currentTitle = "";
			let currentContent = "";

			for (const line of lines) {
				if (line.includes('**') && (line.includes('🔸') || line.includes('**'))) {
					// 前のセクションを保存
					if (currentTitle && currentContent) {
						sections.push({ title: currentTitle, content: currentContent.trim() });
					}
					// 新しいタイトルを設定
					currentTitle = line.replace(/🔸\s*\*\*(.*?)\*\*.*/, '$1').trim();
					currentContent = "";
				} else if (line.trim() && currentTitle) {
					// コンテンツを追加
					currentContent += `${line.trim()} `;
				}
			}

			// 最後のセクションを追加
			if (currentTitle && currentContent) {
				sections.push({ title: currentTitle, content: currentContent.trim() });
			}
		}

		// 📌 イチオシニュースがある場合は最初に配置
		const highlightRegex = /📌\s*\*\*(.*?)\*\*[:\s]*(.*?)$/gs;
		const highlightMatch = text.match(highlightRegex);
		if (highlightMatch) {
			const highlightText = highlightMatch[0].replace(/📌\s*\*\*.*?\*\*[:\s]*/, "");
			sections.unshift({ title: "📌 イチオシニュース", content: highlightText });
		}

		console.log("Final sections:", sections); // デバッグ用
		return sections;
	}

	private generateSVG(sections: Array<{ title: string; content: string }>): string {
		const dom = new JSDOM();
		const document = dom.window.document;

		// SVG要素を作成
		const svg = d3.select(document.body)
			.append("svg")
			.attr("width", this.config.width)
			.attr("height", this.config.height)
			.attr("xmlns", "http://www.w3.org/2000/svg");

		// 背景
		svg.append("rect")
			.attr("width", this.config.width)
			.attr("height", this.config.height)
			.attr("fill", this.config.backgroundColor);

		// ヘッダー部分
		this.drawHeader(svg);

		// セクション描画
		this.drawSections(svg, sections);

		// 装飾
		this.drawDecorations(svg);

		return document.body.innerHTML;
	}

	private drawHeader(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		const currentDate = new Date();
		const year = currentDate.getFullYear();
		const month = currentDate.getMonth() + 1;
		const day = currentDate.getDate();
		const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
		const weekday = weekdays[currentDate.getDay()];
		const dateString = `${year}年${month}月${day}日`;

		// 外枠
		svg.append("rect")
			.attr("x", 20)
			.attr("y", 20)
			.attr("width", this.config.width - 40)
			.attr("height", this.config.height - 40)
			.attr("fill", "none")
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);

		// ヘッダー背景
		svg.append("rect")
			.attr("x", 20)
			.attr("y", 20)
			.attr("width", this.config.width - 40)
			.attr("height", 120)
			.attr("fill", "white")
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 1);

		// メイン題字（横書き、中央配置）
		svg.append("text")
			.attr("x", this.config.width / 2)
			.attr("y", 70)
			.attr("text-anchor", "middle")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "42px")
			.attr("font-weight", "bold")
			.text("サーバー日報");

		// 日付（右上）
		svg.append("text")
			.attr("x", this.config.width - 50)
			.attr("y", 50)
			.attr("text-anchor", "end")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "16px")
			.text(dateString);

		// 曜日
		svg.append("text")
			.attr("x", this.config.width - 50)
			.attr("y", 70)
			.attr("text-anchor", "end")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "14px")
			.text(`(${weekday})`);

		// 発行者情報（左上）
		svg.append("text")
			.attr("x", 50)
			.attr("y", 50)
			.attr("text-anchor", "start")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "12px")
			.text("発行：システム管理室");

		// 下部境界線
		svg.append("line")
			.attr("x1", 20)
			.attr("y1", 140)
			.attr("x2", this.config.width - 20)
			.attr("y2", 140)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
	}

	private drawSections(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, sections: Array<{ title: string; content: string }>): void {
		const marginLeft = 50;
		const marginRight = 50;
		const columnWidth = 250;
		const columnSpacing = 30;
		const availableWidth = this.config.width - marginLeft - marginRight;
		const numColumns = Math.floor((availableWidth + columnSpacing) / (columnWidth + columnSpacing));
		const startY = 170;

		let currentColumn = 0;
		let currentY = startY;

		for (let i = 0; i < sections.length; i++) {
			const section = sections[i];
			const columnX = marginLeft + (currentColumn * (columnWidth + columnSpacing));

			// セクションタイトル（横書き、見出し風）
			const isHighlight = section.title.includes('📌');
			const titleFontSize = isHighlight ? "24px" : "18px";
			const titleWeight = isHighlight ? "bold" : "bold";

			// タイトル背景（ハイライト記事の場合）
			if (isHighlight) {
				svg.append("rect")
					.attr("x", columnX - 5)
					.attr("y", currentY - 25)
					.attr("width", columnWidth + 10)
					.attr("height", 35)
					.attr("fill", "#f0f0f0")
					.attr("stroke", this.config.headerColor)
					.attr("stroke-width", 1);
			}

			// セクションタイトル
			const cleanTitle = section.title.replace(/[📌🔸]/gu, '').replace(/\*\*/g, '').trim();
			const titleLines = this.wrapText(cleanTitle, columnWidth, Number.parseInt(titleFontSize.replace('px', '')));

			for (let j = 0; j < titleLines.length; j++) {
				svg.append("text")
					.attr("x", columnX)
					.attr("y", currentY + (j * 25))
					.attr("fill", this.config.headerColor)
					.attr("font-family", "serif")
					.attr("font-size", titleFontSize)
					.attr("font-weight", titleWeight)
					.text(titleLines[j]);
			}

			currentY += (titleLines.length * 25) + 15;

			// セクションコンテンツ（横書き、段落形式）
			const contentLines = this.wrapText(section.content, columnWidth, 14);
			const maxLinesPerColumn = Math.floor((this.config.height - currentY - 100) / 18);

			let lineCount = 0;
			for (const line of contentLines) {
				if (lineCount >= maxLinesPerColumn && currentColumn < numColumns - 1) {
					// 次のカラムに移動
					currentColumn++;
					currentY = startY;
					lineCount = 0;
					const newColumnX = marginLeft + (currentColumn * (columnWidth + columnSpacing));

					svg.append("text")
						.attr("x", newColumnX)
						.attr("y", currentY + (lineCount * 18))
						.attr("fill", this.config.textColor)
						.attr("font-family", "serif")
						.attr("font-size", "14px")
						.text(line);
				} else {
					svg.append("text")
						.attr("x", columnX)
						.attr("y", currentY + (lineCount * 18))
						.attr("fill", this.config.textColor)
						.attr("font-family", "serif")
						.attr("font-size", "14px")
						.text(line);
				}
				lineCount++;
			}

			// 次のセクションの準備
			currentY += (Math.min(contentLines.length, maxLinesPerColumn) * 18) + 30;

			// カラムが満杯になったら次のカラムへ
			if (currentY > this.config.height - 200) {
				currentColumn++;
				currentY = startY;
				if (currentColumn >= numColumns) {
					break; // これ以上表示できない
				}
			}

			// カラム間の区切り線
			if (currentColumn > 0 && currentColumn < numColumns) {
				const lineX = marginLeft + (currentColumn * (columnWidth + columnSpacing)) - (columnSpacing / 2);
				svg.append("line")
					.attr("x1", lineX)
					.attr("y1", 160)
					.attr("x2", lineX)
					.attr("y2", this.config.height - 80)
					.attr("stroke", "#cccccc")
					.attr("stroke-width", 1);
			}
		}
	}


	private drawDecorations(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		// フッター情報
		svg.append("text")
			.attr("x", this.config.width / 2)
			.attr("y", this.config.height - 30)
			.attr("text-anchor", "middle")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "12px")
			.text("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

		svg.append("text")
			.attr("x", 50)
			.attr("y", this.config.height - 50)
			.attr("text-anchor", "start")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "10px")
			.text("発行者：システム管理室 | 編集：自動生成システム");
	}

	private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
		const words = text.split(' ');
		const lines: string[] = [];
		let currentLine = '';

		// 文字数の目安（フォントサイズに基づく）
		const avgCharWidth = fontSize * 0.6;
		const maxCharsPerLine = Math.floor(maxWidth / avgCharWidth);

		for (const word of words) {
			const testLine = currentLine + (currentLine ? ' ' : '') + word;

			if (testLine.length <= maxCharsPerLine) {
				currentLine = testLine;
			} else {
				if (currentLine) {
					lines.push(currentLine);
					currentLine = word;
				} else {
					// 単語が長すぎる場合は強制的に分割
					lines.push(word);
				}
			}
		}

		if (currentLine) {
			lines.push(currentLine);
		}

		return lines;
	}

	private async svgToPng(svgString: string): Promise<Buffer> {
		// SVGをPNGに変換
		return await sharp(Buffer.from(svgString))
			.png()
			.toBuffer();
	}
}