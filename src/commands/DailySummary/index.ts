import {
	ChannelType,
	type ChatInputCommandInteraction,
	type Collection,
	type Message,
	type TextChannel,
} from "discord.js";
import { dailyChannelService } from "../../services/DailyChannelService";
import type { CommandDefinition } from "../../types";
import {
	formatToDetailedJapaneseDate,
	getCurrentJSTDateRange,
	getCurrentTimestamp,
	getJSTDateForJudgment,
	getTimestamp,
	parseJSTDateRange,
} from "../../utils/dateUtils";
import { logError, logInfo } from "../../utils/logger";
import {
	editAndFollowUpLongMessage,
	sendLongMessage,
} from "../../utils/messageUtils";
import {
	estimateTokensGptOss20bFromText,
	warmupTokenEstimator,
} from "../../utils/tokenEstimator";
import { checkCommandCooldown } from "../../utils/commandCooldown";
import { generateAiTextWithUsage } from "../../utils/useAI";

// Twitter/X URL検出とコンテンツ取得のヘルパー関数
function extractTwitterUrls(content: string): string[] {
	const twitterUrlRegex =
		/https?:\/\/(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)\/\w+\/status\/\d+/g;
	return content.match(twitterUrlRegex) || [];
}

function convertToFxTwitterUrl(twitterUrl: string): string {
	return twitterUrl.replace(
		/https?:\/\/(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com)/,
		"https://api.fxtwitter.com",
	);
}

