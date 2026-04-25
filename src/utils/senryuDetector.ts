import { MorphologyService } from "../services/MorphologyService";

const SMALL_KANA = new Set([
	"ァ",
	"ィ",
	"ゥ",
	"ェ",
	"ォ",
	"ャ",
	"ュ",
	"ョ",
	"ヮ",
	"ヵ",
	"ヶ",
	"ぁ",
	"ぃ",
	"ぅ",
	"ぇ",
	"ぉ",
	"ゃ",
	"ゅ",
	"ょ",
	"ゎ",
]);

const KANA_PATTERN = /[ァ-ヶーぁ-ゖ]/;
const TARGET_MORA = [5, 7, 5] as const;
const MAX_MORA_DEVIATION_PER_SEGMENT = 1;
const MAX_DEVIATED_SEGMENTS = 1;
const MIN_TOTAL_MORA =
	TARGET_MORA.reduce((total, mora) => total + mora, 0) -
	MAX_MORA_DEVIATION_PER_SEGMENT * MAX_DEVIATED_SEGMENTS;
const MAX_TOTAL_MORA =
	TARGET_MORA.reduce((total, mora) => total + mora, 0) +
	MAX_MORA_DEVIATION_PER_SEGMENT * MAX_DEVIATED_SEGMENTS;

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
}

export interface SenryuDetectionResult {
	isSenryu: boolean;
	segments: string[];
	reading: string;
}

function sanitizeMessageContent(text: string): string {
	return text
		.replace(/```[\s\S]*?```|```[\s\S]*$/g, " ")
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi, " ")
		.replace(/<a?:\w+:[\d-]+>/g, " ")
		.replace(/<[@#][!&]?\d+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function toKatakana(text: string): string {
	return text.replace(/[ぁ-ゖ]/g, (char) =>
		String.fromCharCode(char.charCodeAt(0) + 0x60),
	);
}

function countMora(reading: string): number {
	let count = 0;
	for (const char of toKatakana(reading)) {
		if (!KANA_PATTERN.test(char)) {
			continue;
		}
		if (SMALL_KANA.has(char) && count > 0) {
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

		const reading = token.reading || token.surface;
		const mora = countMora(reading);
		if (mora === 0) {
			return [];
		}

		return [
			{
				surface: token.surface,
				reading: toKatakana(reading),
				mora,
				partOfSpeech: token.partOfSpeech,
			},
		];
	});
}

function getMajorPartOfSpeech(token: MoraToken): string {
	return token.partOfSpeech[0] ?? "";
}

function isContentStartToken(token: MoraToken): boolean {
	return [
		"名詞",
		"動詞",
		"形容詞",
		"副詞",
		"代名詞",
		"感動詞",
		"連体詞",
	].includes(getMajorPartOfSpeech(token));
}

function isUnfinishedEndingToken(token: MoraToken): boolean {
	const majorPartOfSpeech = getMajorPartOfSpeech(token);
	const conjugationForm = token.partOfSpeech[5] ?? "";
	return (
		majorPartOfSpeech === "助動詞" && !/終止形|連体形/.test(conjugationForm)
	);
}

function isSentenceEndingAuxiliary(token: MoraToken): boolean {
	const majorPartOfSpeech = getMajorPartOfSpeech(token);
	const conjugationForm = token.partOfSpeech[5] ?? "";
	return majorPartOfSpeech === "助動詞" && /終止形/.test(conjugationForm);
}

function isIncompleteFinalToken(token: MoraToken): boolean {
	const majorPartOfSpeech = getMajorPartOfSpeech(token);
	if (majorPartOfSpeech === "形状詞" || majorPartOfSpeech === "連体詞") {
		return true;
	}

	const conjugationForm = token.partOfSpeech[5] ?? "";
	return majorPartOfSpeech === "動詞" && /連用形/.test(conjugationForm);
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

function isMeaningfulSegmentRange(
	tokens: MoraToken[],
	start: number,
	end: number,
	segmentIndex: number,
): boolean {
	const firstToken = tokens[start];
	const lastToken = tokens[end - 1];
	if (!firstToken || !lastToken) {
		return false;
	}

	if (!isContentStartToken(firstToken) || isUnfinishedEndingToken(lastToken)) {
		return false;
	}

	if (segmentIndex < 2 && isSentenceEndingAuxiliary(lastToken)) {
		return false;
	}

	if (segmentIndex === 2 && isIncompleteFinalToken(lastToken)) {
		return false;
	}

	return true;
}

function isMeaningfulSegmentSet(
	tokens: MoraToken[],
	start: number,
	firstEnd: number,
	secondEnd: number,
	end: number,
): boolean {
	return (
		isMeaningfulSegmentRange(tokens, start, firstEnd, 0) &&
		isMeaningfulSegmentRange(tokens, firstEnd, secondEnd, 1) &&
		isMeaningfulSegmentRange(tokens, secondEnd, end, 2)
	);
}

function isAllowedMoraPattern(moraPattern: number[]): boolean {
	let deviatedSegments = 0;

	for (const [index, mora] of moraPattern.entries()) {
		const deviation = Math.abs(mora - TARGET_MORA[index]);
		if (deviation > MAX_MORA_DEVIATION_PER_SEGMENT) {
			return false;
		}
		if (deviation > 0) {
			deviatedSegments++;
		}
	}

	return deviatedSegments <= MAX_DEVIATED_SEGMENTS;
}

function findBestSenryuCandidateForWindowRange(
	tokens: MoraToken[],
	prefixSums: number[],
	start: number,
	end: number,
): SenryuCandidate | null {
	let bestCandidate: SenryuCandidate | null = null;
	const totalMora = sumMora(prefixSums, start, end);
	if (totalMora < MIN_TOTAL_MORA || totalMora > MAX_TOTAL_MORA) {
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
			if (!isMeaningfulSegmentSet(tokens, start, firstEnd, secondEnd, end)) {
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

	return candidate.tokenCount > current.tokenCount;
}

function findBestSenryuCandidate(tokens: MoraToken[]): SenryuCandidate | null {
	let bestCandidate: SenryuCandidate | null = null;
	const prefixSums = buildMoraPrefixSums(tokens);

	for (let start = 0; start <= tokens.length - 3; start++) {
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
	}

	return bestCandidate;
}

export async function detectSenryu(
	text: string,
): Promise<SenryuDetectionResult | null> {
	const sanitized = sanitizeMessageContent(text);
	if (!sanitized || sanitized.length > 80) {
		return null;
	}

	const morphologyService = MorphologyService.getInstance();
	const tokens = await morphologyService.analyze(sanitized);
	const moraTokens = toMoraTokens(tokens);
	if (moraTokens.length < 3) {
		return null;
	}

	const candidate = findBestSenryuCandidate(moraTokens);
	if (!candidate) {
		return null;
	}

	return {
		isSenryu: true,
		segments: candidate.segments,
		reading: candidate.reading,
	};
}
