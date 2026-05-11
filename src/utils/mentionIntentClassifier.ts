import { generateAiTextWithUsage } from "./useAI";

export type ReminderMentionAction =
	| { type: "list" }
	| { type: "cancel"; id?: string; useLatest?: boolean }
	| { type: "edit"; id?: string; useLatest?: boolean; text: string }
	| { type: "create"; text: string };

type MentionIntent =
	| { type: "general" }
	| { type: "reminder"; action: ReminderMentionAction };

interface AiMentionIntent {
	intent?: "general" | "reminder";
	action?: "list" | "cancel" | "edit" | "create" | null;
	id?: string | null;
	useLatest?: boolean;
	text?: string | null;
	confidence?: number;
}

const MIN_CONFIDENCE = 0.55;

export async function classifyMentionIntent(
	content: string,
): Promise<MentionIntent> {
	const aiIntent = await classifyMentionIntentWithAi(content);
	return normalizeMentionIntent(aiIntent);
}

async function classifyMentionIntentWithAi(
	content: string,
): Promise<AiMentionIntent> {
	const prompt = `あなたはDiscord botへのメンション文を分類するルーターです。
入力がリマインダー、予約、予定通知に関する操作なら reminder、それ以外の会話や質問なら general にしてください。

重要:
- 出力はJSONオブジェクトのみ。Markdownや説明文は禁止。
- 実際の登録、編集、削除、返答生成は行わない。分類だけを行う。
- リマインダー操作だけ reminder にする。雑談、質問、挨拶、相談は general。
- 「今のリマインドは」「予約どうなってる」「登録中の予定は」など状態確認は list。
- 「消して」「削除」「キャンセル」「取り消して」などは cancel。
- 「変えて」「変更」「編集」「じゃなくて」「にして」などは edit。
- 「さっきの」「先ほどの」「直近の」「最新の」「今の予約」は useLatest true。
- 8文字前後以上の英数字IDがあれば id に入れる。バッククォートは除く。
- create/edit の text は、後段パーサーに渡す自然文として必要な内容だけを残す。
- edit で「9時じゃなくて5時にして」のような比較表現は、text にそのまま残す。
- cancel/list/general では text は null。

JSONスキーマ:
{
  "intent": "general" | "reminder",
  "action": "list" | "cancel" | "edit" | "create" | null,
  "id": "ID文字列" | null,
  "useLatest": boolean,
  "text": "作成または編集に必要な自然文" | null,
  "confidence": 0.0-1.0
}

入力:
${JSON.stringify(content)}`;

	const response = await generateAiTextWithUsage(prompt, {
		maxCompletionTokens: 512,
		reasoningEffort: "none",
		temperature: 0,
	});

	return parseJsonObject(response.text);
}

function normalizeMentionIntent(intent: AiMentionIntent): MentionIntent {
	if ((intent.confidence ?? 0) < MIN_CONFIDENCE) {
		return { type: "general" };
	}

	if (intent.intent !== "reminder") {
		return { type: "general" };
	}

	switch (intent.action) {
		case "list":
			return { type: "reminder", action: { type: "list" } };
		case "cancel":
			return {
				type: "reminder",
				action: {
					type: "cancel",
					id: normalizeOptionalText(intent.id),
					useLatest: Boolean(intent.useLatest),
				},
			};
		case "edit":
			return {
				type: "reminder",
				action: {
					type: "edit",
					id: normalizeOptionalText(intent.id),
					useLatest: Boolean(intent.useLatest),
					text: normalizeOptionalText(intent.text) ?? "",
				},
			};
		case "create":
			return {
				type: "reminder",
				action: {
					type: "create",
					text: normalizeOptionalText(intent.text) ?? "",
				},
			};
		default:
			return { type: "general" };
	}
}

function normalizeOptionalText(
	value: string | null | undefined,
): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function parseJsonObject(text: string): AiMentionIntent {
	const trimmed = text.trim();
	const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	const candidate = fencedMatch?.[1] ?? trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");

	if (start === -1 || end === -1 || end <= start) {
		throw new Error("AI response did not contain a JSON object");
	}

	return JSON.parse(candidate.slice(start, end + 1)) as AiMentionIntent;
}