async function fetchTweetContent(twitterUrl: string): Promise<string | null> {
	try {
		const fxTwitterUrl = convertToFxTwitterUrl(twitterUrl);
		const response = await fetch(fxTwitterUrl);

		if (!response.ok) {
			logError(
				`Failed to fetch tweet: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		const data = await response.json();

		if (data.code === 200 && data.tweet) {
			const tweet = data.tweet;
			const author = tweet.author;
			return `【ツイート】@${author.screen_name}(${author.name}): ${tweet.text}`;
		}

		return null;
	} catch (error) {
		logError(`Error fetching tweet content: ${error}`);
		return null;
	}
}

const MAX_TOTAL_TOKENS = 8000;
const RESERVED_OUTPUT_TOKENS = 2200;
const PROMPT_SAFETY_BUFFER_TOKENS = 900;
const MAX_CHUNK_OUTPUT_TOKENS = 1000;
const MAX_INPUT_TOKENS =
	MAX_TOTAL_TOKENS - RESERVED_OUTPUT_TOKENS - PROMPT_SAFETY_BUFFER_TOKENS;
const EMPTY_RESPONSE_RETRY_DELAY_MS = 60 * 1000;
const EMPTY_RESPONSE_MAX_RETRIES = 3;
const LENGTH_FINISH_MAX_RETRIES = 2;
const DAILY_SUMMARY_COOLDOWN_MS = 0;

const DAY_OF_WEEK_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function buildDateInfoSection(dateInfo: {
	month: number;
	day: number;
	dayOfWeek: number;
	isMonthStart: boolean;
	isMonthEnd: boolean;
}): string {
	return `【日付情報】：
- 日付：${dateInfo.month}月${dateInfo.day}日（${DAY_OF_WEEK_LABELS[dateInfo.dayOfWeek]}曜日）
- 特記事項：${dateInfo.isMonthStart ? "月初" : dateInfo.isMonthEnd ? "月末" : "普段の日"}
- 六曜や祝祭日も考慮してください。`;
}

function buildFinalSummaryPrompt(
	sourceText: string,
	dateInfo: {
		month: number;
		day: number;
		dayOfWeek: number;
		isMonthStart: boolean;
		isMonthEnd: boolean;
	},
	sourceKind: "raw_messages" | "chunk_digests",
	highlight?: string | null,
): string {
	const sourceLabel =
		sourceKind === "raw_messages"
			? "【今日のメッセージ】（時刻とURL付き）"
			: "【チャンク要約】（時刻・URL付きの証拠ベース）";

	let prompt = `あなたはプロの新聞記者兼占い師。与えられた情報だけで、1日分のニュースとハレ・ケ判定を作成してください。
個人の発言・ユーザー間会話を最優先し、小ネタも取りこぼさず拾ってください。X/Twitter情報は補助扱いです。
推測や創作は禁止。不要な前置き（例:「承知しました」）は出力しないでください。
語り口はテンション高めのニュースレポート調。感情の揺れ、意外性、軽いユーモアを必ず入れてください。

${sourceLabel}：
${sourceText}

${buildDateInfoSection(dateInfo)}

【ハレ・ケ判定の基準】
- 活動：メッセージ数、参加者数、時間帯の分散度
- 感情：ポジティブ/ネガティブな言葉のバランス、盛り上がり
- 伝統：祝日、月の満ち欠け、六曜などの要素
- 自然：曜日の特性、季節感
- 運命：総合的な運勢の流れ

【注意事項】
- 各トピックは必ず「🔸 **」から始める
- 時刻は HH:MM 形式、URLは正確なDiscordメッセージリンクのみ使用
- 個人のメッセージや会話を優先的に取り上げる
- 小さな話題でも見逃さずに取り上げる
- 15個のトピックを必ず作成する
- 可能な範囲で時間帯が偏らないようにすること
- ハレ・ケ判定の区分は、会話内容に大きく左右される
- 以下の出力形式を100%、本当に絶対に厳守
- パーセンテージも、毎日、実際の会話内容によって、0%から100%の間で、1刻みで変動させる。固定値にしないこと。キリのいい数字でなくて全然構わないので、当日の内容を正確に反映させること。
- 各トピックは必ずDiscord URLを1件含める
- URL行は必ず単独行で「https://discord.com/channels/...」のみを書く（「URL:」や補足説明を付けない）
- 絵文字と見出し記号はテンプレートと完全一致（「🔸」「🔮」を変更しない）
- トピック本文は自然なニュース文体で2〜4文にする（ラベル形式の「会話抜粋:」「要約内容:」は禁止）
- 会話内容は本文へ自然に織り込み、必要なら短い引用「...」として入れる
- 見出しは自然な記事タイトルにする（例: 「みみちゃん、ウニにやられる？」）
- 「トピック1」「話題A」「会話まとめ」などの機械的タイトルは禁止
- 文体は「感情的で、おもしろおかしいニュース・レポート調」を維持する
- 各トピック本文は「導入 -> 展開 -> 余韻」の流れで書き、場の空気（ざわつき、笑い、困惑、安心）を必ず入れる
- 乾いた事務要約は禁止（例: 「価格設定」「反応で好評」「コストパフォーマンス」だけで終える文）
- 禁止: 2文以下の短い断片要約、名詞中心の説明文、SNS要約のような無感情な文体
- 禁止語調: 「中立的」「収束した」「個人差で終わる」など、温度を下げる締め方

【ハレ・ケ判定の区分】
- 超ハレ: 90-100%
- ハレ: 80-89%
- ややハレ: 70-79%
- 超ケ: 60-69%
- ケ: 50-59%
- ややケ: 40-49%
- 超ネ: 30-39%
- ネ: 20-29%
- ややネ: 10-19%
- 欺瞞: 0-9%

出力形式の先頭の例
- 今日は『ハレ』の日でした！(82%)
- 今日は『ケ』の日でした！(56%)
etc.

【出力形式】

### 今日は『(ここに今回の【ハレ・ケ判定の区分】を１つ入れる)』の日でした！((ここに今回の〇〇%を入れる))
┌─ 判定理由 ─────────────────┐
│ 💬 活動: 分析結果をここに記入                    │
│ 😊 感情: 分析結果をここに記入                    │
│ 📅 伝統: 分析結果をここに記入                    │
│ 🌤️ 自然: 分析結果をここに記入                    │
│ ✨ 運命: 分析結果をここに記入                    │
└──────────────────────────┘

📰 **今日のサーバーニュース**

🔸 **深夜の乾杯、議論は予想外の方向へ** - 10:01
https://discord.com/channels/...
某所の飲み会がもんじゃで3500円という情報に、ある参加者が「酒なしでピンチケもんじゃはしゃばい」と猛反発！ストライキも辞さない構え！？最終的に別店舗に変更されるか、議論が白熱。

🔸 **増設チャレンジ、気合いで逆転起動** - 16:20
https://discord.com/channels/...
あるメンバーがメモリ増設に挑戦！最初は動かなかったものの、気合いを入れたら動いたとのこと。DDR5の増設は難しいと聞きますが、気合いで乗り切ったようです。

🔸 **夜の移動で緊急停止、到着は未定** - 21:10
https://discord.com/channels/...
メンバーAが路線電車に乗車中、電車が故障し立ち往生！到着時間不明という事態に。果たして無事に目的地にたどり着けるのか？

（悪い例・この文体は禁止）
- 「1人3000円で飲んで」と価格設定。
- 「安いな」反応でコストパフォーマンスが好評。

（以下同様に合計15個のトピックを続ける）

🔮 **明日への一言**
今日の分析を踏まえた明日へのアドバイスやメッセージ
`;

	if (highlight) {
		prompt += `

📌 **特に注目してほしい内容**: ${highlight}
上記の内容について特に詳しく調べて、関連するメッセージがあれば優先的に取り上げて、イチオシニュースとして強調してください。`;
	}

	return prompt;
}

function buildChunkDigestPrompt(
	messageLines: string,
	dateInfo: {
		month: number;
		day: number;
		dayOfWeek: number;
		isMonthStart: boolean;
		isMonthEnd: boolean;
	},
	chunkIndex: number,
	totalChunks: number,
	seenUrls: string[],
	highlight?: string | null,
): string {
	let prompt = `あなたはプロの新聞記者です。以下は1日分メッセージの一部（全${totalChunks}分割中 ${chunkIndex + 1}番目）です。
このチャンクだけを根拠に、会話中心の要点メモを作ってください。創作や推測は禁止です。

${buildDateInfoSection(dateInfo)}

【対象メッセージ（時刻とURL付き）】
${messageLines}

【既出URL（重複回避）】
${seenUrls.length > 0 ? seenUrls.join("\n") : "なし"}

【チャンク出力形式（厳守）】
- 最大5件、最小1件（有効題材がなければ「（このチャンクで新規トピックなし）」）
- 各件は必ず次の4行:
  1) - [HH:MM] 見出し
  2)   https://discord.com/channels/...
  3)   会話抜粋: 「...」
  4)   要点: 1〜2文
