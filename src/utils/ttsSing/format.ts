import * as abcjs from "abcjs";
import type { SimpleSingNote, SimpleSingScore } from "./types";

const SING_PADDING_FRAME_LENGTH = 15;
const VOICEVOX_FRAME_RATE = 93.75;
const DEFAULT_NOTE_LYRIC = "あ";
const TIE_NOTE_LYRIC = "ー";

type AbcLyric = {
	syllable: string;
	divider: " " | "-" | "_";
};

type AbcMidiPitch = {
	cmd?: string;
	pitch?: number;
};

type AbcVoiceNote = abcjs.VoiceItemNote & {
	lyric?: AbcLyric[];
	midiPitches?: AbcMidiPitch[];
};

type CollectedVoiceNote = {
	lineIndex: number;
	note: AbcVoiceNote;
};

export function isSimpleSingText(text: string): boolean {
	return parseSimpleSingScore(text) !== undefined;
}

export function parseSimpleSingScore(
	text: string,
): SimpleSingScore | undefined {
	if (!isLikelyAbcText(text)) {
		return undefined;
	}

	const normalizedText = normalizeAbcForParser(text);
	let tune: abcjs.TuneObject | undefined;
	try {
		const tunes = abcjs.parseOnly(normalizedText);
		tune = tunes[0];
	} catch {
		return undefined;
	}

	if (!tune) {
		return undefined;
	}

	try {
		tune.setUpAudio({});
	} catch {
		// midiPitchesの付与に失敗した場合は後段の抽出で弾く
	}

	const bpm = tune.getBpm();
	const beatLength = tune.getBeatLength();
	if (
		!Number.isFinite(bpm) ||
		bpm <= 0 ||
		!Number.isFinite(beatLength) ||
		beatLength <= 0
	) {
		return undefined;
	}

	const framesPerWholeNote = (60 * VOICEVOX_FRAME_RATE) / (bpm * beatLength);
	if (!Number.isFinite(framesPerWholeNote) || framesPerWholeNote <= 0) {
		return undefined;
	}

	const melodyVoiceIndex = detectMelodyVoiceIndex(tune);
	const voiceNotes = collectVoiceNotes(tune, melodyVoiceIndex);
	if (voiceNotes.length === 0) {
		return undefined;
	}
	const reorderedLyricQueues = buildReorderedLyricQueues(voiceNotes);

	const notes: SimpleSingNote[] = [
		{ key: null, frame_length: SING_PADDING_FRAME_LENGTH, lyric: "" },
	];
	let frameCarry = 0;
	let hasPlayableNote = false;

	for (const voiceNoteItem of voiceNotes) {
		const voiceNote = voiceNoteItem.note;
		const duration = voiceNote.duration;
		if (!Number.isFinite(duration) || duration <= 0) {
			return undefined;
		}

		const frame = durationToFrameLength(
			duration,
			framesPerWholeNote,
			frameCarry,
		);
		frameCarry = frame.carry;

		if (isRestNote(voiceNote)) {
			notes.push({ key: null, frame_length: frame.frameLength, lyric: "" });
			continue;
		}

		const key = extractMidiKey(voiceNote);
		if (key === undefined) {
			return undefined;
		}

		notes.push({
			key,
			frame_length: frame.frameLength,
			lyric: extractLyric(
				voiceNote,
				reorderedLyricQueues.get(voiceNoteItem.lineIndex),
			),
		});
		hasPlayableNote = true;
	}

	if (!hasPlayableNote) {
		return undefined;
	}

	notes.push({ key: null, frame_length: SING_PADDING_FRAME_LENGTH, lyric: "" });
	return { notes };
}

function isLikelyAbcText(text: string): boolean {
	if (!/^\s*K:/m.test(text)) {
		return false;
	}
	return /^\s*(X:|T:|M:|L:|Q:|K:|V:|w:)/m.test(text);
}

function normalizeAbcForParser(text: string): string {
	return text
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.join("\n");
}

function detectMelodyVoiceIndex(tune: abcjs.TuneObject): number {
	for (const line of tune.lines ?? []) {
		for (const staff of line.staff ?? []) {
			const voices = staff.voices ?? [];
			for (let i = 0; i < voices.length; i += 1) {
				const voice = voices[i];
				if (voice.some((item) => item.el_type === "note")) {
					return i;
				}
			}
		}
	}
	return 0;
}

function collectVoiceNotes(
	tune: abcjs.TuneObject,
	melodyVoiceIndex: number,
): CollectedVoiceNote[] {
	const result: CollectedVoiceNote[] = [];

	for (
		let lineIndex = 0;
		lineIndex < (tune.lines ?? []).length;
		lineIndex += 1
	) {
		const line = tune.lines?.[lineIndex];
		if (!line) {
			continue;
		}
		for (const staff of line.staff ?? []) {
			const voice = staff.voices?.[melodyVoiceIndex];
			if (!voice) {
				continue;
			}

			for (const item of voice) {
				if (item.el_type !== "note") {
					continue;
				}
				result.push({
					lineIndex,
					note: item as AbcVoiceNote,
				});
			}
			break;
		}
	}

	return result;
}

function isRestNote(note: AbcVoiceNote): boolean {
	return note.rest !== undefined;
}

