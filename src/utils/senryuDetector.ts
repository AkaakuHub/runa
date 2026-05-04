import { MorphologyService } from "../services/MorphologyService";
import type { Morpheme } from "../services/MorphologyService";
import { hiraganaToKatakana, isKana, isSmallKana } from "./kana";
const TARGET_MORA = [5, 7, 5] as const;
const TARGET_TOTAL_MORA = TARGET_MORA.reduce((total, mora) => total + mora, 0);

interface MoraToken {
	surface: string;
	reading: string;
	mora: number;
	partOfSpeech: string[];
	dictionaryForm: string;
}

interface SenryuCandidate {
	segments: string[];
	reading: string;
	moraDistance: number;
	qualityScore: number;
	qualityReasons: string[];
	tokenCount: number;
	start: number;
	end: number;
}

export interface SenryuDetectionResult {
	isSenryu: boolean;
	segments: string[];
	reading: string;
	qualityScore: number;
	qualityReasons: string[];
}

interface SenryuAnalyzeOptions {
	exact?: boolean;
	qualityThreshold?: number;
}

interface SenryuAnalysisResult {
	isSenryu: boolean;
	result: SenryuDetectionResult | null;
	reason: string | null;
	sanitized: string;
	tokens: Morpheme[];
	totalMora: number;
	tokenReadings: string[];
	qualityScore: number | null;
	qualityReasons: string[];
}

