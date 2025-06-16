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
	height: 1600,
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

/**
 * CSSスタイルシート
 * SVG内のスタイルを一元管理します。
 */
const STYLESHEET = (config: NewspaperConfig) => `
	@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700;900&family=Noto+Serif+JP:wght@400;700&display=swap');

	.newspaper-bg {
		fill: ${config.backgroundColor};
	}

	.decoration-path-1 { fill: rgba(0,0,0,0.05); }
	.decoration-path-2 { fill: rgba(0,0,0,0.05); }

	/* --- タイトル --- */
	.title-block-bg {
		fill: ${config.accentColor};
	}
	.newspaper-title {
		fill: white;
		font-family: ${config.fontFamilyMincho};
		font-size: 48px;
		font-weight: bold;
		writing-mode: vertical-rl;
		text-orientation: upright;
		letter-spacing: 10px;
	}
	.date-vertical {
		fill: ${config.textColor};
		font-family: ${config.fontFamilyGothic};
		font-size: 14px;
		writing-mode: vertical-rl;
	}

	/* --- メイン特集 --- */
	.main-title {
		fill: ${config.textColor};
		font-family: ${config.fontFamilyGothic};
		font-size: 100px;
		font-weight: 900;
	}
	.main-title tspan {
		dominant-baseline: central;
	}
	.main-feature-date {
		text-anchor: end;
		fill: ${config.textColor};
		font-family: ${config.fontFamilyMincho};
		font-size: 40px;
		font-weight: bold;
	}

	/* --- 記事 --- */
	.article-title {
		fill: ${config.textColor};
		font-family: ${config.fontFamilyGothic};
		font-size: 32px;
		font-weight: bold;
	}
	.article-divider {
		stroke: ${config.accentColor};
		stroke-width: 3;
	}
	.article-body {
		font-family: ${config.fontFamilyMincho};
		font-size: 16px;
		line-height: 1.9;
		color: ${config.textColor};
		white-space: pre-wrap;
		overflow-wrap: break-word; /* 文字の自動改行でレイアウト崩れを防ぐ */
		word-wrap: break-word;      /* 旧ブラウザ用 */
	}

	/* --- フッター --- */
	.footer-text {
		text-anchor: middle;
		font-family: ${config.fontFamilyGothic};
		font-size: 12px;
		fill: #888;
	}
`;


export class NewspaperImageGenerator {
	private config: NewspaperConfig;
	private layout: {
		padding: number;
		headerTop: number;
		mainFeatureTop: number;
		articlesTop: number;
		footerBottom: number;
		columnGap: number;
	};


	constructor(config: Partial<NewspaperConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.layout = {
			padding: 60,
			headerTop: 60,
			mainFeatureTop: 180,
			articlesTop: 700,
			footerBottom: 40,
			columnGap: 50,
		};
	}

	/**
	 * マークダウン風テキストから新聞画像を生成します。
	 * @param summaryText 解析するテキストソース
	 * @returns 生成された画像のBuffer
	 */
	async generateImage(summaryText: string): Promise<Buffer> {
		const content = this.parseSummaryText(summaryText);
		const svgString = this.generateSVG(content);
		return this.svgToPng(svgString);
	}