function extractMidiKey(note: AbcVoiceNote): number | undefined {
	const midiPitches = note.midiPitches ?? [];
	const values = midiPitches
		.filter((pitch) => pitch.cmd === "note" && Number.isFinite(pitch.pitch))
		.map((pitch) => Number(pitch.pitch));

	if (values.length === 0) {
		return undefined;
	}

	const key = Math.max(...values);
	if (!Number.isFinite(key) || key < 0 || key > 127) {
		return undefined;
	}
	return Math.round(key);
}

function buildReorderedLyricQueues(
	notes: CollectedVoiceNote[],
): Map<number, string[]> {
	const pitchedByLine = groupPitchedNotesByLine(notes);
	if (pitchedByLine.length <= 1) {
		return new Map<number, string[]>();
	}

	const source = findMultiLyricSourceLine(pitchedByLine);
	if (!source) {
		return new Map<number, string[]>();
	}

	const hasMissingBeforeSource = pitchedByLine.some(
		(line) =>
			line.lineIndex < source.lineIndex &&
			line.notes.some((note) => extractLyricCandidates(note.note).length === 0),
	);
	if (!hasMissingBeforeSource) {
		return new Map<number, string[]>();
	}

	const sourceVerseCount = Math.max(
		...source.notes.map((note) => extractLyricCandidates(note.note).length),
	);
	if (sourceVerseCount <= 1) {
		return new Map<number, string[]>();
	}

	const targetLineIndices = pitchedByLine.map((line) => line.lineIndex);
	const assignCount = Math.min(sourceVerseCount, targetLineIndices.length);
	const queueByLine = new Map<number, string[]>();
	for (let verseIndex = 0; verseIndex < assignCount; verseIndex += 1) {
		const queue: string[] = [];
		for (const note of source.notes) {
			const candidates = extractLyricCandidates(note.note);
			if (verseIndex < candidates.length) {
				queue.push(candidates[verseIndex]);
			}
		}
		if (queue.length > 0) {
			queueByLine.set(targetLineIndices[verseIndex], queue);
		}
	}

	return queueByLine;
}

function groupPitchedNotesByLine(
	notes: CollectedVoiceNote[],
): Array<{ lineIndex: number; notes: CollectedVoiceNote[] }> {
	const map = new Map<number, CollectedVoiceNote[]>();
	for (const item of notes) {
		if (isRestNote(item.note)) {
			continue;
		}
		const list = map.get(item.lineIndex);
		if (list) {
			list.push(item);
			continue;
		}
		map.set(item.lineIndex, [item]);
	}
	return [...map.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([lineIndex, lineNotes]) => ({ lineIndex, notes: lineNotes }));
}

function findMultiLyricSourceLine(
	lines: Array<{ lineIndex: number; notes: CollectedVoiceNote[] }>,
): { lineIndex: number; notes: CollectedVoiceNote[] } | undefined {
	let source: { lineIndex: number; notes: CollectedVoiceNote[] } | undefined;
	let sourceMultiCount = 0;
	let sourceVerseCount = 1;

	for (const line of lines) {
		const candidateLens = line.notes.map(
			(note) => extractLyricCandidates(note.note).length,
		);
		const multiCount = candidateLens.filter((len) => len > 1).length;
		if (multiCount === 0) {
			continue;
		}
		const verseCount = Math.max(...candidateLens);
		if (
			multiCount > sourceMultiCount ||
			(multiCount === sourceMultiCount && verseCount > sourceVerseCount)
		) {
			source = line;
			sourceMultiCount = multiCount;
			sourceVerseCount = verseCount;
		}
	}

	return source;
}

function extractLyric(note: AbcVoiceNote, queue?: string[]): string {
	if (queue && queue.length > 0) {
		const queued = queue.shift();
		if (queued && queued.length > 0) {
			return queued;
		}
	}

	const candidates = extractLyricCandidates(note);
	if (candidates.length > 0) {
		return candidates[0];
	}
	return DEFAULT_NOTE_LYRIC;
}

function extractLyricCandidates(note: AbcVoiceNote): string[] {
	const lyrics = note.lyric ?? [];
	if (lyrics.length === 0) {
		return [];
	}

	let sawTieDivider = false;
	const result: string[] = [];
	for (const entry of lyrics) {
		if (entry.divider === "_") {
			sawTieDivider = true;
		}
		const normalized = normalizeLyricSyllable(entry.syllable ?? "");
		if (normalized === "*" || normalized === "~") {
			result.push(TIE_NOTE_LYRIC);
			continue;
		}
		if (normalized.length > 0) {
			result.push(normalized);
		}
	}

	if (result.length > 0) {
		return result;
	}
	if (sawTieDivider) {
		return [TIE_NOTE_LYRIC];
	}
	return [];
}

function normalizeLyricSyllable(syllable: string): string {
	return (
		syllable
			// 1番, 2., 3) などの節番号は歌詞として扱わない
			.replace(/^\d+[.)．）]*/u, "")
			.replace(/\s+/g, "")
			.trim()
	);
}

function durationToFrameLength(
	durationWhole: number,
	framesPerWholeNote: number,
	carry: number,
): { frameLength: number; carry: number } {
	const rawFrameLength = durationWhole * framesPerWholeNote + carry;
	const roundedFrameLength = Math.round(rawFrameLength);
	if (roundedFrameLength < 1) {
		return { frameLength: 1, carry: rawFrameLength - 1 };
	}
	return {
		frameLength: roundedFrameLength,
		carry: rawFrameLength - roundedFrameLength,
	};
}