const DEFAULT_QUALITY_THRESHOLD = 75;

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
		dictionaryForm: string;
	}>,
): MoraToken[] {
	return tokens.flatMap((token) => {
		if (isIgnorableToken(token)) {
			return [];
		}

		const reading = token.reading || token.surface;
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
				dictionaryForm: token.dictionaryForm,
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
	return moraPattern.every((mora, index) => mora === TARGET_MORA[index]);
}

function isIncompleteSegmentEnd(token: MoraToken): boolean {
	const majorPartOfSpeech = token.partOfSpeech[0] ?? "";
	const conjugationForm = token.partOfSpeech[5] ?? "";
	const isIncompleteForm = /未然形|連用形/.test(conjugationForm);

	if (majorPartOfSpeech === "助動詞" && isIncompleteForm) {
		return true;
	}

	return majorPartOfSpeech === "動詞" && isIncompleteForm;
}

function isIncompleteSegmentEndWithNext(
	token: MoraToken,
	nextToken: MoraToken | undefined,
): boolean {
	if (!isIncompleteSegmentEnd(token)) {
		return false;
	}

	if (token.partOfSpeech[0] === "動詞") {
		if (!nextToken) {
			return false;
		}
		const nextMajorPartOfSpeech = nextToken.partOfSpeech[0] ?? "";
		return ["助詞", "助動詞"].includes(nextMajorPartOfSpeech);
	}

	if (!nextToken) {
		return false;
	}

	return true;
}

function isInvalidSegmentStart(token: MoraToken): boolean {
	const majorPartOfSpeech = token.partOfSpeech[0] ?? "";
	return ["助詞", "助動詞", "接尾辞"].includes(majorPartOfSpeech);
}

function isInvalidSegmentEnd(token: MoraToken): boolean {
	const majorPartOfSpeech = token.partOfSpeech[0] ?? "";
	return ["接頭辞", "連体詞", "接続詞"].includes(majorPartOfSpeech);
}

function hasContentToken(
	tokens: MoraToken[],
	start: number,
	end: number,
): boolean {
	return tokens.slice(start, end).some((token) => {
		const majorPartOfSpeech = token.partOfSpeech[0] ?? "";
		return [
			"名詞",
			"動詞",
			"形容詞",
			"形状詞",
			"副詞",
			"感動詞",
			"連体詞",
		].includes(majorPartOfSpeech);
	});
}

function isInvalidCandidateStart(
	token: MoraToken,
	nextToken: MoraToken | undefined,
): boolean {
	return (
		isInvalidSegmentStart(token) ||
		isIncompleteSegmentEndWithNext(token, nextToken)
	);
}

function hasAsciiDigitToken(
	tokens: MoraToken[],
	start: number,
	end: number,
): boolean {
	return tokens
		.slice(start, end)
		.some((token) => /[0-9０-９]/.test(token.surface));
}

function clampQualityScore(score: number): number {
	return Math.max(0, Math.min(100, score));
}

function isMajorPartOfSpeech(
	token: MoraToken | undefined,
	partOfSpeech: string,
): boolean {
	return token?.partOfSpeech[0] === partOfSpeech;
}

function isNounLikeToken(token: MoraToken | undefined): boolean {
	if (!token) {
		return false;
	}

	const majorPartOfSpeech = token.partOfSpeech[0] ?? "";
	const subPartOfSpeech = token.partOfSpeech[1] ?? "";
	return (
		majorPartOfSpeech === "名詞" ||
		subPartOfSpeech === "固有名詞" ||
		subPartOfSpeech === "代名詞"
	);
}

function isPredicativeToken(token: MoraToken | undefined): boolean {
	if (!token) {
		return false;
	}

	return ["動詞", "形容詞", "形状詞"].includes(token.partOfSpeech[0] ?? "");
}

function isWeakEndingToken(token: MoraToken | undefined): boolean {
	if (!token) {
		return false;
	}

	return ["助詞", "助動詞", "接尾辞"].includes(token.partOfSpeech[0] ?? "");
}

function getContentMajorParts(tokens: MoraToken[]): string[] {
	return tokens
		.map((token) => token.partOfSpeech[0] ?? "")
		.filter((partOfSpeech) =>
			["名詞", "動詞", "形容詞", "形状詞", "副詞", "感動詞"].includes(
				partOfSpeech,
			),
		);
}

function scoreSegmentEnding(token: MoraToken | undefined): number {
	if (isNounLikeToken(token)) {
		return 6;
	}
	if (isPredicativeToken(token)) {
		return 3;
	}
	if (isWeakEndingToken(token)) {
		return -8;
	}
	return 0;
}

function evaluateSenryuQuality(
	tokens: MoraToken[],
	start: number,
	firstEnd: number,
	secondEnd: number,
	end: number,
): Pick<SenryuCandidate, "qualityScore" | "qualityReasons"> {
	let score = 50;
	const reasons: string[] = [];
	const candidateTokens = tokens.slice(start, end);
	const finalToken = tokens[end - 1];

	if (isNounLikeToken(finalToken)) {
		score += 25;
		reasons.push("終句が名詞系で余韻がある");
	} else if (isPredicativeToken(finalToken)) {
		score += 8;
		reasons.push("終句が述語で閉じている");
	} else if (isWeakEndingToken(finalToken)) {
		score -= 25;
		reasons.push("終句が助詞・助動詞系で弱い");
	}

	const segmentEnds = [
		tokens[firstEnd - 1],
		tokens[secondEnd - 1],
		tokens[end - 1],
	];
	const segmentEndingScore = segmentEnds.reduce(
		(total, token) => total + scoreSegmentEnding(token),
		0,
	);
	score += segmentEndingScore;
	if (segmentEndingScore > 0) {
		reasons.push("句末の切れが比較的よい");
	} else if (segmentEndingScore < 0) {
		reasons.push("句末に弱い品詞が多い");
	}

	const contentMajorParts = getContentMajorParts(candidateTokens);
	const uniqueContentMajorParts = new Set(contentMajorParts);
	if (uniqueContentMajorParts.size >= 3) {
		score += 8;
		reasons.push("内容語の変化がある");
	} else if (uniqueContentMajorParts.size <= 1) {
		score -= 10;
		reasons.push("内容語の変化が少ない");
	}

	const functionTokenCount = candidateTokens.filter((token) =>
		["助詞", "助動詞"].includes(token.partOfSpeech[0] ?? ""),
	).length;
	const functionTokenRatio = functionTokenCount / candidateTokens.length;
	if (functionTokenRatio >= 0.45) {
		score -= 12;
		reasons.push("助詞・助動詞の比率が高い");
	}

	const outsideMora =
		tokens.slice(0, start).reduce((total, token) => total + token.mora, 0) +
		tokens.slice(end).reduce((total, token) => total + token.mora, 0);
	if (outsideMora === 0) {
		score += 12;
		reasons.push("本文全体が5・7・5に収まる");
	}

	if (
		candidateTokens.some((token) =>
			["です", "ます", "でした", "ました"].includes(token.dictionaryForm),
		)
	) {
		score -= 10;
		reasons.push("説明文調の語尾を含む");
	}

	if (
		candidateTokens.some(
			(token) =>
				isMajorPartOfSpeech(token, "接続詞") ||
				["そして", "だから", "しかし"].includes(token.dictionaryForm),
		)
	) {
		score -= 8;
		reasons.push("散文的な接続表現を含む");
	}

	return {
		qualityScore: clampQualityScore(score),
		qualityReasons: reasons,
	};
}

function hasInvalidSegmentBoundary(
	tokens: MoraToken[],
	firstEnd: number,
	secondEnd: number,
	end: number,
): boolean {
	const firstLastToken = tokens[firstEnd - 1];
	const secondLastToken = tokens[secondEnd - 1];
	const thirdLastToken = tokens[end - 1];
	const firstNextToken = tokens[firstEnd];
	const secondNextToken = tokens[secondEnd];
	const thirdNextToken = tokens[end];
	const secondFirstToken = tokens[firstEnd];
	const thirdFirstToken = tokens[secondEnd];
	return (
		!!firstLastToken &&
		!!secondLastToken &&
		!!secondFirstToken &&
		!!thirdFirstToken &&
		(isIncompleteSegmentEndWithNext(firstLastToken, firstNextToken) ||
			isIncompleteSegmentEndWithNext(secondLastToken, secondNextToken) ||
			isIncompleteSegmentEndWithNext(thirdLastToken, thirdNextToken) ||
			isInvalidSegmentEnd(firstLastToken) ||
			isInvalidSegmentEnd(secondLastToken) ||
			isInvalidSegmentEnd(thirdLastToken) ||
			isInvalidSegmentStart(secondFirstToken) ||
			isInvalidSegmentStart(thirdFirstToken))
	);
}

function findBestSenryuCandidateForWindowRange(
	tokens: MoraToken[],
	prefixSums: number[],
	start: number,
	end: number,
): SenryuCandidate | null {
	let bestCandidate: SenryuCandidate | null = null;
	const totalMora = sumMora(prefixSums, start, end);
	if (totalMora !== TARGET_TOTAL_MORA) {
		return null;
	}
	if (hasAsciiDigitToken(tokens, start, end)) {
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
			if (hasInvalidSegmentBoundary(tokens, firstEnd, secondEnd, end)) {
				continue;
			}
			if (
				!hasContentToken(tokens, start, firstEnd) ||
				!hasContentToken(tokens, firstEnd, secondEnd) ||
				!hasContentToken(tokens, secondEnd, end)
			) {
				continue;
			}

			const moraDistance = moraPattern.reduce(
				(total, mora, index) => total + Math.abs(mora - TARGET_MORA[index]),
				0,
			);
			const quality = evaluateSenryuQuality(
				tokens,
				start,
				firstEnd,
				secondEnd,
				end,
			);
			const candidate = {
				segments: [
					buildSegment(tokens, start, firstEnd),
					buildSegment(tokens, firstEnd, secondEnd),
					buildSegment(tokens, secondEnd, end),
				],
				reading: buildReading(tokens, start, end),
				moraDistance,
				qualityScore: quality.qualityScore,
				qualityReasons: quality.qualityReasons,
				tokenCount: end - start,
				start,
				end,
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

	if (candidate.qualityScore !== current.qualityScore) {
		return candidate.qualityScore > current.qualityScore;
	}

	if (candidate.moraDistance !== current.moraDistance) {
		return candidate.moraDistance < current.moraDistance;
	}

	if (candidate.start !== current.start) {
		return candidate.start < current.start;
	}

	return candidate.tokenCount > current.tokenCount;
}

function findBestSenryuCandidate(tokens: MoraToken[]): SenryuCandidate | null {
	const prefixSums = buildMoraPrefixSums(tokens);
	let bestCandidate: SenryuCandidate | null = null;

	for (let start = 0; start <= tokens.length - 3; start++) {
		if (isInvalidCandidateStart(tokens[start], tokens[start + 1])) {
			continue;
		}

		let bestCandidateForStart: SenryuCandidate | null = null;
		for (let end = start + 3; end <= tokens.length; end++) {
			const candidate = findBestSenryuCandidateForWindowRange(
				tokens,
				prefixSums,
				start,
				end,
			);
			if (candidate && isBetterCandidate(candidate, bestCandidateForStart)) {
				bestCandidateForStart = candidate;
			}
		}

		if (
			bestCandidateForStart &&
			isBetterCandidate(bestCandidateForStart, bestCandidate)
		) {
			bestCandidate = bestCandidateForStart;
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
	if (exact && totalMora !== TARGET_TOTAL_MORA) {
		return `入力全体のモーラ数が ${totalMora} で、川柳の 17 モーラではありません。`;
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
			qualityScore: null,
			qualityReasons: [],
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
			qualityScore: null,
			qualityReasons: [],
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
			qualityScore: null,
			qualityReasons: [],
		};
	}

	const qualityThreshold =
		options.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD;
	const result = {
		isSenryu: true,
		segments: candidate.segments,
		reading: candidate.reading,
		qualityScore: candidate.qualityScore,
		qualityReasons: candidate.qualityReasons,
	};
	if (candidate.qualityScore < qualityThreshold) {
		return {
			isSenryu: false,
			result,
			reason: `5・7・5 ですが品質点 ${candidate.qualityScore} 点が閾値 ${qualityThreshold} 点未満です。`,
			sanitized,
			tokens,
			totalMora: moraTokens.reduce((total, token) => total + token.mora, 0),
			tokenReadings: moraTokens.map((token) => token.reading),
			qualityScore: candidate.qualityScore,
			qualityReasons: candidate.qualityReasons,
		};
	}

	return {
		isSenryu: true,
		result,
		reason: null,
		sanitized,
		tokens,
		totalMora: moraTokens.reduce((total, token) => total + token.mora, 0),
		tokenReadings: moraTokens.map((token) => token.reading),
		qualityScore: candidate.qualityScore,
		qualityReasons: candidate.qualityReasons,
	};
}

export async function detectSenryu(
	text: string,
): Promise<SenryuDetectionResult | null> {
	const analysis = await analyzeSenryu(text);
	return analysis.isSenryu ? analysis.result : null;
}
