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
	width: 800,
	height: 1200,
	backgroundColor: "#f8f8f0",
	headerColor: "#2c3e50",
	textColor: "#2c3e50",
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
		const headerHeight = 80;
		const currentDate = new Date().toLocaleDateString("ja-JP", {
			year: "numeric",
			month: "long",
			day: "numeric",
			weekday: "long",
		});

		// ヘッダー背景
		svg.append("rect")
			.attr("x", 0)
			.attr("y", 0)
			.attr("width", this.config.width)
			.attr("height", headerHeight)
			.attr("fill", this.config.headerColor);

		// 新聞タイトル
		svg.append("text")
			.attr("x", this.config.width / 2)
			.attr("y", 40)
			.attr("text-anchor", "middle")
			.attr("fill", "white")
			.attr("font-family", "serif")
			.attr("font-size", "32px")
			.attr("font-weight", "bold")
			.attr("letter-spacing", "2px")
			.text("サーバー日報");

		// 日付
		svg.append("text")
			.attr("x", this.config.width / 2)
			.attr("y", 65)
			.attr("text-anchor", "middle")
			.attr("fill", "white")
			.attr("font-family", "serif")
			.attr("font-size", "14px")
			.attr("opacity", 0.9)
			.text(currentDate);

		// 区切り線
		svg.append("line")
			.attr("x1", 0)
			.attr("y1", headerHeight)
			.attr("x2", this.config.width)
			.attr("y2", headerHeight)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 3);
	}

	private drawSections(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, sections: Array<{ title: string; content: string }>): void {
		let currentY = 120;
		const padding = 40;
		const maxWidth = this.config.width - (padding * 2);

		for (const section of sections) {
			// セクションタイトル
			const titleLines = this.wrapText(section.title, maxWidth, 20);
			for (const line of titleLines) {
				svg.append("text")
					.attr("x", padding)
					.attr("y", currentY)
					.attr("fill", this.config.headerColor)
					.attr("font-family", "serif")
					.attr("font-size", "20px")
					.attr("font-weight", "bold")
					.text(line);
				currentY += 25;
			}

			currentY += 10;

			// セクションコンテンツ
			const contentLines = this.wrapText(section.content, maxWidth, 16);
			for (const line of contentLines) {
				svg.append("text")
					.attr("x", padding)
					.attr("y", currentY)
					.attr("fill", this.config.textColor)
					.attr("font-family", "serif")
					.attr("font-size", "16px")
					.text(line);
				currentY += 22;
			}

			currentY += 20;

			// セクション区切り線
			svg.append("line")
				.attr("x1", padding)
				.attr("y1", currentY)
				.attr("x2", this.config.width - padding)
				.attr("y2", currentY)
				.attr("stroke", "#d0d0d0")
				.attr("stroke-width", 1);

			currentY += 25;
		}
	}

	private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
		const lines: string[] = [];
		const chars = text.split("");
		let currentLine = "";
		const charWidth = fontSize * 0.6; // 大まかな文字幅

		for (const char of chars) {
			const testLine = currentLine + char;
			const estimatedWidth = testLine.length * charWidth;
			
			if (estimatedWidth > maxWidth && currentLine !== "") {
				lines.push(currentLine);
				currentLine = char;
			} else {
				currentLine = testLine;
			}
		}
		
		if (currentLine) {
			lines.push(currentLine);
		}

		return lines;
	}

	private drawDecorations(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		// 左右の装飾線
		svg.append("line")
			.attr("x1", 20)
			.attr("y1", 80)
			.attr("x2", 20)
			.attr("y2", this.config.height - 50)
			.attr("stroke", "#e0e0e0")
			.attr("stroke-width", 1);

		svg.append("line")
			.attr("x1", this.config.width - 20)
			.attr("y1", 80)
			.attr("x2", this.config.width - 20)
			.attr("y2", this.config.height - 50)
			.attr("stroke", "#e0e0e0")
			.attr("stroke-width", 1);

		// 下部の装飾線
		svg.append("line")
			.attr("x1", 40)
			.attr("y1", this.config.height - 30)
			.attr("x2", this.config.width - 40)
			.attr("y2", this.config.height - 30)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
	}

	private async svgToPng(svgString: string): Promise<Buffer> {
		// SVGをPNGに変換
		return await sharp(Buffer.from(svgString))
			.png()
			.toBuffer();
	}
}