- 個人会話・やり取りを優先する
- URLは「URL:」等の接頭辞を付けず、単独行のDiscord URLだけにする
`;

	if (highlight) {
		prompt += `
- 特に「${highlight}」に関連する内容があれば優先して詳しく残す`;
	}

	return prompt;
}

async function splitMessagesByEstimatedTokens(
	lines: string[],
	basePromptTokens: number,
): Promise<string[][]> {
	const chunks: string[][] = [];
	let currentChunk: string[] = [];
	let currentTokens = basePromptTokens;

	for (const line of lines) {
		const lineTokens = await estimateTokensGptOss20bFromText(line);
		const lineWithSeparatorTokens = lineTokens + 2;

		if (
			currentChunk.length > 0 &&
			currentTokens + lineWithSeparatorTokens > MAX_INPUT_TOKENS
		) {
			chunks.push(currentChunk);
			currentChunk = [];
			currentTokens = basePromptTokens;
		}

		currentChunk.push(line);
		currentTokens += lineWithSeparatorTokens;
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}

	return chunks;
}

async function waitMs(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function pickEvenlyDistributedItems<T>(items: T[], keepCount: number): T[] {
	if (keepCount >= items.length) return [...items];
	if (keepCount <= 1) return [items[0]];
	if (keepCount === 2) return [items[0], items[items.length - 1]];

	const result: T[] = [];
	const step = (items.length - 1) / (keepCount - 1);
	let lastIndex = -1;

	for (let i = 0; i < keepCount; i += 1) {
		let index = Math.round(i * step);
		if (index <= lastIndex) {
			index = Math.min(lastIndex + 1, items.length - 1);
		}
		result.push(items[index]);
		lastIndex = index;
	}

	return result;
}

interface DailySummaryGenerationOptions {
	onProgress?: (message: string) => Promise<void>;
}

async function generateNonEmptyTextWithRetry(
	prompt: string,
	context: string,
	maxCompletionTokens: number,
	temperature: number,
	onRetry?: (message: string) => Promise<void>,
): Promise<string> {
	let attempt = 0;
	let lengthRetryCount = 0;
	let completionBudget = maxCompletionTokens;

	while (attempt <= EMPTY_RESPONSE_MAX_RETRIES) {
		attempt += 1;
		const result = await generateAiTextWithUsage(prompt, {
			maxCompletionTokens: completionBudget,
			reasoningEffort: "low",
			temperature,
		});
		const normalized = result.text?.trim();
		const completionUsed = result.usage?.completion_tokens ?? 0;
		const reachedCompletionBudget =
			completionUsed > 0 && completionUsed >= completionBudget - 10;

		if (normalized) {
			if (
				(result.finishReason === "length" || reachedCompletionBudget) &&
				lengthRetryCount < LENGTH_FINISH_MAX_RETRIES
			) {
				lengthRetryCount += 1;
				const nextBudget = Math.min(completionBudget + 500, 3500);
				const retryMessage =
					`⚠️ ${context} がトークン上限で途中終了の可能性あり。` +
					`completion budgetを ${completionBudget} -> ${nextBudget} に増やして再生成します。` +
					`(finish_reason=${result.finishReason ?? "unknown"}, completion_used=${completionUsed})`;
				logInfo(retryMessage);
				await onRetry?.(retryMessage);
				completionBudget = nextBudget;
				continue;
			}
			return normalized;
		}

		if (attempt > EMPTY_RESPONSE_MAX_RETRIES) {
			throw new Error(`Empty AI response at ${context}`);
		}

		const retryMessage =
			`⚠️ ${context} で空レスポンスを検知しました。` +
			`${EMPTY_RESPONSE_RETRY_DELAY_MS / 1000}秒待機して再試行します ` +
			`(${attempt}/${EMPTY_RESPONSE_MAX_RETRIES})`;
		logInfo(retryMessage);
		await onRetry?.(retryMessage);
		await waitMs(EMPTY_RESPONSE_RETRY_DELAY_MS);
	}

	throw new Error(`Empty AI response at ${context}`);
}

function extractDiscordUrls(text: string): string[] {
	const urlRegex = /https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+/g;
	return Array.from(new Set(text.match(urlRegex) || []));
}

function mergeWithOverlap(baseText: string, continuation: string): string {
	const a = baseText.trimEnd();
	const b = continuation.trimStart();
	const maxOverlap = Math.min(400, a.length, b.length);

	for (let len = maxOverlap; len >= 40; len--) {
		if (a.endsWith(b.slice(0, len))) {
			return `${a}${b.slice(len)}`;
		}
	}

	return `${a}\n${b}`;
}

function isSummaryLikelyIncomplete(summary: string): boolean {
	if (!summary.trim()) return true;
	if (!summary.includes("🔮 **明日への一言**")) return true;
	return false;
}

async function ensureSummaryCompleteness(
	originalPrompt: string,
	partialSummary: string,
	context: string,
	onProgress?: (message: string) => Promise<void>,
): Promise<string> {
	let current = partialSummary;
	let attempts = 0;

	while (isSummaryLikelyIncomplete(current) && attempts < 2) {
		attempts += 1;
		const continuationPrompt = `${originalPrompt}

