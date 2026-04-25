import { MorphologyService } from "../services/MorphologyService";
import type { Morpheme } from "../services/MorphologyService";
import { hiraganaToKatakana, isKana, isSmallKana } from "./kana";
const TARGET_MORA = [5, 7, 5] as const;
const TARGET_TOTAL_MORA = TARGET_MORA.reduce((total, mora) => total + mora, 0);
const MAX_JIAMARI_SEGMENTS = 1;
const MAX_JIAMARI_PER_SEGMENT = 1;
const CLASSICAL_READING_OVERRIDES = new Map<string, string>([
	["庵", "イホ"],
	["荒み", "アラミ"],
]);

interface MoraToken {
	surface: string;
	reading: string;
	mora: number;
	partOfSpeech: string[];
}

interface SenryuCandidate {
	segments: string[];
	reading: string;
	score: number;
	tokenCount: number;
	start: number;
}

export interface SenryuDetectionResult {
	isSenryu: boolean;
	segments: string[];
	reading: string;
}

interface SenryuAnalyzeOptions {
	exact?: boolean;
}

interface SenryuAnalysisResult {
	isSenryu: boolean;
	result: SenryuDetectionResult | null;
	reason: string | null;
	sanitized: string;
	tokens: Morpheme[];
	totalMora: number;
	tokenReadings: string[];
}

