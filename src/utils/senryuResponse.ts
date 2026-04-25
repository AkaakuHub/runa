import * as d3 from "d3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import type { SenryuDetectionResult } from "./senryuDetector";

const execFileAsync = promisify(execFile);
const brushFontFamily = "KouzanMouhituFont10";
let brushFontInstalledPromise: Promise<void> | null = null;

const sagePrefixes = [
	"ほっほっほ、五七五の気配、わしにはしかと見えたぞい。",
	"ふむ、これは川柳じゃな。そなたの言の葉、なかなか味わい深いぞ。",
	"ほう、風流な響きじゃ。わしが巻物にしたためておいたぞい。",
];

function pickSagePrefix(seed: string): string {
	let total = 0;
	for (const char of seed) {
		total += char.charCodeAt(0);
	}
	return sagePrefixes[total % sagePrefixes.length];
}

export function buildSenryuReply(
	result: SenryuDetectionResult,
	messageAuthorName: string,
): string {
	const quoted = result.segments.map((segment) => `　${segment}`).join("\n");

	return `${pickSagePrefix(result.reading)}
${messageAuthorName}殿、そなたの句をしかと拝見したぞ。

「
${quoted}
」

この響き、しばし庵に飾っておくとしよう。`;
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
		.attr("rx", 18)
		.attr("fill", "url(#paper-gradient)");

	svg
		.append("rect")
		.attr("width", width)
		.attr("height", height)
		.attr("rx", 18)
		.attr("filter", "url(#paper-noise)")
		.attr("opacity", 0.9);
}

function appendVerticalColumn(
	svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
	text: string,
	x: number,
	startY: number,
	fontSize: number,
	fill: string,
	letterSpacing: number,
): void {
	const chars = text.split("");
	chars.forEach((char, index) => {
		svg
			.append("text")
			.attr("x", x)
			.attr("y", startY + index * letterSpacing)
			.attr("font-family", brushFontFamily)
			.attr("font-size", fontSize)
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "central")
			.attr("fill", fill)
			.text(char);
	});
}

function appendSealText(
	svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
	text: string,
	x: number,
	y: number,
	fontSize: number,
	fill: string,
): void {
	const chars = text.split("");
	const letterSpacing = fontSize + 2;
	const startY = y - ((chars.length - 1) * letterSpacing) / 2;

	chars.forEach((char, index) => {
		svg
			.append("text")
			.attr("x", x)
			.attr("y", startY + index * letterSpacing)
			.attr("font-family", brushFontFamily)
			.attr("font-size", fontSize)
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "central")
			.attr("fill", fill)
			.text(char);
	});
}

function formatPoetName(poetName: string): string {
	const normalized = poetName.replace(/\s+/g, "").trim();
	if (!normalized) {
		return "名無し";
	}

	const chars = Array.from(normalized);
	return chars.length > 8 ? `${chars.slice(0, 7).join("")}…` : normalized;
}

function appendVerticalLabel(
	svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
	text: string,
	x: number,
	startY: number,
	fontSize: number,
	fill: string,
	letterSpacing: number,
): void {
	const chars = text.split("");
	chars.forEach((char, index) => {
		svg
			.append("text")
			.attr("x", x)
			.attr("y", startY + index * letterSpacing)
			.attr("font-family", brushFontFamily)
			.attr("font-size", fontSize)
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "central")
			.attr("fill", fill)
			.text(char);
	});
}

function appendPoetName(
	svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
	poetName: string,
	x: number,
	bottomY: number,
): void {
	const fontSize = 38;
	const letterSpacing = 45;
	const text = formatPoetName(poetName);
	const startY = bottomY - (Array.from(text).length - 1) * letterSpacing;

	appendVerticalLabel(svg, text, x, startY, fontSize, "#4d3a27", letterSpacing);
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
	poetName: string,
): Promise<Buffer> {
	await assertBrushFontInstalled();

	const width = 900;
	const height = 1400;
	const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");

	const svg = d3
		.select(dom.window.document.body)
		.append("svg")
		.attr("width", width)
		.attr("height", height)
		.attr("viewBox", `0 0 ${width} ${height}`)
		.attr("xmlns", "http://www.w3.org/2000/svg");

	createPaperTexture(svg, width, height);

	svg
		.append("rect")
		.attr("x", 38)
		.attr("y", 38)
		.attr("width", width - 76)
		.attr("height", height - 76)
		.attr("rx", 12)
		.attr("fill", "none")
		.attr("stroke", "#9c6f3a")
		.attr("stroke-width", 3)
		.attr("opacity", 0.65);

	appendVerticalColumn(svg, "川柳発見", width - 92, 130, 34, "#5b2e12", 44);

	const columnXs = [610, 450, 290];
	result.segments.forEach((segment, index) => {
		appendVerticalColumn(svg, segment, columnXs[index], 240, 90, "#16110d", 96);
	});

	const sealSize = 72;
	const sealX = 96;
	const sealY = height - 200;
	appendPoetName(svg, poetName, sealX + sealSize / 2, sealY - 36);

	svg
		.append("rect")
		.attr("x", sealX)
		.attr("y", sealY)
		.attr("width", sealSize)
		.attr("height", sealSize)
		.attr("rx", 8)
		.attr("fill", "#a11d1d")
		.attr("opacity", 0.92);

	appendSealText(
		svg,
		"仙人",
		sealX + sealSize / 2,
		sealY + sealSize / 2,
		25,
		"#fff4ea",
	);

	const svgContent = dom.window.document.body.innerHTML;
	return sharp(Buffer.from(svgContent)).png().toBuffer();
}