【重要】
以下は、あなたが直前に出力した本文の途中までです。重複させずに「続きだけ」を書いて、必ず最後の
「🔮 **明日への一言**」まで完了させてください。
説明文や前置きは禁止です。

【途中までの本文】
${current}

【ここから続きのみを出力】`;

		await onProgress?.(
			`⚠️ ${context}: 出力の末尾が不足しているため、続きの生成を実行します (${attempts}/2)`,
		);
		const continuation = await generateNonEmptyTextWithRetry(
			continuationPrompt,
			`${context}_continuation_${attempts}`,
			1200,
			1.1,
			onProgress,
		);
		current = mergeWithOverlap(current, continuation);
	}

	return current;
}

export const DailySummaryCommand: CommandDefinition = {
	name: "daily-summary",
	description: "今日のチャンネルの出来事をニュース風にまとめます。",
	options: [
		{
			name: "highlight",
			description: "特に注目してほしい出来事やキーワード（イチオシニュース）",
			type: "STRING",
			required: false,
		},
		{
			name: "date",
			description: "サマリー対象日付（JST、例：2025-06-30）",
			type: "STRING",
			required: false,
		},
	],
	execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
		const startTime = getCurrentTimestamp();

		try {
			if (!interaction.guild) {
				await interaction.reply({
					content: "このコマンドはサーバー内でのみ使用できます。",
					ephemeral: true,
				});
				return;
			}

			const canExecute = await checkCommandCooldown(interaction, {
				commandName: "daily-summary",
				cooldownMs: DAILY_SUMMARY_COOLDOWN_MS,
			});

			if (!canExecute) {
				return;
			}

			await interaction.deferReply();

			const highlight = interaction.options.getString("highlight");
			const dateString = interaction.options.getString("date");

			const summaryChannelId = dailyChannelService.getSummaryChannel(
				interaction.guild.id,
			);

			// サマリー生成が時間がかかる場合があるのでタイムアウト対策
			let summary: string;
			try {
				const onProgress = async (message: string) => {
					try {
						await interaction.editReply({
							content: message.slice(0, 2000),
						});
					} catch (progressError) {
						logError(`Failed to update progress message: ${progressError}`);
					}
				};

				// 14分でタイムアウト（Discord の15分制限より少し短く）
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(
						() => reject(new Error("Generation timeout")),
						14 * 60 * 1000,
					);
				});

				summary = await Promise.race([
					generateDailySummary(interaction, undefined, highlight, dateString, {
						onProgress,
					}),
					timeoutPromise,
				]);
			} catch (error) {
				const elapsed = getCurrentTimestamp() - startTime;
				logError(`Summary generation failed after ${elapsed}ms: ${error}`);

				if (!interaction.replied && !interaction.deferred) {
					return; // インタラクションが既に無効
				}

				let errorMessage = "サマリーの生成中にエラーが発生しました。";

				// エラー種別に応じたメッセージを生成
				if (error instanceof Error) {
					if (
						error.message.includes("503") ||
						error.message.includes("overloaded")
					) {
						errorMessage =
							"🔄 AIサーバーが混雑しています。しばらく時間をおいて再度お試しください。";
					} else if (error.message.includes("timeout")) {
						errorMessage =
							"⏱️ サマリー生成がタイムアウトしました。時間をおいて再度お試しください。";
					} else if (error.message.includes("API key")) {
						errorMessage =
							"🔑 API設定に問題があります。管理者にお問い合わせください。";
					} else {
						errorMessage =
							"❌ サマリーの生成中にエラーが発生しました。時間をおいて再度お試しください。";
					}
				}

				try {
					await interaction.editReply({
						content: errorMessage,
					});
				} catch (replyError) {
					logError(`Failed to send error message: ${replyError}`);
				}
				return;
			}

			if (summaryChannelId) {
				// 投稿用チャンネルが設定されている場合はそこに投稿
				const summaryChannel =
					interaction.guild.channels.cache.get(summaryChannelId);
				if (summaryChannel && summaryChannel.type === ChannelType.GuildText) {
					// 統一されたユーティリティを使用して日付を取得
					const targetDateForDisplay = getJSTDateForJudgment(
						dateString || undefined,
					);

					const displayDateString =
						formatToDetailedJapaneseDate(targetDateForDisplay);

					const summaryWithDate = `# ${displayDateString}のサーバーニュース\n\n${summary}`;

					// メッセージが2000文字を超える場合は分割送信
					await sendLongMessage(summaryChannel as TextChannel, summaryWithDate);

					await interaction.editReply({
						content: `✅ 日次サマリーを ${summaryChannel.name} に投稿しました。`,
					});
				} else {
					await interaction.editReply({
						content:
							"投稿用チャンネルが見つかりません。設定を確認してください。",
					});
				}
			} else {
				// 従来通りの動作（実行されたチャンネルに返信）
				// メッセージが2000文字を超える場合は分割送信
				await editAndFollowUpLongMessage(interaction, summary);
			}

			logInfo(`Daily summary command executed by ${interaction.user.username}`);
		} catch (error) {
			logError(`Error executing daily summary command: ${error}`);
			try {
				if (interaction.deferred || interaction.replied) {
					await interaction.followUp({
						content: "サマリーの送信中にエラーが発生しました。",
					});
				} else {
					await interaction.reply({
						content: "サマリーの生成中にエラーが発生しました。",
					});
				}
			} catch (replyError) {
				logError(`Failed to send error reply: ${replyError}`);
			}
		}
	},
};

