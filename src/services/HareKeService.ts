import { logInfo } from "../utils/logger";
import type { HareKeResult, MessageData } from "../types";
import {
	getMoonPhase,
	getRokuyou,
	getHours,
	getMonthDay,
	getDayOfWeek,
	getMonth,
	getDay,
	getDateSeed,
} from "../utils/dateUtils";

// ポジティブ/ネガティブ判定用の単語リスト
const POSITIVE_WORDS = [
	"ありがとう",
	"おめでとう",
	"嬉しい",
	"楽しい",
	"面白い",
	"素晴らしい",
	"良い",
	"いいね",
	"最高",
	"すごい",
	"頑張",
	"成功",
	"勝利",
	"達成",
	"完成",
	"解決",
	"発見",
	"進歩",
	"笑",
	"www",
	"w",
	"😊",
	"😄",
	"😆",
	"🎉",
	"✨",
	"👍",
	"❤️",
	"💕",
	"🥰",
	"やった",
	"よし",
	"おお",
	"わーい",
	"やったー",
	"すげー",
	"かっこいい",
	"かわいい",
] as const;

const NEGATIVE_WORDS = [
	"疲れた",
	"しんどい",
	"つらい",
	"悲しい",
	"困った",
	"大変",
	"厳しい",
	"辛い",
	"失敗",
	"問題",
	"エラー",
	"バグ",
	"故障",
	"不具合",
	"遅延",
	"中断",
	"停止",
	"だめ",
	"まずい",
	"やばい",
	"心配",
	"不安",
	"迷惑",
	"うざい",
	"むかつく",
	"😢",
	"😭",
	"😰",
	"😓",
	"💦",
	"😵",
	"🤦",
	"😤",
	"💔",
	"😞",
] as const;

// 祝日判定（簡易版 - 2025年の主要祝日）
const HOLIDAYS = new Map([
	["01-01", "元日"],
	["01-13", "成人の日"],
	["02-11", "建国記念の日"],
	["02-23", "天皇誕生日"],
	["03-20", "春分の日"],
	["04-29", "昭和の日"],
	["05-03", "憲法記念日"],
	["05-04", "みどりの日"],
	["05-05", "こどもの日"],
	["07-21", "海の日"],
	["08-11", "山の日"],
	["09-15", "敬老の日"],
	["09-23", "秋分の日"],
	["10-13", "スポーツの日"],
	["11-03", "文化の日"],
	["11-23", "勤労感謝の日"],
	["12-23", "天皇誕生日（旧）"],
]);

/**
 * メインの判定関数
 */
const judgeHareKe = async (
	messages: MessageData[],
	targetDate: Date,
): Promise<HareKeResult> => {
	const breakdown = {
		activity: judgeActivity(messages),
		emotion: judgeEmotion(messages),
		tradition: judgeTradition(targetDate),
		nature: judgeNature(targetDate),
		fortune: judgeFortune(targetDate),
	};

	// 重みづけした合計スコア計算
	const totalScore = Math.round(
		breakdown.activity.score * 0.35 +
			breakdown.emotion.score * 0.25 +
			breakdown.tradition.score * 0.2 +
			breakdown.nature.score * 0.15 +
			breakdown.fortune.score * 0.05,
	);

	const level = getLevel(totalScore);
	const { emoji, title } = getLevelInfo(level);
	const message = generateMessage(level, breakdown);

	logInfo(`HareKe judgment completed: ${totalScore}% (${level})`);

	return {
		isHare: totalScore >= 50,
		score: totalScore,
		level,
		emoji,
		title,
		breakdown,
		message,
	};
};

/**
 * 活動度判定 (35%)
 */
function judgeActivity(messages: MessageData[]): {
	score: number;
	reason: string;
} {
	const messageCount = messages.length;
	const uniqueAuthors = new Set(messages.map((m) => m.author)).size;

	// 時間分布の計算（一日を通してメッセージが分散しているか）
	const hourDistribution = new Array(24).fill(0);
	for (const msg of messages) {
		const hour = getHours(msg.timestamp);
		hourDistribution[hour]++;
	}
	const activeHours = hourDistribution.filter((count) => count > 0).length;

	let score = 0;
	const reasons: string[] = [];

	// メッセージ数による加点
	if (messageCount >= 50) {
		score += 40;
		reasons.push(`活発(${messageCount}件)`);
	} else if (messageCount >= 20) {
		score += 25;
		reasons.push(`適度(${messageCount}件)`);
	} else if (messageCount >= 5) {
		score += 10;
		reasons.push(`少な目(${messageCount}件)`);
	} else {
		reasons.push(`静か(${messageCount}件)`);
	}

	// 参加者数による加点
	if (uniqueAuthors >= 5) {
		score += 30;
		reasons.push(`多数参加(${uniqueAuthors}人)`);
	} else if (uniqueAuthors >= 3) {
		score += 20;
		reasons.push(`複数参加(${uniqueAuthors}人)`);
	} else if (uniqueAuthors >= 2) {
		score += 10;
		reasons.push(`少数参加(${uniqueAuthors}人)`);
	}

	// 時間分散による加点
	if (activeHours >= 8) {
		score += 30;
		reasons.push("一日通して活動");
	} else if (activeHours >= 4) {
		score += 15;
		reasons.push("適度に分散");
	}

	return {
		score: Math.min(score, 100),
		reason: reasons.join("・"),
	};
}

