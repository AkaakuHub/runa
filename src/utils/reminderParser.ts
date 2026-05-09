import { logError } from "./logger";
import { generateAiTextWithUsage } from "./useAI";

interface ReminderParseSuccess {
	ok: true;
	remindAt: Date;
	message: string;
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
	confidence?: number;
	needsConfirmation?: boolean;
	question?: string | null;
}

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
		confidence: 1,
	};
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
- ユーザーが秒を明示した場合はその秒を使う。秒の指定がない場合、秒とミリ秒は必ず 00 にする。
- 「明日」「来週」「朝」「昼」「夜」などは現在時刻を基準に自然に解釈する。
- 「朝」は 09:00、「昼」は 12:00、「夕方」は 18:00、「夜」は 21:00 とする。
- 日時が曖昧すぎる、または通知本文がない場合は needsConfirmation を true にする。
- 過去日時を指定しない。過去になりそうな日付は次に来る未来の日時として解釈する。
- message は通知時に送る短い本文だけにする。「リマインドして」「教えて」などの依頼表現は除く。

JSONスキーマ:
{
  "remindAt": "YYYY-MM-DDTHH:mm:ss+09:00" | null,
  "message": "通知本文" | null,
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
		confidence,
	};
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
