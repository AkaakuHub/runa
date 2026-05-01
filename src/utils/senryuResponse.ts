import * as d3 from "d3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import type { SenryuDetectionResult } from "./senryuDetector";

const execFileAsync = promisify(execFile);
const brushFontFamily = "KouzanMouhituFont10";
const imageFontSize = 64;
const imageHorizontalPadding = 36;
const imageHeight = 112;
let brushFontInstalledPromise: Promise<void> | null = null;

function formatSenryuText(result: SenryuDetectionResult): string {
	return result.segments.join("　");
}

export function buildSenryuReply(result: SenryuDetectionResult): string {
	return `ふむ、これは川柳じゃな。\n「${formatSenryuText(result)}」`;
}

function createPaperTexture(
	svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
	width: number,
	height: number,
): void {
	const defs = svg.append("defs");

	const gradient = defs
		.append("linearGradient")
		.attr("id", "paper-gradient")
		.attr("x1", "0%")
		.attr("y1", "0%")
		.attr("x2", "100%")
		.attr("y2", "100%");

	gradient.append("stop").attr("offset", "0%").attr("stop-color", "#f7f1df");
	gradient.append("stop").attr("offset", "60%").attr("stop-color", "#efe4c8");
	gradient.append("stop").attr("offset", "100%").attr("stop-color", "#e8d8b5");

	const filter = defs
		.append("filter")
		.attr("id", "paper-noise")
		.attr("x", "0%")
		.attr("y", "0%")
		.attr("width", "100%")
		.attr("height", "100%");

	filter
		.append("feTurbulence")
		.attr("type", "fractalNoise")
		.attr("baseFrequency", "0.85")
		.attr("numOctaves", 2)
		.attr("seed", 7)
		.attr("result", "noise");

	filter
		.append("feColorMatrix")
		.attr("in", "noise")
		.attr("type", "matrix")
		.attr("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.045 0");

	svg
		.append("rect")
		.attr("width", width)
		.attr("height", height)
		.attr("rx", 12)
		.attr("fill", "url(#paper-gradient)");

	svg
		.append("rect")
		.attr("width", width)
		.attr("height", height)
		.attr("rx", 12)
		.attr("filter", "url(#paper-noise)")
		.attr("opacity", 0.9);
}

function appendHorizontalText(
	svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
	text: string,
	x: number,
	y: number,
	fontSize: number,
	fill: string,
): void {
	svg
		.append("text")
		.attr("x", x)
		.attr("y", y)
		.attr("font-family", brushFontFamily)
		.attr("font-size", fontSize)
		.attr("text-anchor", "middle")
		.attr("dominant-baseline", "central")
		.attr("fill", fill)
		.text(text);
}

function estimateTextUnits(text: string): number {
	return Array.from(text).reduce((total, char) => {
		if (/[\x20-\x7e]/.test(char)) {
			return total + 0.55;
		}

		if (char === "　") {
			return total + 0.75;
		}

		return total + 1;
	}, 0);
}

function calculateImageWidth(text: string): number {
	const textWidth = Math.ceil(estimateTextUnits(text) * imageFontSize);
	return Math.max(520, textWidth + imageHorizontalPadding * 2);
}

async function assertBrushFontInstalled(): Promise<void> {
	if (brushFontInstalledPromise) {
		return brushFontInstalledPromise;
	}

	brushFontInstalledPromise = assertBrushFontInstalledOnce();
	return brushFontInstalledPromise;
}

async function assertBrushFontInstalledOnce(): Promise<void> {
	const { stdout } = await execFileAsync("fc-match", [brushFontFamily]);
	if (!stdout.includes("KouzanMouhituFont10.ttf")) {
		throw new Error(
			`Required senryu brush font is not installed: ${brushFontFamily}`,
		);
	}
}

export async function generateSenryuImage(
	result: SenryuDetectionResult,
): Promise<Buffer> {
	await assertBrushFontInstalled();

	const senryuText = formatSenryuText(result);
	const width = calculateImageWidth(senryuText);
	const height = imageHeight;
	const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");

	const svg = d3
		.select(dom.window.document.body)
		.append("svg")
		.attr("width", width)
		.attr("height", height)
		.attr("viewBox", `0 0 ${width} ${height}`)
		.attr("xmlns", "http://www.w3.org/2000/svg");

	createPaperTexture(svg, width, height);

	appendHorizontalText(
		svg,
		senryuText,
		width / 2,
		height / 2,
		imageFontSize,
		"#16110d",
	);

	const svgContent = dom.window.document.body.innerHTML;
	return sharp(Buffer.from(svgContent)).png().toBuffer();
}