/**
 * 感情度判定 (25%)
 */
function judgeEmotion(messages: MessageData[]): {
	score: number;
	reason: string;
} {
	let positiveCount = 0;
	let negativeCount = 0;

	for (const msg of messages) {
		const content = msg.content.toLowerCase();

		for (const word of POSITIVE_WORDS) {
			if (content.includes(word)) positiveCount++;
		}

		for (const word of NEGATIVE_WORDS) {
			if (content.includes(word)) negativeCount++;
		}
	}

	const totalEmotions = positiveCount + negativeCount;
	let score = 50; // ベーススコア
	const reasons: string[] = [];

	if (totalEmotions === 0) {
		reasons.push("感情表現少な目");
	} else {
		const positiveRatio = positiveCount / totalEmotions;

		if (positiveRatio >= 0.8) {
			score = 90;
			reasons.push(`とてもポジティブ(+${positiveCount})`);
		} else if (positiveRatio >= 0.6) {
			score = 75;
			reasons.push(`ポジティブ(+${positiveCount}/-${negativeCount})`);
		} else if (positiveRatio >= 0.4) {
			score = 55;
			reasons.push(`やや明るめ(+${positiveCount}/-${negativeCount})`);
		} else if (positiveRatio >= 0.2) {
			score = 35;
			reasons.push(`やや沈み気味(-${negativeCount}/+${positiveCount})`);
		} else {
			score = 15;
			reasons.push(`ネガティブ(-${negativeCount})`);
		}
	}

	return { score, reason: reasons.join("・") };
}

/**
 * 伝統度判定 (20%)
 */
function judgeTradition(date: Date): { score: number; reason: string } {
	let score = 50; // ベーススコア
	const reasons: string[] = [];

	// 祝日チェック
	const monthDay = getMonthDay(date);
	const holiday = HOLIDAYS.get(monthDay);
	if (holiday) {
		score += 30;
		reasons.push(holiday);
	}

	// 六曜チェック
	const rokuyou = getRokuyou(date);
	switch (rokuyou) {
		case "大安":
			score += 25;
			reasons.push("大安");
			break;
		case "友引":
			score += 15;
			reasons.push("友引");
			break;
		case "先勝":
			score += 10;
			reasons.push("先勝");
			break;
		case "赤口":
			score -= 5;
			reasons.push("赤口");
			break;
		case "仏滅":
			score -= 15;
			reasons.push("仏滅");
			break;
		default:
			reasons.push(rokuyou);
	}

	// 月相チェック（統一されたユーティリティを使用）
	const moonPhase = getMoonPhase(date);
	if (moonPhase === "満月") {
		score += 15;
		reasons.push("満月");
	} else if (moonPhase === "新月") {
		score += 5;
		reasons.push("新月");
	} else {
		reasons.push(moonPhase);
	}

	return {
		score: Math.max(0, Math.min(score, 100)),
		reason: reasons.join("・"),
	};
}

/**
 * 自然度判定 (15%)
 */
function judgeNature(date: Date): { score: number; reason: string } {
	let score = 50; // ベーススコア
	const reasons: string[] = [];

	// 曜日チェック
	const dayOfWeek = getDayOfWeek(date);
	if (dayOfWeek === 5) {
		// 金曜日
		score += 20;
		reasons.push("金曜日");
	} else if (dayOfWeek === 6 || dayOfWeek === 0) {
		// 土日
		score += 25;
		reasons.push(dayOfWeek === 6 ? "土曜日" : "日曜日");
	} else if (dayOfWeek === 1) {
		// 月曜日
		score -= 10;
		reasons.push("月曜日");
	} else {
		const days = ["日", "月", "火", "水", "木", "金", "土"];
		reasons.push(`${days[dayOfWeek]}曜日`);
	}

	// 季節チェック
	const month = getMonth(date);
	if (month === 3 || month === 4 || month === 5) {
		score += 15;
		reasons.push("春");
	} else if (month === 9 || month === 10 || month === 11) {
		score += 10;
		reasons.push("秋");
	} else if (month === 12 || month === 1 || month === 2) {
		score += 5;
		reasons.push("冬");
	} else {
		reasons.push("夏");
	}

	// 特別な日付チェック
	const day = getDay(date);
	if (day === 1) {
		score += 10;
		reasons.push("月初");
	} else if (day >= 28) {
		score += 5;
		reasons.push("月末");
	}

	return {
		score: Math.max(0, Math.min(score, 100)),
		reason: reasons.join("・"),
	};
}

