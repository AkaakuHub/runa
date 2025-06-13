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
	height: 800,
	backgroundColor: "#ffffff",
	headerColor: "#000000",
	textColor: "#000000",
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
		const currentDate = new Date().toLocaleDateString("ja-JP", {
			year: "numeric",
			month: "long",
			day: "numeric",
			weekday: "long",
		});

		// 上部タイトル - 縦書き風に配置
		svg.append("text")
			.attr("x", this.config.width - 60)
			.attr("y", 40)
			.attr("text-anchor", "middle")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "36px")
			.attr("font-weight", "bold")
			.attr("writing-mode", "vertical-rl")
			.attr("text-orientation", "upright")
			.text("サーバー日報");

		// 日付（縦書き）
		svg.append("text")
			.attr("x", this.config.width - 120)
			.attr("y", 40)
			.attr("text-anchor", "start")
			.attr("fill", this.config.headerColor)
			.attr("font-family", "serif")
			.attr("font-size", "16px")
			.attr("writing-mode", "vertical-rl")
			.attr("text-orientation", "upright")
			.text(currentDate);

		// 題号の下線
		svg.append("line")
			.attr("x1", this.config.width - 40)
			.attr("y1", 20)
			.attr("x2", this.config.width - 40)
			.attr("y2", 120)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);

		// 外枠
		svg.append("rect")
			.attr("x", 10)
			.attr("y", 10)
			.attr("width", this.config.width - 20)
			.attr("height", this.config.height - 20)
			.attr("fill", "none")
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 3);
	}

	private drawSections(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, sections: Array<{ title: string; content: string }>): void {
		const columnWidth = 180;
		const columnHeight = this.config.height - 140;
		const columnSpacing = 20;
		const maxColumns = Math.floor((this.config.width - 200) / (columnWidth + columnSpacing));
		
		let currentColumn = 0;
		let currentY = 50;
		
		for (let i = 0; i < sections.length; i++) {
			const section = sections[i];
			const startX = this.config.width - 180 - (currentColumn * (columnWidth + columnSpacing));
			
			// セクションタイトル（縦書き）
			const titleChars = section.title.split('');
			let titleY = currentY;
			
			for (const char of titleChars) {
				svg.append("text")
					.attr("x", startX)
					.attr("y", titleY)
					.attr("fill", this.config.headerColor)
					.attr("font-family", "serif")
					.attr("font-size", "18px")
					.attr("font-weight", "bold")
					.attr("text-anchor", "middle")
					.text(char);
				titleY += 20;
			}
			
			currentY = titleY + 20;
			
			// セクションコンテンツ（縦書き）
			const contentChars = section.content.split('');
			let contentY = currentY;
			let contentX = startX;
			let charCount = 0;
			const maxCharsPerColumn = Math.floor((columnHeight - currentY) / 18);
			
			for (const char of contentChars) {
				if (charCount >= maxCharsPerColumn) {
					// 次の行に移動
					contentX -= 20;
					contentY = currentY;
					charCount = 0;
					
					// カラム境界チェック
					if (contentX < startX - 60) {
						currentColumn++;
						if (currentColumn >= maxColumns) {
							currentColumn = 0;
							currentY = 50;
						}
						contentX = this.config.width - 180 - (currentColumn * (columnWidth + columnSpacing));
						contentY = currentY;
					}
				}
				
				svg.append("text")
					.attr("x", contentX)
					.attr("y", contentY)
					.attr("fill", this.config.textColor)
					.attr("font-family", "serif")
					.attr("font-size", "14px")
					.attr("text-anchor", "middle")
					.text(char);
				
				contentY += 18;
				charCount++;
			}
			
			// 次のセクションの準備
			currentColumn++;
			if (currentColumn >= maxColumns) {
				currentColumn = 0;
				currentY = Math.max(contentY + 40, 50);
			} else {
				currentY = 50;
			}
			
			// カラム間の区切り線
			if (currentColumn > 0 || i < sections.length - 1) {
				const lineX = this.config.width - 180 - (currentColumn * (columnWidth + columnSpacing)) + columnWidth/2;
				svg.append("line")
					.attr("x1", lineX)
					.attr("y1", 30)
					.attr("x2", lineX)
					.attr("y2", this.config.height - 50)
					.attr("stroke", "#cccccc")
					.attr("stroke-width", 1);
			}
		}
	}


	private drawDecorations(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		// 上部の装飾線（新聞らしい二重線）
		svg.append("line")
			.attr("x1", 30)
			.attr("y1", 25)
			.attr("x2", this.config.width - 200)
			.attr("y2", 25)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 1);
			
		svg.append("line")
			.attr("x1", 30)
			.attr("y1", 28)
			.attr("x2", this.config.width - 200)
			.attr("y2", 28)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 1);

		// 下部の装飾線
		svg.append("line")
			.attr("x1", 30)
			.attr("y1", this.config.height - 25)
			.attr("x2", this.config.width - 30)
			.attr("y2", this.config.height - 25)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 1);
			
		svg.append("line")
			.attr("x1", 30)
			.attr("y1", this.config.height - 28)
			.attr("x2", this.config.width - 30)
			.attr("y2", this.config.height - 28)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 1);

		// 角の装飾
		const cornerSize = 15;
		
		// 左上角
		svg.append("line")
			.attr("x1", 20)
			.attr("y1", 20)
			.attr("x2", 20 + cornerSize)
			.attr("y2", 20)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
		svg.append("line")
			.attr("x1", 20)
			.attr("y1", 20)
			.attr("x2", 20)
			.attr("y2", 20 + cornerSize)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
			
		// 右上角
		svg.append("line")
			.attr("x1", this.config.width - 20)
			.attr("y1", 20)
			.attr("x2", this.config.width - 20 - cornerSize)
			.attr("y2", 20)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
		svg.append("line")
			.attr("x1", this.config.width - 20)
			.attr("y1", 20)
			.attr("x2", this.config.width - 20)
			.attr("y2", 20 + cornerSize)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
			
		// 左下角
		svg.append("line")
			.attr("x1", 20)
			.attr("y1", this.config.height - 20)
			.attr("x2", 20 + cornerSize)
			.attr("y2", this.config.height - 20)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
		svg.append("line")
			.attr("x1", 20)
			.attr("y1", this.config.height - 20)
			.attr("x2", 20)
			.attr("y2", this.config.height - 20 - cornerSize)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
			
		// 右下角
		svg.append("line")
			.attr("x1", this.config.width - 20)
			.attr("y1", this.config.height - 20)
			.attr("x2", this.config.width - 20 - cornerSize)
			.attr("y2", this.config.height - 20)
			.attr("stroke", this.config.headerColor)
			.attr("stroke-width", 2);
		svg.append("line")
			.attr("x1", this.config.width - 20)
			.attr("y1", this.config.height - 20)
			.attr("x2", this.config.width - 20)
			.attr("y2", this.config.height - 20 - cornerSize)
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