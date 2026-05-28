import { logError } from "./logger";
import type {
	ReminderRepeatFrequency,
	ReminderRepeatRule,
} from "./reminderRecurrence";
import { generateAiTextWithUsage } from "./useAI";

interface ReminderParseSuccess {
	ok: true;
	remindAt: Date;
	message: string;
	repeat?: ReminderRepeatRule;
	confidence: number;
}

interface ReminderParseNeedsConfirmation {
	ok: false;
	reason: string;
	question?: string;
}

type ReminderParseResult =
	| ReminderParseSuccess
	| ReminderParseNeedsConfirmation;

interface AiReminderParseResult {
	remindAt?: string | null;
	message?: string | null;
	repeatFrequency?: ReminderRepeatFrequency | "none" | null;
	confidence?: number;
	needsConfirmation?: boolean;
	question?: string | null;
}

interface ReminderEditContext {
	remindAt: Date;
	message: string;
}

interface ReminderEditParseSuccess {
	ok: true;
	remindAt?: Date;
	message?: string;
	repeat?: ReminderRepeatRule;
	clearRepeat?: boolean;
	confidence: number;
}

type ReminderEditParseResult =
	| ReminderEditParseSuccess
	| ReminderParseNeedsConfirmation;

const JST_TIME_ZONE = "Asia/Tokyo";
const MIN_CONFIDENCE = 0.7;
const MAX_REMINDER_YEARS = 5;