export async function generateDailySummary(
	interaction: ChatInputCommandInteraction,
	targetChannelIds?: string | string[],
	highlight?: string | null,
	targetDate?: string | null,
	options?: DailySummaryGenerationOptions,
): Promise<string> {
	try {
		const guild = interaction.guild;

		if (!guild) {
			throw new Error("Guild not found");
		}

		// JST基準で日付範囲を作成（統一されたユーティリティを使用）
		const { start: jstStartTime, end: jstEndTime } = targetDate
			? parseJSTDateRange(targetDate)
			: getCurrentJSTDateRange();

		let channelIds: string[];

		if (targetChannelIds) {
			// 自動実行の場合：指定されたチャンネルIDsを使用
			channelIds = Array.isArray(targetChannelIds)
				? targetChannelIds
				: [targetChannelIds];
		} else {
			// 手動実行の場合：設定されたすべてのチャンネルからメッセージを収集
			const configuredChannelIds = dailyChannelService.getChannels(guild.id);

			if (configuredChannelIds.length === 0) {
				return "日次サマリー用のチャンネルが設定されていません。`/daily-config add` でチャンネルを追加してください。";
			}

			channelIds = configuredChannelIds;
		}

		const todaysMessages: Array<{
			channel: string;
			author: string;
			content: string;
			timestamp: Date;
			messageId: string;
			channelId: string;
			guildId: string;
		}> = [];

		for (const channelId of channelIds) {
			try {
				const channel = guild.channels.cache.get(channelId);

				if (!channel || channel.type !== ChannelType.GuildText) {
					logError(`Channel ${channelId} not found or not a text channel`);
					continue;
				}

				const textChannel = channel as TextChannel;

				// その日の全メッセージを取得するため、ページネーションを使用
				const allMessages: Message[] = [];
				let lastMessageId: string | undefined;
				let hasMoreMessages = true;

				while (hasMoreMessages) {
					const options: { limit: number; before?: string } = { limit: 100 };
					if (lastMessageId) {
						options.before = lastMessageId;
					}

					const messages: Collection<string, Message> =
						await textChannel.messages.fetch(options);

					if (messages.size === 0) {
						hasMoreMessages = false;
						break;
					}

					// メッセージを配列に追加し、日付チェック
					const messagesArray = Array.from(messages.values());
					let foundOldMessage = false;

					for (const message of messagesArray) {
						// メッセージがJST基準の対象日より古いかチェック
						if (message.createdAt < jstStartTime) {
							foundOldMessage = true;
							break;
						}
						allMessages.push(message);
					}

					if (foundOldMessage) {
						hasMoreMessages = false;
					} else {
						lastMessageId = messagesArray[messagesArray.length - 1]?.id;
						if (messages.size < 100) {
							hasMoreMessages = false;
						}
					}
				}

				// 指定日のメッセージのみをフィルタリング（JSTベース）
				for (const message of allMessages) {
					// メッセージがJST基準の対象日の範囲内かチェック
					if (
						message.createdAt >= jstStartTime &&
						message.createdAt < jstEndTime &&
						!message.author.bot
					) {
						if (message.content && message.content.length > 0) {
							let content = message.content;

							// Twitter/X URLを検出してコンテンツを取得
							const twitterUrls = extractTwitterUrls(content);
							if (twitterUrls.length > 0) {
								for (const url of twitterUrls) {
									const tweetContent = await fetchTweetContent(url);
									if (tweetContent) {
										content += `\n${tweetContent}`;
									}
								}
							}

							todaysMessages.push({
								channel: textChannel.name,
								author: message.author.displayName || message.author.username,
								content: content,
								timestamp: message.createdAt,
								messageId: message.id,
								channelId: message.channelId,
								guildId: guild.id,
							});
						}
					}
				}
			} catch (error) {
				const channel = guild.channels.cache.get(channelId);
				const channelName = channel?.name || channelId;
				logError(
					`Could not fetch messages from channel ${channelName}: ${error}`,
				);
			}
		}

		// メッセージが0件の場合の処理
		if (todaysMessages.length === 0) {
			const targetDateStr = targetDate || "today";
			return `📰 **今日のサーバーニュース**

${targetDateStr}はメッセージが見つかりませんでした。

🔸 **静かな一日**
今日は穏やかな一日でした。明日に向けてエネルギーを蓄える時間でしたね。`;
		}

		todaysMessages.sort(
			(a, b) => getTimestamp(a.timestamp) - getTimestamp(b.timestamp),
		);

		// メッセージデータを時刻とURL付きで準備
		const messagesWithMeta = todaysMessages
			.map((msg) => {
				const timeString = msg.timestamp.toLocaleString("ja-JP", {
					hour: "2-digit",
					minute: "2-digit",
				});
				const messageUrl = `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId}`;
				return `[${timeString}] [${msg.channel}] ${msg.author}: ${msg.content} | ${messageUrl}`;
			})
			.join("\n");

		// 日付情報を収集
		const targetDateForAnalysis = getJSTDateForJudgment(
			targetDate || undefined,
		);
		const dateInfo = {
			month: targetDateForAnalysis.getMonth() + 1,
			day: targetDateForAnalysis.getDate(),
			dayOfWeek: targetDateForAnalysis.getDay(),
			isMonthStart: targetDateForAnalysis.getDate() === 1,
			isMonthEnd: targetDateForAnalysis.getDate() >= 28,
		};

		// daily-summary時のみ tokenizer で入力トークンを見積もり、上限を超える場合は分割して統合する
		await warmupTokenEstimator();
		const fullPrompt = buildFinalSummaryPrompt(
			messagesWithMeta,
			dateInfo,
			"raw_messages",
			highlight,
		);
		const estimatedTokens = await estimateTokensGptOss20bFromText(fullPrompt);
		logInfo(
			`Daily summary token config - reserved_output: ${RESERVED_OUTPUT_TOKENS}, input_budget: ${MAX_INPUT_TOKENS}, chunk_output: ${MAX_CHUNK_OUTPUT_TOKENS}`,
		);
		logInfo(
			`Daily summary estimated input tokens: ${estimatedTokens} (budget: ${MAX_INPUT_TOKENS})`,
		);

		let summary = "";
		if (estimatedTokens <= MAX_INPUT_TOKENS) {
			summary = await generateNonEmptyTextWithRetry(
				fullPrompt,
				"direct_summary",
				RESERVED_OUTPUT_TOKENS,
				1.2,
				options?.onProgress,
			);
			summary = await ensureSummaryCompleteness(
				fullPrompt,
				summary,
				"direct_summary",
				options?.onProgress,
			);
		} else {
			await options?.onProgress?.(
				[
					"⏳ 入力トークン見積もりが上限を超えたため、分割処理に切り替えています。",
					`推定入力トークン: ${estimatedTokens} / 許容入力予算: ${MAX_INPUT_TOKENS}`,
					"チャンク要約を生成後、最終サマリーを統合生成します。",
				].join("\n"),
			);

			const messageLines = messagesWithMeta.split("\n");
			const chunkPromptBase = buildChunkDigestPrompt(
				"",
				dateInfo,
				0,
				1,
				[],
				highlight,
			);
			const chunkPromptBaseTokens =
				await estimateTokensGptOss20bFromText(chunkPromptBase);
			const chunks = await splitMessagesByEstimatedTokens(
				messageLines,
				chunkPromptBaseTokens,
			);

			logInfo(`Daily summary split into ${chunks.length} chunks`);
			await options?.onProgress?.(
				[
					"⏳ 分割解析を開始します。",
					`チャンク数: ${chunks.length}`,
					"進捗はこのメッセージを更新して通知します。",
				].join("\n"),
			);

			const chunkDigests: string[] = [];
			const seenUrls = new Set<string>();

			for (const [index, chunk] of chunks.entries()) {
				const filteredChunkLines = chunk.filter((line) => {
					const lineUrls = extractDiscordUrls(line);
					if (lineUrls.length === 0) return true;
					return lineUrls.some((url) => !seenUrls.has(url));
				});
				if (filteredChunkLines.length === 0) {
					logInfo(
						`Chunk ${index + 1}/${chunks.length} skipped because all URLs are already covered`,
					);
					continue;
				}

				const chunkPrompt = buildChunkDigestPrompt(
					filteredChunkLines.join("\n"),
					dateInfo,
					index,
					chunks.length,
					Array.from(seenUrls).slice(-20),
					highlight,
				);

				const estimatedChunkTokens =
					await estimateTokensGptOss20bFromText(chunkPrompt);
				logInfo(
					`Chunk ${index + 1}/${chunks.length} estimated tokens: ${estimatedChunkTokens}`,
				);
				await options?.onProgress?.(
					[
						`⏳ Chunk ${index + 1}/${chunks.length} を処理中`,
						`Chunk ${index + 1}/${chunks.length} estimated tokens: ${estimatedChunkTokens}`,
					].join("\n"),
				);

				try {
					const chunkArticle = await generateNonEmptyTextWithRetry(
						chunkPrompt,
						`chunk_digest_${index + 1}_${chunks.length}`,
						MAX_CHUNK_OUTPUT_TOKENS,
						0.9,
						options?.onProgress,
					);
					const extractedUrls = extractDiscordUrls(chunkArticle);
					for (const url of extractedUrls) seenUrls.add(url);

					chunkDigests.push(
						`## chunk ${index + 1}/${chunks.length}\n${chunkArticle}`,
					);
				} catch (chunkError) {
					const errorMessage = `⚠️ パート ${index + 1}/${chunks.length} は生成失敗のためスキップしました。`;
					logError(`Chunk ${index + 1}/${chunks.length} failed: ${chunkError}`);
					await options?.onProgress?.(errorMessage);
				}
				await waitMs(500);
			}

			if (chunkDigests.length === 0) {
				throw new Error("All chunk digest generations failed");
			}

			const allChunkDigests = [...chunkDigests];
			let selectedChunkDigests = [...allChunkDigests];
			let mergedDigestSource = selectedChunkDigests.join("\n\n");
			let mergedPrompt = buildFinalSummaryPrompt(
				mergedDigestSource,
				dateInfo,
				"chunk_digests",
				highlight,
			);
			let mergedPromptTokens =
				await estimateTokensGptOss20bFromText(mergedPrompt);
			logInfo(
				`Merged digest prompt estimated input tokens: ${mergedPromptTokens}`,
			);

			let keepCount = selectedChunkDigests.length;
			while (mergedPromptTokens > MAX_INPUT_TOKENS && keepCount > 1) {
				keepCount -= 1;
				selectedChunkDigests = pickEvenlyDistributedItems(
					allChunkDigests,
					keepCount,
				);
				mergedDigestSource = selectedChunkDigests.join("\n\n");
				mergedPrompt = buildFinalSummaryPrompt(
					mergedDigestSource,
					dateInfo,
					"chunk_digests",
					highlight,
				);
				mergedPromptTokens =
					await estimateTokensGptOss20bFromText(mergedPrompt);
			}

			await options?.onProgress?.(
				[
					"⏳ チャンク要約を統合して最終サマリーを生成中です。",
					`統合入力トークン推定: ${mergedPromptTokens} / ${MAX_INPUT_TOKENS}`,
				].join("\n"),
			);

			summary = await generateNonEmptyTextWithRetry(
				mergedPrompt,
				"merged_summary_from_chunk_digests",
				RESERVED_OUTPUT_TOKENS,
				1.15,
				options?.onProgress,
			);
			summary = await ensureSummaryCompleteness(
				mergedPrompt,
				summary,
				"merged_summary_from_chunk_digests",
				options?.onProgress,
			);
		}

		// AIが生成した内容をそのまま返す（ハレ・ケ判定も含まれている）
		return summary;
	} catch (error) {
		logError(`Error generating daily summary: ${error}`);
		throw error;
	}
}
