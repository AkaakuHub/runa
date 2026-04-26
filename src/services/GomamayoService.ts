import { type Morpheme, MorphologyService } from "./MorphologyService";
import { isAscii, isHiragana, katakanaToHiragana } from "../utils/kana";

type GomamayoKind = "none" | "gomamayo" | "high-order" | "n-term";

interface GomamayoResult {
	kind: GomamayoKind;
	message: string;
	pronunciations: string[];
	overlapIndexes: number[];
}

interface PronunciationToken {
	surface: string;
	pronunciation: string;
	partOfSpeech: string[];
}

const NEGATIVE_RESULT: GomamayoResult = {
	kind: "none",
	message: "違います。",
	pronunciations: [],
	overlapIndexes: [],
};

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

export class GomamayoService {
	private static instance: GomamayoService;

	private readonly morphologyService: MorphologyService;

	private constructor() {
		this.morphologyService = MorphologyService.getInstance();
	}

	public static getInstance(): GomamayoService {
		if (!GomamayoService.instance) {
			GomamayoService.instance = new GomamayoService();
		}
		return GomamayoService.instance;
	}

	public async judge(content: string): Promise<GomamayoResult> {
		let message = "違います。";
		let kind: GomamayoKind = "none";
		const overlapIndexes: number[] = [];

		const tokens = await this.morphologyService.analyze(content);
		const pronunciationTokens = this.buildPronunciationTokens(tokens);
		if (pronunciationTokens.length === 0) {
			return { ...NEGATIVE_RESULT };
		}

		for (let i = 0; i < pronunciationTokens.length - 1; i += 1) {
			const current = pronunciationTokens[i];
			const next = pronunciationTokens[i + 1];
			if (!this.isGomamayoPair(current, next)) {
				continue;
			}

			for (
				let overlapLength = 2;
				overlapLength <=
				Math.min(current.pronunciation.length, next.pronunciation.length);
				overlapLength += 1
			) {
				if (
					current.pronunciation.slice(-overlapLength) ===
					next.pronunciation.slice(0, overlapLength)
				) {
					message = "高次ゴママヨです。";
					kind = "high-order";
					overlapIndexes.push(i + 0.5);
					break;
				}
			}

			if (
				current.pronunciation.charAt(current.pronunciation.length - 1) ===
				next.pronunciation.charAt(0)
			) {
				message = "ゴママヨです。";
				kind = "gomamayo";
				overlapIndexes.push(i + 0.5);
			}
		}

		if (overlapIndexes.length > 1) {
			const maxNominal = this.findMaxConsecutiveOverlaps(overlapIndexes);
			if (maxNominal > 1) {
				message = `${maxNominal}項ゴママヨです。`;
				kind = "n-term";
			}
		}

		return {
			kind,
			message,
			pronunciations: pronunciationTokens.map((token) => token.pronunciation),
			overlapIndexes,
		};
	}

	private buildPronunciationTokens(tokens: Morpheme[]): PronunciationToken[] {
		return tokens
			.filter((token) => !this.isIgnoredToken(token))
			.map((token) => ({
				surface: token.surface,
				pronunciation: this.toPronunciation(token),
				partOfSpeech: token.partOfSpeech,
			}))
			.filter((token) => token.pronunciation.length > 0);
	}

	private isIgnoredToken(token: Morpheme): boolean {
		const majorPartOfSpeech = token.partOfSpeech[0] ?? "";
		return (
			majorPartOfSpeech === "空白" ||
			majorPartOfSpeech === "記号" ||
			majorPartOfSpeech === "補助記号" ||
			isAscii(token.surface) ||
			this.isRepeatedInterjection(token) ||
			EMOJI_PATTERN.test(token.surface)
		);
	}

	private isRepeatedInterjection(token: Morpheme): boolean {
		if (token.partOfSpeech[0] !== "感動詞") {
			return false;
		}

		const surface = katakanaToHiragana(token.surface);
		if (surface.length < 2) {
			return false;
		}

		return [...surface].every((char) => char === surface[0]);
	}

	private isGomamayoPair(
		current: PronunciationToken,
		next: PronunciationToken,
	): boolean {
		return (
			this.isGomamayoWord(current) &&
			this.isGomamayoWord(next) &&
			!this.isRepeatedWord(current, next)
		);
	}

	private isGomamayoWord(token: PronunciationToken): boolean {
		return token.partOfSpeech[0] === "名詞";
	}

	private isRepeatedWord(
		current: PronunciationToken,
		next: PronunciationToken,
	): boolean {
		return (
			current.surface === next.surface ||
			current.pronunciation === next.pronunciation
		);
	}

	private toPronunciation(token: Morpheme): string {
		const surface = katakanaToHiragana(token.surface);
		if (!surface.includes("は") && isHiragana(surface)) {
			return surface;
		}

		if (!token.reading || token.reading === "*") {
			return "";
		}

		const reading = katakanaToHiragana(token.reading);
		if (this.isParticle(token, "は")) return "わ";
		return reading;
	}

	private isParticle(token: Morpheme, surface: string): boolean {
		return token.surface === surface && token.partOfSpeech.includes("助詞");
	}

	private findMaxConsecutiveOverlaps(indexes: number[]): number {
		let nominal = 1;
		let maxNominal = 1;

		for (let i = 0; i < indexes.length - 1; i += 1) {
			if (indexes[i] + 1 === indexes[i + 1]) {
				nominal += 1;
			} else {
				maxNominal = Math.max(maxNominal, nominal);
				nominal = 1;
			}
		}

		return Math.max(maxNominal, nominal);
	}
}