export function formatReminderDateTime(date: Date): string {
	return new Intl.DateTimeFormat("ja-JP", {
		timeZone: JST_TIME_ZONE,
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

export async function parseReminderText(
	input: string,
	now: Date = new Date(),
): Promise<ReminderParseResult> {
	const normalizedInput = input.trim();
	const shouldKeepSeconds = hasExplicitSeconds(normalizedInput);
	if (!normalizedInput) {
		return {
			ok: false,
			reason: "リマインド内容を指定してください。",
		};
	}

	const localResult = parseSimpleRelativeReminder(
		normalizedInput,
		now,
		shouldKeepSeconds,
	);
	if (localResult) {
		return localResult;
	}

	const recurringResult = parseSimpleRecurringReminder(
		normalizedInput,
		now,
		shouldKeepSeconds,
	);
	if (recurringResult) {
		return recurringResult;
	}

	try {
		const aiResult = await parseReminderWithAi(normalizedInput, now);
		return validateAiResult(aiResult, now, shouldKeepSeconds);
	} catch (error) {
		logError(`Reminder AI parse failed: ${error}`);
		return {
			ok: false,
			reason:
				"日時の読み取りに失敗しました。例: `明日の9時に燃えるゴミ`、`30分後に洗濯物` のように指定してください。",
		};
	}
}

export async function parseReminderEditText(
	input: string,
	now: Date = new Date(),
	context?: ReminderEditContext,
): Promise<ReminderEditParseResult> {
	const normalizedInput = input.trim();
	const shouldKeepSeconds = hasExplicitSeconds(normalizedInput);
	if (!normalizedInput) {
		return {
			ok: false,
			reason: "変更内容を指定してください。",
		};
	}

	try {
		const aiResult = await parseReminderEditWithAi(
			normalizedInput,
			now,
			context,
		);
		return validateAiEditResult(aiResult, now, shouldKeepSeconds);
	} catch (error) {
		logError(`Reminder edit AI parse failed: ${error}`);
		return {
			ok: false,
			reason:
				"変更内容の読み取りに失敗しました。例: `明日の9時に変更`、`内容を牛乳に変更` のように指定してください。",
		};
	}
}

function parseSimpleRelativeReminder(
	input: string,
	now: Date,
	shouldKeepSeconds: boolean,
): ReminderParseResult | null {
	const relativeMatch = input.match(
		/^(?:(\d+)\s*(秒|分|時間|日)後(?:に)?)[\s、,]*(.+)$/u,
	);
	if (!relativeMatch) return null;

	const amount = Number.parseInt(relativeMatch[1], 10);
	const unit = relativeMatch[2];
	const message = cleanupReminderMessage(relativeMatch[3]);

	if (!Number.isFinite(amount) || amount <= 0 || !message) {
		return null;
	}

	const remindAt = new Date(now.getTime());
	switch (unit) {
		case "秒":
			remindAt.setSeconds(remindAt.getSeconds() + amount);
			break;
		case "分":
			remindAt.setMinutes(remindAt.getMinutes() + amount);
			break;
		case "時間":
			remindAt.setHours(remindAt.getHours() + amount);
			break;
		case "日":
			remindAt.setDate(remindAt.getDate() + amount);
			break;
		default:
			return null;
	}
	normalizeReminderDate(remindAt, shouldKeepSeconds);

	return {
		ok: true,
		remindAt,
		message,
		repeat: undefined,
		confidence: 1,
	};
}

function parseSimpleRecurringReminder(
	input: string,
	now: Date,
	shouldKeepSeconds: boolean,
): ReminderParseResult | null {
	const dailyMatch = input.match(
		/^毎日\s*(?:(\d{1,2})(?::(\d{2})(?::(\d{2}))?|時(?:([0-5]?\d)分?)?)|朝|昼|夕方|夜)(?:に)?[\s、,]*(.+)$/u,
	);
	if (dailyMatch) {
		const time = parseRecurringTime(
			dailyMatch,
			input.match(/^毎日\s*(朝|昼|夕方|夜)/u)?.[1],
		);
		const message = cleanupReminderMessage(dailyMatch[5]);
		if (!time || !message) return null;

		return buildRecurringParseResult(
			now,
			time,
			{ frequency: "daily" },
			message,
			shouldKeepSeconds,
		);
	}

	const weeklyMatch = input.match(
		/^毎週\s*(日曜|日曜日|月曜|月曜日|火曜|火曜日|水曜|水曜日|木曜|木曜日|金曜|金曜日|土曜|土曜日)\s*(?:(\d{1,2})(?::(\d{2})(?::(\d{2}))?|時(?:([0-5]?\d)分?)?)|朝|昼|夕方|夜)(?:に)?[\s、,]*(.+)$/u,
	);
	if (!weeklyMatch) return null;

	const targetWeekday = parseJapaneseWeekday(weeklyMatch[1]);
	const time = parseRecurringTime(
		[
			weeklyMatch[0],
			weeklyMatch[2],
			weeklyMatch[3],
			weeklyMatch[4],
			weeklyMatch[5],
		],
		input.match(
			/^毎週\s*(?:日曜|日曜日|月曜|月曜日|火曜|火曜日|水曜|水曜日|木曜|木曜日|金曜|金曜日|土曜|土曜日)\s*(朝|昼|夕方|夜)/u,
		)?.[1],
	);
	const message = cleanupReminderMessage(weeklyMatch[6]);
	if (targetWeekday === undefined || !time || !message) return null;

	return buildRecurringParseResult(
		now,
		time,
		{ frequency: "weekly" },
		message,
		shouldKeepSeconds,
		targetWeekday,
	);
}

async function parseReminderWithAi(
	input: string,
	now: Date,
): Promise<AiReminderParseResult> {
	const nowIso = now.toISOString();
	const nowJst = formatReminderDateTime(now);
	const prompt = `あなたはDiscordリマインダーの日時パーサーです。
ユーザー入力から、リマインド日時と通知本文を抽出してください。

現在時刻:
- UTC ISO: ${nowIso}
- JST表示: ${nowJst}
- タイムゾーン: Asia/Tokyo

ルール:
- 出力はJSONオブジェクトのみ。Markdownや説明文は禁止。
- remindAt は ISO 8601 形式で、必ず Asia/Tokyo の +09:00 オフセットを含める。
- 繰り返し指定がない場合、repeatFrequency は "none" にする。
- 「毎日」「毎朝」「デイリー」は repeatFrequency を "daily" にする。
- 「毎週」は repeatFrequency を "weekly" にする。
- ユーザーが秒を明示した場合はその秒を使う。秒の指定がない場合、秒とミリ秒は必ず 00 にする。
- 「明日」「来週」「朝」「昼」「夜」などは現在時刻を基準に自然に解釈する。
- 日付だけで時刻が未指定の場合は、その日の 05:00 とする。
- 「朝」は 05:00、「昼」は 12:00、「夕方」は 18:00、「夜」は 21:00 とする。
- 日時が曖昧すぎる、または通知本文がない場合は needsConfirmation を true にする。
- 過去日時を指定しない。過去になりそうな日付は次に来る未来の日時として解釈する。
- message は通知時に送る短い本文だけにする。「リマインドして」「教えて」などの依頼表現は除く。

JSONスキーマ:
{
  "remindAt": "YYYY-MM-DDTHH:mm:ss+09:00" | null,
  "message": "通知本文" | null,
  "repeatFrequency": "none" | "daily" | "weekly" | null,
  "confidence": 0.0-1.0,
  "needsConfirmation": boolean,
  "question": "確認質問" | null
}

ユーザー入力:
${JSON.stringify(input)}`;

	const response = await generateAiTextWithUsage(prompt, {
		maxCompletionTokens: 512,
		reasoningEffort: "none",
		temperature: 0,
	});

	return parseJsonObject(response.text);
}

async function parseReminderEditWithAi(
	input: string,
	now: Date,
	context?: ReminderEditContext,
): Promise<AiReminderParseResult> {
	const nowIso = now.toISOString();
	const nowJst = formatReminderDateTime(now);
	const currentReminderContext = context
		? `\n現在のリマインダー:\n- 現在の日時: ${formatReminderDateTime(context.remindAt)}\n- 現在の本文: ${JSON.stringify(context.message)}\n`
		: "";
	const prompt = `あなたはDiscordリマインダー編集のパーサーです。
ユーザー入力から、変更したい日時と通知本文を抽出してください。

現在時刻:
- UTC ISO: ${nowIso}
- JST表示: ${nowJst}
- タイムゾーン: Asia/Tokyo
${currentReminderContext}

ルール:
- 出力はJSONオブジェクトのみ。Markdownや説明文は禁止。
- 日時を変更する意図がある場合だけ remindAt を入れる。日時変更がなければ null。
- 通知本文を変更する意図がある場合だけ message を入れる。本文変更がなければ null。
- 繰り返しを変更する意図がある場合だけ repeatFrequency を入れる。変更がなければ null。
- 繰り返しを解除する意図がある場合は repeatFrequency を "none" にする。
- 「毎日」「毎朝」「デイリー」は repeatFrequency を "daily" にする。
- 「毎週」は repeatFrequency を "weekly" にする。
- remindAt は ISO 8601 形式で、必ず Asia/Tokyo の +09:00 オフセットを含める。
- ユーザーが秒を明示した場合はその秒を使う。秒の指定がない場合、秒とミリ秒は必ず 00 にする。
- 日付だけで時刻が未指定の場合は、その日の 05:00 とする。
- 現在のリマインダーが与えられていて、ユーザーが時刻だけを変更した場合は、現在のリマインダーの日付を維持する。
- 現在のリマインダーが与えられていて、ユーザーが日付だけを変更した場合は、その日の 05:00 とする。
- 「朝」は 05:00、「昼」は 12:00、「夕方」は 18:00、「夜」は 21:00 とする。
- 「9時じゃなくて5時」「9時ではなく5時」は時刻を 05:00 に変更する意味として扱う。
- 「内容をXに変更」「本文はX」「メッセージをX」などは message に X だけを入れる。
- 「明日に変更」「9時に変更」など、本文がない日時変更では message は null。
- 日時も本文も読み取れない場合は needsConfirmation を true にする。
- 過去日時を指定しない。過去になりそうな日付は次に来る未来の日時として解釈する。

JSONスキーマ:
{
  "remindAt": "YYYY-MM-DDTHH:mm:ss+09:00" | null,
  "message": "新しい通知本文" | null,
  "repeatFrequency": "none" | "daily" | "weekly" | null,
  "confidence": 0.0-1.0,
  "needsConfirmation": boolean,
  "question": "確認質問" | null
}

ユーザー入力:
${JSON.stringify(input)}`;

	const response = await generateAiTextWithUsage(prompt, {
		maxCompletionTokens: 512,
		reasoningEffort: "none",
		temperature: 0,
	});

	return parseJsonObject(response.text);
}

function validateAiResult(
	result: AiReminderParseResult,
	now: Date,
	shouldKeepSeconds: boolean,
): ReminderParseResult {
	const confidence =
		typeof result.confidence === "number" ? result.confidence : 0;

	if (result.needsConfirmation) {
		return {
			ok: false,
			reason: "日時または内容が曖昧です。",
			question: result.question ?? undefined,
		};
	}

	if (!result.remindAt || !result.message) {
		return {
			ok: false,
			reason: "日時と内容を読み取れませんでした。",
			question: result.question ?? undefined,
		};
	}

	const remindAt = new Date(result.remindAt);
	normalizeReminderDate(remindAt, shouldKeepSeconds);
	const message = cleanupReminderMessage(result.message);
	const repeat = parseAiRepeatFrequency(result.repeatFrequency);

	if (Number.isNaN(remindAt.getTime())) {
		return {
			ok: false,
			reason: "日時の形式を読み取れませんでした。",
		};
	}

	if (!message) {
		return {
			ok: false,
			reason: "リマインドする内容を読み取れませんでした。",
		};
	}

	if (confidence < MIN_CONFIDENCE) {
		return {
			ok: false,
			reason: "日時の解釈に自信がありません。",
			question:
				result.question ??
				"日時をもう少し具体的に指定してください。例: 明日の9時に燃えるゴミ",
		};
	}

	if (remindAt.getTime() <= now.getTime()) {
		return {
			ok: false,
			reason: "未来の日時を指定してください。",
		};
	}

	const maxReminderAt = new Date(now.getTime());
	maxReminderAt.setFullYear(maxReminderAt.getFullYear() + MAX_REMINDER_YEARS);
	if (remindAt.getTime() > maxReminderAt.getTime()) {
		return {
			ok: false,
			reason: `${MAX_REMINDER_YEARS}年以内の日時を指定してください。`,
		};
	}

	return {
		ok: true,
		remindAt,
		message,
		repeat,
		confidence,
	};
}

function validateAiEditResult(
	result: AiReminderParseResult,
	now: Date,
	shouldKeepSeconds: boolean,
): ReminderEditParseResult {
	const confidence =
		typeof result.confidence === "number" ? result.confidence : 0;

	if (result.needsConfirmation) {
		return {
			ok: false,
			reason: "変更内容が曖昧です。",
			question: result.question ?? undefined,
		};
	}

	const remindAt = result.remindAt ? new Date(result.remindAt) : undefined;
	if (remindAt) {
		normalizeReminderDate(remindAt, shouldKeepSeconds);
		if (Number.isNaN(remindAt.getTime())) {
			return {
				ok: false,
				reason: "日時の形式を読み取れませんでした。",
			};
		}
		if (remindAt.getTime() <= now.getTime()) {
			return {
				ok: false,
				reason: "未来の日時を指定してください。",
			};
		}
		const maxReminderAt = new Date(now.getTime());
		maxReminderAt.setFullYear(maxReminderAt.getFullYear() + MAX_REMINDER_YEARS);
		if (remindAt.getTime() > maxReminderAt.getTime()) {
			return {
				ok: false,
				reason: `${MAX_REMINDER_YEARS}年以内の日時を指定してください。`,
			};
		}
	}

	const message = result.message
		? cleanupReminderMessage(result.message)
		: undefined;
	const repeat = parseAiRepeatFrequency(result.repeatFrequency);
	const clearRepeat = result.repeatFrequency === "none";

	if (!remindAt && !message && !repeat && !clearRepeat) {
		return {
			ok: false,
			reason: "変更する日時または内容を読み取れませんでした。",
		};
	}

	if (confidence < MIN_CONFIDENCE) {
		return {
			ok: false,
			reason: "変更内容の解釈に自信がありません。",
			question:
				result.question ??
				"変更内容をもう少し具体的に指定してください。例: 明日の9時に変更",
		};
	}

	return {
		ok: true,
		remindAt,
		message,
		repeat,
		clearRepeat,
		confidence,
	};
}

function parseAiRepeatFrequency(
	frequency: AiReminderParseResult["repeatFrequency"],
): ReminderRepeatRule | undefined {
	switch (frequency) {
		case "daily":
			return { frequency: "daily" };
		case "weekly":
			return { frequency: "weekly" };
		default:
			return undefined;
	}
}

function parseJsonObject(text: string): AiReminderParseResult {
	const trimmed = text.trim();
	const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	const candidate = fencedMatch?.[1] ?? trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");

	if (start === -1 || end === -1 || end <= start) {
		throw new Error("AI response did not contain a JSON object");
	}

	return JSON.parse(candidate.slice(start, end + 1)) as AiReminderParseResult;
}

function normalizeReminderDate(date: Date, shouldKeepSeconds: boolean): void {
	if (shouldKeepSeconds) {
		date.setMilliseconds(0);
		return;
	}
	date.setSeconds(0, 0);
}

interface ReminderTimeParts {
	hour: number;
	minute: number;
	second: number;
}

function parseRecurringTime(
	match: Array<string | undefined>,
	timeWord: string | undefined,
): ReminderTimeParts | null {
	switch (timeWord) {
		case "朝":
			return { hour: 5, minute: 0, second: 0 };
		case "昼":
			return { hour: 12, minute: 0, second: 0 };
		case "夕方":
			return { hour: 18, minute: 0, second: 0 };
		case "夜":
			return { hour: 21, minute: 0, second: 0 };
	}

	const hour = Number.parseInt(match[1] ?? "", 10);
	const minute = Number.parseInt(match[2] ?? match[4] ?? "0", 10);
	const second = Number.parseInt(match[3] ?? "0", 10);

	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		!Number.isInteger(second) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59 ||
		second < 0 ||
		second > 59
	) {
		return null;
	}

	return { hour, minute, second };
}

function buildRecurringParseResult(
	now: Date,
	time: ReminderTimeParts,
	repeat: ReminderRepeatRule,
	message: string,
	shouldKeepSeconds: boolean,
	targetWeekday?: number,
): ReminderParseSuccess {
	const jstDate = getJSTDateParts(now);
	let remindAt = buildJSTDateTime({
		...jstDate,
		...time,
	});

	if (targetWeekday !== undefined) {
		const daysUntilTarget = (targetWeekday - jstDate.weekday + 7) % 7;
		remindAt = addJSTDays(remindAt, daysUntilTarget);
	}

	while (remindAt.getTime() <= now.getTime()) {
		remindAt = addJSTDays(remindAt, repeat.frequency === "daily" ? 1 : 7);
	}

	normalizeReminderDate(remindAt, shouldKeepSeconds);

	return {
		ok: true,
		remindAt,
		message,
		repeat,
		confidence: 1,
	};
}

function getJSTDateParts(date: Date): {
	year: number;
	month: number;
	day: number;
	weekday: number;
} {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: JST_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		weekday: "short",
	}).formatToParts(date);
	const value = (type: string): string =>
		parts.find((part) => part.type === type)?.value ?? "";

	return {
		year: Number.parseInt(value("year"), 10),
		month: Number.parseInt(value("month"), 10),
		day: Number.parseInt(value("day"), 10),
		weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
			value("weekday"),
		),
	};
}