	/**
	 * テキストを解析して各コンテンツに振り分ける（変更なし）
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
			if (trimmedLine.startsWith('📰') && trimmedLine.includes('**')) {
				const titleMatch = trimmedLine.match(/\*\*(.*?)\*\*/);
				if (titleMatch) content.mainTitle = titleMatch[1].trim();
			} else if (trimmedLine.startsWith('🔸') && trimmedLine.includes('**')) {
				if (currentArticle) content.articles.push(currentArticle);
				const titleMatch = trimmedLine.match(/\*\*(.*?)\*\*/);
				if (titleMatch) currentArticle = { title: titleMatch[1].trim(), content: '' };
			} else if (trimmedLine.startsWith('📌') && trimmedLine.includes('**')) {
				if (currentArticle) content.articles.push(currentArticle);
				const titleMatch = trimmedLine.match(/\*\*(.*?)\*\*/);
				if (titleMatch) currentArticle = { title: `🌟 ${titleMatch[1].trim()}`, content: '' };
			} else if (currentArticle && trimmedLine !== '' && !trimmedLine.startsWith('📰') && !trimmedLine.startsWith('🔸') && !trimmedLine.startsWith('📌')) {
				currentArticle.content += (currentArticle.content ? '\n' : '') + trimmedLine;
			}
		}
		if (currentArticle) content.articles.push(currentArticle);
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
			.text(STYLESHEET(this.config));

		// 背景
		svg.append("rect")
			.attr("width", this.config.width)
			.attr("height", this.config.height)
			.attr("class", "newspaper-bg");

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
			.attr("class", "decoration-path-1");

		svg.append("path")
			.attr("d", `M 0 ${this.config.height - 400} L 0 ${this.config.height} L 500 ${this.config.height} Z`)
			.attr("class", "decoration-path-2");
	}

	private drawTitleBlock(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, newspaperTitle: string): void {
		const titleGroup = svg.append("g")
			.attr("transform", `translate(${this.config.width - 80}, ${this.layout.headerTop})`);

		titleGroup.append("rect")
			.attr("x", -30)
			.attr("y", 0)
			.attr("width", 60)
			.attr("height", 320)
			.attr("class", "title-block-bg");

		titleGroup.append("text")
			.attr("class", "newspaper-title")
			.attr("x", 0)
			.attr("y", 20)
			.text(newspaperTitle);

		const date = new Date();
		const dateString = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
		titleGroup.append("text")
			.attr("class", "date-vertical")
			.attr("x", 40)
			.attr("y", 20)
			.text(dateString);
	}

	private drawMainFeature(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, content: NewspaperContent): void {
		const mainGroup = svg.append("g")
			.attr("transform", `translate(${this.layout.padding}, ${this.layout.mainFeatureTop})`);

		mainGroup.append("text")
			.attr("class", "main-title")
			.selectAll("tspan")
			.data(content.mainTitle.split(" "))
			.enter()
			.append("tspan")
			.attr("x", 0)
			.attr("dy", "1.1em")
			.text(d => d);

		const date = new Date();
		const dateString = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

		svg.append("text")
			.attr("class", "main-feature-date")
			.attr("transform", `translate(${this.config.width - this.layout.padding}, 450)`)
			.text(dateString);
	}

	private drawArticles(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, articles: Array<{ title: string; content: string }>): void {
		const startX = this.layout.padding;
		const startY = this.layout.articlesTop;
		const availableWidth = this.config.width - (this.layout.padding * 2);
		const numColumns = Math.max(articles.length, 1); // 記事がなくても1として計算
		const columnWidth = (availableWidth - (this.layout.columnGap * (numColumns - 1))) / numColumns;
		// 記事数が多くなりすぎるとカラム幅が狭くなるため、上限を設けることを推奨
		// const maxColumns = 4;
		// const numColumns = Math.min(articles.length, maxColumns);

		articles.forEach((article, i) => {
			const x = startX + i * (columnWidth + this.layout.columnGap);
			const g = svg.append("g").attr("transform", `translate(${x}, ${startY})`);

			g.append("text")
				.attr("class", "article-title")
				.attr("x", 0)
				.attr("y", 0)
				.text(`“${article.title}”`);

			g.append("line")
				.attr("class", "article-divider")
				.attr("x1", 0).attr("y1", 25)
				.attr("x2", 80).attr("y2", 25);

			const foreignObjectHeight = this.config.height - startY - this.layout.footerBottom - 50;
			g.append("foreignObject")
				.attr("x", 0).attr("y", 50)
				.attr("width", columnWidth)
				.attr("height", foreignObjectHeight)
				.append("xhtml:div")
				.attr("xmlns", "http://www.w3.org/1999/xhtml")
				.attr("class", "article-body")
				.html(article.content);
		});
	}

	private drawFooter(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
		svg.append("g")
			.attr("transform", `translate(${this.config.width / 2}, ${this.config.height - this.layout.footerBottom})`)
			.append("text")
			.attr("class", "footer-text")
			.text("面影新聞社 編集部");
	}

	private async svgToPng(svgString: string): Promise<Buffer> {
		return sharp(Buffer.from(svgString)).png().toBuffer();
	}
}