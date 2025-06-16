import * as d3 from "d3";
import { JSDOM } from "jsdom";
import { Buffer } from "node:buffer";
import sharp from "sharp"; // SVGからPNGへの変換に必要

// --- 設定 ---
interface NewspaperConfig {
	width: number;
	height: number;
	backgroundColor: string;
	textColor: string;
	accentColor: string;
	fontFamilyGothic: string;
	fontFamilyMincho: string;
}

const DEFAULT_CONFIG: NewspaperConfig = {
	width: 1200,
	height: 1600, // 画像がないため高さを調整
	backgroundColor: "#f4f2ef",
	textColor: "#1a1a1a",
	accentColor: "#000000",
	fontFamilyGothic: "'Noto Sans JP', sans-serif",
	fontFamilyMincho: "'Noto Serif JP', serif",
};

// --- テキスト解析結果の型定義 ---
interface NewspaperContent {
	mainTitle: string;
	subTitle: string;
	personName: string;
	articles: Array<{ title: string; content: string }>;
}

export class NewspaperImageGenerator {
	private config: NewspaperConfig;

	constructor(config: Partial<NewspaperConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * マークダウン風テキストから新聞画像を生成します。
	 * @param summaryText 解析するテキストソース
	 * @returns 生成された画像のBuffer
	 */
	async generateImage(summaryText: string): Promise<Buffer> {
		const content = this.parseSummaryText(summaryText);
		const svgString = this.generateSVG(content);
		return await this.svgToPng(svgString);
	}

	/**
	 * テキストを解析して各コンテンツに振り分ける
	 * @param text - 解析対象の文字列
	 * 書式ルール：
	 * 📰 **今日のサーバーニュース** （メインタイトル）
	 * 🔸 **トピックタイトル** （記事タイトル）
	 * 要約内容 （記事本文）
	 */
	private parseSummaryText(text: string): NewspaperContent {
		const lines = text.split('\n').filter(line => line.trim() !== '');
		const content: NewspaperContent = {
			mainTitle: "今日のサーバーニュース",
			subTitle: "Daily Server News",
			personName: "",
			articles: [],
		};
		let currentArticle: { title: string; content: string } | null = null;

		for (const line of lines) {
			const trimmedLine = line.trim();

			// メインタイトルを抽出（📰 **タイトル** 形式）
			if (trimmedLine.startsWith('📰') && trimmedLine.includes('**')) {
				const titleMatch = trimmedLine.match(/\*\*(.*?)\*\*/);
				if (titleMatch) {
					content.mainTitle = titleMatch[1].trim();
				}
			}
			// 記事タイトルを抽出（🔸 **タイトル** 形式）
			else if (trimmedLine.startsWith('🔸') && trimmedLine.includes('**')) {
				if (currentArticle) {
					content.articles.push(currentArticle);
				}
				const titleMatch = trimmedLine.match(/\*\*(.*?)\*\*/);
				if (titleMatch) {
					currentArticle = { title: titleMatch[1].trim(), content: '' };
				}
			}
			// 📌 イチオシニュース（特別記事として扱う）
			else if (trimmedLine.startsWith('📌') && trimmedLine.includes('**')) {
				if (currentArticle) {
					content.articles.push(currentArticle);
				}
				const titleMatch = trimmedLine.match(/\*\*(.*?)\*\*/);
				if (titleMatch) {
					currentArticle = { title: `🌟 ${titleMatch[1].trim()}`, content: '' };
				}
			}
			// 記事の本文（空行でない、かつ絵文字やタイトル行でない場合）
			else if (currentArticle && trimmedLine !== '' &&
				!trimmedLine.startsWith('📰') &&
				!trimmedLine.startsWith('🔸') &&
				!trimmedLine.startsWith('📌')) {
				currentArticle.content += (currentArticle.content ? '\n' : '') + trimmedLine;
			}
		}

		// 最後の記事を追加
		if (currentArticle) {
			content.articles.push(currentArticle);
		}

		return content;
	}

	private generateSVG(content: NewspaperContent): string {
		const dom = new JSDOM();
		const document = dom.window.document;

		const svg = d3.select(document.body)
			.append("svg")
			.attr("width", this.config.width)
			.attr("height", this.config.height)
			.attr("xmlns", "http://www.w3.org/2000/svg");

		svg.append("defs")
			.append("style")
			.text(`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700;900&family=Noto+Serif+JP:wght@400;700&display=swap');
      `);

		// 背景とレイアウト
		svg.append("rect")
			.attr("width", this.config.width)
			.attr("height", this.config.height)
			.attr("fill", this.config.backgroundColor);

		this.drawLayoutDecorations(svg);
		this.drawTitleBlock(svg, "面影新聞");
		this.drawMainFeature(svg, content);
		this.drawArticles(svg, content.articles);
		this.drawFooter(svg);

		return document.body.innerHTML;
	}

	private drawLayoutDecorations(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		svg.append("path")
			.attr("d", `M ${this.config.width - 600} 0 L ${this.config.width} 0 L ${this.config.width} 800 Z`)
			.attr("fill", "rgba(0,0,0,0.05)");

		svg.append("path")
			.attr("d", `M 0 ${this.config.height - 400} L 0 ${this.config.height} L 500 ${this.config.height} Z`)
			.attr("fill", "rgba(0,0,0,0.05)");
	}

	private drawTitleBlock(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, newspaperTitle: string): void {
		const titleGroup = svg.append("g")
			.attr("transform", `translate(${this.config.width - 80}, 60)`);

		titleGroup.append("rect")
			.attr("x", -30)
			.attr("y", 0)
			.attr("width", 60)
			.attr("height", 320)
			.attr("fill", this.config.accentColor);

		titleGroup.append("text")
			.attr("fill", "white")
			.attr("font-family", this.config.fontFamilyMincho)
			.attr("font-size", "48px")
			.attr("font-weight", "bold")
			.style("writing-mode", "vertical-rl")
			.style("text-orientation", "upright")
			.style("letter-spacing", "10px")
			.attr("x", 0)
			.attr("y", 20)
			.text(newspaperTitle);

		const date = new Date();
		const dateString = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
		titleGroup.append("text")
			.attr("fill", this.config.textColor)
			.attr("font-family", this.config.fontFamilyGothic)
			.attr("font-size", "14px")
			.style("writing-mode", "vertical-rl")
			.attr("x", 40)
			.attr("y", 20)
			.text(dateString);
	}

	private drawMainFeature(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, content: NewspaperContent): void {
		const mainGroup = svg.append("g").attr("transform", "translate(60, 180)");

		mainGroup.append("text")
			.attr("x", 0)
			.attr("y", 0)
			.attr("fill", this.config.textColor)
			.attr("font-family", this.config.fontFamilyGothic)
			.attr("font-size", "100px")
			.attr("font-weight", "900")
			.selectAll("tspan")
			.data(content.mainTitle.split(" "))
			.enter()
			.append("tspan")
			.attr("x", 0)
			.attr("dy", "1.1em")
			.text(d => d);

		// サブタイトルを右側に配置（今日の日付）
		const rightSideGroup = svg.append("g")
			.attr("transform", `translate(${this.config.width - 60}, 450)`);

		const date = new Date();
		const dateString = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

		rightSideGroup.append("text")
			.attr("text-anchor", "end")
			.attr("fill", this.config.textColor)
			.attr("font-family", this.config.fontFamilyMincho)
			.attr("font-size", "40px")
			.attr("font-weight", "bold")
			.text(dateString);
	}

	private drawArticles(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, articles: Array<{ title: string; content: string }>): void {
		const startX = 60;
		const startY = 700; // Y座標を上に調整
		const availableWidth = this.config.width - 120;
		const numColumns = articles.length > 0 ? articles.length : 1;
		const columnGap = 50;
		const columnWidth = (availableWidth - (columnGap * (numColumns - 1))) / numColumns;

		articles.forEach((article, i) => {
			const x = startX + i * (columnWidth + columnGap);
			const g = svg.append("g").attr("transform", `translate(${x}, ${startY})`);

			g.append("text")
				.attr("x", 0)
				.attr("y", 0)
				.attr("fill", this.config.textColor)
				.attr("font-family", this.config.fontFamilyGothic)
				.attr("font-size", "32px")
				.attr("font-weight", "bold")
				.text(`“${article.title}”`);

			g.append("line")
				.attr("x1", 0).attr("y1", 25)
				.attr("x2", 80).attr("y2", 25)
				.attr("stroke", this.config.accentColor)
				.attr("stroke-width", 3);

			const foreignObject = g.append("foreignObject")
				.attr("x", 0).attr("y", 50)
				.attr("width", columnWidth)
				.attr("height", this.config.height - startY - 150);

			foreignObject.append("xhtml:div")
				.style("font-family", this.config.fontFamilyMincho)
				.style("font-size", "16px")
				.style("line-height", "1.9")
				.style("color", this.config.textColor)
				.style("white-space", "pre-wrap") // 改行を反映させる
				.html(`<p>${article.content}</p>`);
		});
	}

	private drawFooter(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		const footerGroup = svg.append("g")
			.attr("transform", `translate(${this.config.width / 2}, ${this.config.height - 40})`);

		footerGroup.append("text")
			.attr("text-anchor", "middle")
			.attr("font-family", this.config.fontFamilyGothic)
			.attr("font-size", "12px")
			.attr("fill", "#888")
			.text("面影新聞社 編集部");
	}

	private async svgToPng(svgString: string): Promise<Buffer> {
		return await sharp(Buffer.from(svgString)).png().toBuffer();
	}
}