function buildJSTDateTime(parts: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}): Date {
	return new Date(
		`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}+09:00`,
	);
}

function addJSTDays(date: Date, days: number): Date {
	const result = new Date(date.getTime());
	result.setUTCDate(result.getUTCDate() + days);
	return result;
}

function parseJapaneseWeekday(weekday: string): number | undefined {
	const normalizedWeekday = weekday.replace("曜日", "曜");
	const weekdayIndex = [
		"日曜",
		"月曜",
		"火曜",
		"水曜",
		"木曜",
		"金曜",
		"土曜",
	].indexOf(normalizedWeekday);
	return weekdayIndex === -1 ? undefined : weekdayIndex;
}

function pad2(value: number): string {
	return value.toString().padStart(2, "0");
}

function hasExplicitSeconds(input: string): boolean {
	return /\d+\s*秒/u.test(input) || /\b\d{1,2}:\d{2}:\d{2}\b/u.test(input);
}

function cleanupReminderMessage(message: string): string {
	return message
		.trim()
		.replace(/^(?:に|を|って|と)\s*/u, "")
		.replace(
			/\s*(?:を)?(?:リマインド|リマインダー|remind)(?:して|する)?$/iu,
			"",
		)
		.replace(/\s*(?:教えて|通知して|知らせて)$/u, "")
		.trim();
}