function sanitizeMessageContent(text: string): string {
	return text
		.replace(/```[\s\S]*?```|```[\s\S]*$/g, " ")
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi, " ")
		.replace(/<a?:\w+:[\d-]+>/g, " ")
		.replace(/<[@#][!&]?\d+>/g, " ")
		.replace(/\s+/g, "")
		.trim();
}

function countMora(reading: string): number {
	let count = 0;
	for (const char of hiraganaToKatakana(reading)) {
		if (!isKana(char)) {
			continue;
		}
		if (isSmallKana(char) && count > 0) {
			continue;
		}
		count++;
	}
	return count;
}

function isIgnorableToken(token: {
	surface: string;
	partOfSpeech: string[];
}): boolean {
	if (!token.surface.trim()) {
		return true;
	}

	const majorPartOfSpeech = token.partOfSpeech[0];
	return majorPartOfSpeech === "空白" || majorPartOfSpeech === "補助記号";
}

function toMoraTokens(
	tokens: Array<{
		surface: string;
		reading: string;
		partOfSpeech: string[];
	}>,
): MoraToken[] {
	return tokens.flatMap((token) => {
		if (isIgnorableToken(token)) {
			return [];
		}

		const reading =
			CLASSICAL_READING_OVERRIDES.get(token.surface) ||
			token.reading ||
			token.surface;
		const mora = countMora(reading);
		if (mora === 0) {
			return [];
		}

		return [
			{
				surface: token.surface,
				reading: hiraganaToKatakana(reading),
				mora,
				partOfSpeech: token.partOfSpeech,
			},
		];
	});
}

function buildMoraPrefixSums(tokens: MoraToken[]): number[] {
	const prefixSums = [0];
	for (const token of tokens) {
		prefixSums.push(prefixSums[prefixSums.length - 1] + token.mora);
	}
	return prefixSums;
}

function sumMora(prefixSums: number[], start: number, end: number): number {
	return prefixSums[end] - prefixSums[start];
}

function buildSegment(tokens: MoraToken[], start: number, end: number): string {
	return tokens
		.slice(start, end)
		.map((token) => token.surface)
		.join("");
}

function buildReading(tokens: MoraToken[], start: number, end: number): string {
	return tokens
		.slice(start, end)
		.map((token) => token.reading)
		.join("");
}

function isAllowedMoraPattern(moraPattern: number[]): boolean {
	let jiamariSegments = 0;
	for (let index = 0; index < moraPattern.length; index++) {
		const diff = moraPattern[index] - TARGET_MORA[index];
		if (diff === 0) {
			continue;
		}
		if (diff < 0 || diff > MAX_JIAMARI_PER_SEGMENT) {
			return false;
		}
		jiamariSegments++;
	}

	return jiamariSegments <= MAX_JIAMARI_SEGMENTS;
}

function findBestSenryuCandidateForWindowRange(
	tokens: MoraToken[],
	prefixSums: number[],
	start: number,
	end: number,
): SenryuCandidate | null {
	let bestCandidate: SenryuCandidate | null = null;
	const totalMora = sumMora(prefixSums, start, end);
	if (totalMora < TARGET_TOTAL_MORA || totalMora > TARGET_TOTAL_MORA + 1) {
		return null;
	}

	for (let firstEnd = start + 1; firstEnd <= end - 2; firstEnd++) {
		for (let secondEnd = firstEnd + 1; secondEnd <= end - 1; secondEnd++) {
			const moraPattern = [
				sumMora(prefixSums, start, firstEnd),
				sumMora(prefixSums, firstEnd, secondEnd),
				sumMora(prefixSums, secondEnd, end),
			];

			if (!isAllowedMoraPattern(moraPattern)) {
				continue;
			}

			const score = moraPattern.reduce(
				(total, mora, index) => total + Math.abs(mora - TARGET_MORA[index]),
				0,
			);
			const candidate = {
				segments: [
					buildSegment(tokens, start, firstEnd),
					buildSegment(tokens, firstEnd, secondEnd),
					buildSegment(tokens, secondEnd, end),
				],
				reading: buildReading(tokens, start, end),
				score,
				tokenCount: end - start,
				start,
			};

			if (isBetterCandidate(candidate, bestCandidate)) {
				bestCandidate = candidate;
			}
		}
	}

	return bestCandidate;
}

function isBetterCandidate(
	candidate: SenryuCandidate,
	current: SenryuCandidate | null,
): boolean {
	if (!current) {
		return true;
	}

	if (candidate.score !== current.score) {
		return candidate.score < current.score;
	}

	if (candidate.start !== current.start) {
		return candidate.start < current.start;
	}

	return candidate.tokenCount > current.tokenCount;
}

function findBestSenryuCandidate(tokens: MoraToken[]): SenryuCandidate | null {
	let bestCandidate: SenryuCandidate | null = null;
	const prefixSums = buildMoraPrefixSums(tokens);
	const start = 0;

	for (let end = start + 3; end <= tokens.length; end++) {
		const candidate = findBestSenryuCandidateForWindowRange(
			tokens,
			prefixSums,
			start,
			end,
		);
		if (candidate && isBetterCandidate(candidate, bestCandidate)) {
			bestCandidate = candidate;
		}
	}

	return bestCandidate;
}

function findExactSenryuCandidate(tokens: MoraToken[]): SenryuCandidate | null {
	const prefixSums = buildMoraPrefixSums(tokens);
	return findBestSenryuCandidateForWindowRange(
		tokens,
		prefixSums,
		0,
		tokens.length,
	);
}

function hasExactMoraPattern(tokens: MoraToken[]): boolean {
	const prefixSums = buildMoraPrefixSums(tokens);
	for (let firstEnd = 1; firstEnd <= tokens.length - 2; firstEnd++) {
		for (
			let secondEnd = firstEnd + 1;
			secondEnd <= tokens.length - 1;
			secondEnd++
		) {
			const moraPattern = [
				sumMora(prefixSums, 0, firstEnd),
				sumMora(prefixSums, firstEnd, secondEnd),
				sumMora(prefixSums, secondEnd, tokens.length),
			];
			if (isAllowedMoraPattern(moraPattern)) {
				return true;
			}
		}
	}
	return false;
}

function buildFailureReason(tokens: MoraToken[], exact: boolean): string {
	const totalMora = tokens.reduce((total, token) => total + token.mora, 0);
	if (
		exact &&
		(totalMora < TARGET_TOTAL_MORA || totalMora > TARGET_TOTAL_MORA + 1)
	) {
		return `入力全体のモーラ数が ${totalMora} で、川柳の 17 モーラまたは一か所だけ字余りの 18 モーラではありません。`;
	}
	if (exact && !hasExactMoraPattern(tokens)) {
		return "入力全体を 5・7・5 の区切りに分割できません。";
	}
	return "5・7・5 として判定できませんでした。";
}

export async function analyzeSenryu(
	text: string,
	options: SenryuAnalyzeOptions = {},
): Promise<SenryuAnalysisResult> {
	const sanitized = sanitizeMessageContent(text);
	if (!sanitized || sanitized.length > 80) {
		return {
			isSenryu: false,
			result: null,
			reason: !sanitized
				? "判定できる本文がありません。"
				: "入力が長すぎます。80文字以内にしてください。",
			sanitized,
			tokens: [],
			totalMora: 0,
			tokenReadings: [],
		};
	}

	const morphologyService = MorphologyService.getInstance();
	const tokens = await morphologyService.analyze(sanitized);
	const moraTokens = toMoraTokens(tokens);
	if (moraTokens.length < 3) {
		const totalMora = moraTokens.reduce(
			(total, token) => total + token.mora,
			0,
		);
		return {
			isSenryu: false,
			result: null,
			reason:
				totalMora >= TARGET_TOTAL_MORA
					? "17モーラありますが、Sudachi の解析では 5・7・5 に区切れる語境界がありません。"
					: "川柳として区切るには語数が足りません。",
			sanitized,
			tokens,
			totalMora,
			tokenReadings: moraTokens.map((token) => token.reading),
		};
	}

	const candidate = options.exact
		? findExactSenryuCandidate(moraTokens)
		: findBestSenryuCandidate(moraTokens);
	if (!candidate) {
		return {
			isSenryu: false,
			result: null,
			reason: buildFailureReason(moraTokens, options.exact ?? false),
			sanitized,
			tokens,
			totalMora: moraTokens.reduce((total, token) => total + token.mora, 0),
			tokenReadings: moraTokens.map((token) => token.reading),
		};
	}

	const result = {
		isSenryu: true,
		segments: candidate.segments,
		reading: candidate.reading,
	};

	return {
		isSenryu: true,
		result,
		reason: null,
		sanitized,
		tokens,
		totalMora: moraTokens.reduce((total, token) => total + token.mora, 0),
		tokenReadings: moraTokens.map((token) => token.reading),
	};
}

export async function detectSenryu(
	text: string,
): Promise<SenryuDetectionResult | null> {
	const analysis = await analyzeSenryu(text);
	return analysis.result;
}