/**
 * 運命度判定 (5%)
 */
function judgeFortune(date: Date): { score: number; reason: string } {
	// 日付をシードとした疑似ランダム
	const seed = getDateSeed(date);
	const random = ((seed * 9301 + 49297) % 233280) / 233280;

	const score = Math.round(random * 100);
	let reason: string;

	if (score >= 85) {
		reason = "特別な予感";
	} else if (score >= 65) {
		reason = "良い流れ";
	} else if (score >= 35) {
		reason = "普通の運気";
	} else if (score >= 15) {
		reason = "やや低調";
	} else {
		reason = "おとなしく";
	}

	return { score, reason };
}

/**
 * スコアからレベルを決定
 */
function getLevel(score: number): HareKeResult["level"] {
	if (score >= 90) return "dai-hare";
	if (score >= 70) return "hare";
	if (score >= 55) return "yaya-hare";
	if (score >= 45) return "neutral";
	if (score >= 31) return "yaya-ke";
	if (score >= 11) return "ke";
	return "dai-ke";
}

/**
 * レベルに応じた絵文字とタイトルを取得
 */
function getLevelInfo(level: HareKeResult["level"]): {
	emoji: string;
	title: string;
} {
	switch (level) {
		case "dai-hare":
			return { emoji: "🎊", title: "今日は大ハレの日でした！" };
		case "hare":
			return { emoji: "🌸", title: "今日はハレの日でした" };
		case "yaya-hare":
			return { emoji: "☀️", title: "今日はややハレの日でした" };
		case "neutral":
			return { emoji: "⚖️", title: "今日はどちらでもない日でした" };
		case "yaya-ke":
			return { emoji: "🌙", title: "今日はややケの日でした" };
		case "ke":
			return { emoji: "🕯️", title: "今日はケの日でした" };
		case "dai-ke":
			return { emoji: "🤫", title: "今日は大ケの日でした" };
	}
}

/**
 * レベルに応じたメッセージを生成
 */
function generateMessage(
	level: HareKeResult["level"],
	breakdown: HareKeResult["breakdown"],
): string {
	const messages = {
		"dai-hare": [
			"今日のような素晴らしい日は滅多にありません！この勢いを大切にしてください。",
			"最高の一日でしたね！きっと明日も良いことが待っています。",
			"完璧な一日！今日の幸せを胸に、明日も頑張りましょう。",
		],
		hare: [
			"今日のハレの勢いを大切に、明日も素敵な一日になりそうです！",
			"良い一日でしたね。この調子で明日も楽しく過ごしましょう。",
			"ハレの日らしい充実した時間でした。明日への期待が高まります。",
		],
		"yaya-hare": [
			"まずまず良い一日でした。明日はもっと良いことがありそう！",
			"悪くない一日でした。明日はさらに輝けそうな予感です。",
			"そこそこ充実した日でした。明日への希望を持って休みましょう。",
		],
		neutral: [
			"平穏な一日でした。明日は何か新しいことが起こるかもしれません。",
			"バランスの取れた日でした。明日はどちらに転ぶか楽しみです。",
			"穏やかな一日。明日は新しい可能性が待っているかもしれません。",
		],
		"yaya-ke": [
			"少し落ち着いた一日でした。明日は気分転換を心がけてみては？",
			"やや静かな日でした。明日は新しい風が吹くかもしれません。",
			"おとなしい一日でした。明日は積極的に行動してみましょう。",
		],
		ke: [
			"静かな一日でした。こんな日も大切です。ゆっくり休んで明日に備えましょう。",
			"落ち着いた日でした。明日に向けてエネルギーを蓄える時間でしたね。",
			"穏やかな時間でした。明日は新たな気持ちでスタートできそうです。",
		],
		"dai-ke": [
			"とても静かな一日でした。心を落ち着けて、明日への準備を整えましょう。",
			"深く静寂な日でした。こういう日も人生には必要です。ゆっくり休息を。",
			"内省的な一日でした。明日は新しい気持ちで迎えられそうです。",
		],
	};

	const messageArray = messages[level];
	const seed = Object.values(breakdown).reduce(
		(sum, item) => sum + item.score,
		0,
	);
	const index = seed % messageArray.length;
	return messageArray[index];
}

// 互換性のためのエイリアス
export const HareKeService = { judge: judgeHareKe };
