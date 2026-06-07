import { generateAiTextWithUsage, getLightAiModel } from "./useAI";

export type ReminderMentionAction =
	| { type: "list" }
	| { type: "cancel"; id?: string; useLatest?: boolean }
	| { type: "edit"; id?: string; useLatest?: boolean; text: string }
	| { type: "create"; text: string };

type MentionIntent =
	| { type: "general"; response: string }
	| { type: "reminder"; action: ReminderMentionAction };

interface AiMentionIntent {
	intent?: "general" | "reminder";
	action?: "list" | "cancel" | "edit" | "create" | null;
	id?: string | null;
	useLatest?: boolean;
	text?: string | null;
	response?: string | null;
	confidence?: number;
}

const MIN_CONFIDENCE = 0.55;
const MENTION_INTENT_SCHEMA = {
	type: "object",
	properties: {
		intent: { type: "string", enum: ["general", "reminder"] },
		action: {
			type: "string",
			enum: ["list", "cancel", "edit", "create", "none"],
		},
		id: { type: "string" },
		useLatest: { type: "boolean" },
		text: { type: "string" },
		response: { type: "string" },
		confidence: { type: "number" },
	},
	required: ["intent", "action", "useLatest", "text", "response", "confidence"],
	additionalProperties: false,
};

export async function classifyMentionIntent(
	content: string,
): Promise<MentionIntent> {
	const aiIntent = await classifyMentionIntentWithAi(content);
	return normalizeMentionIntent(aiIntent);
}

async function classifyMentionIntentWithAi(
	content: string,
): Promise<AiMentionIntent> {
	const prompt = `あなたはDiscord botへのメンションを処理するルーターです。
入力がリマインダー機能の操作なら reminder、それ以外なら general にしてください。

重要:
- 出力はJSONオブジェクトのみ。Markdownや説明文は禁止。
- reminder の場合は、実行したい操作を action に入れる。
- reminder の action は create/list/cancel/edit のいずれかにする。
- id が明示されていれば id に入れる。
- 直近の対象を指す文脈なら useLatest を true にする。
- create/edit の text は、後段のリマインダーパーサーに渡す自然文として必要な内容を削らずに残す。
- create の text では、引用符内の通知本文、開始日、開始時刻、繰り返し頻度、終了日、終了時刻をすべて保持する。
- 「作成して」「リマインドを作成して」など操作依頼の末尾だけを除き、日時条件や「まで」「以降」は除かない。
- 例: "@runa \"データマイニング課題、6/30まで\"というメッセージを、6/25以降の20:00に毎日リマインドを作成して。" は text を "\"データマイニング課題、6/30まで\"というメッセージを、6/25以降の20:00に毎日リマインド" にする。
- general の場合は action/id/text を null にし、response に日本語の自然な短い返答を入れる。
- general の response は、リマインダー登録や変更が完了したように書かない。

JSONスキーマ:
{
  "intent": "general" | "reminder",
  "action": "list" | "cancel" | "edit" | "create" | null,
  "id": "ID文字列" | null,
  "useLatest": boolean,
  "text": "作成または編集に必要な自然文" | null,
  "response": "generalの場合の返答" | null,
  "confidence": 0.0-1.0
}

入力:
${JSON.stringify(content)}`;

	const response = await generateAiTextWithUsage(prompt, {
		maxCompletionTokens: 512,
		reasoningEffort: "none",
		temperature: 0,
		responseMimeType: "application/json",
		responseJsonSchema: MENTION_INTENT_SCHEMA,
		maxRetries: 1,
		model: getLightAiModel(),
	});

	return parseJsonObject(response.text);
}

function normalizeMentionIntent(intent: AiMentionIntent): MentionIntent {
	const generalResponse =
		normalizeOptionalText(intent.response) ?? "うまく言葉が出ませんでした。";

	if ((intent.confidence ?? 0) < MIN_CONFIDENCE) {
		return { type: "general", response: generalResponse };
	}

	if (intent.intent !== "reminder") {
		return { type: "general", response: generalResponse };
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
			return { type: "general", response: generalResponse };
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
