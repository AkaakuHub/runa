/**
 * 日付処理の統一ユーティリティ
 * 全ての日付計算はこのファイルから関数をimportして使用すること
 */

/**
 * 現在のJST時刻を取得（標準APIを使用）
 */
export const getCurrentJSTDate = (): Date => {
	const now = new Date();
	// Asia/Tokyo タイムゾーンでの現在時刻を文字列として取得
	const jstString = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
	// sv-SE ロケールは YYYY-MM-DD HH:mm:ss 形式を返す
	return new Date(jstString);
};

/**
 * 指定JST日付の開始時刻（00:00:00）のUTCタイムスタンプを取得
 */
export const getJSTDayStartUTC = (year: number, month: number, day: number): Date => {
	// ISO形式でJST時刻を指定（+09:00 タイムゾーン）
	const jstISOString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000+09:00`;
	return new Date(jstISOString);
};

/**
 * 指定JST日付の終了時刻（23:59:59）のUTCタイムスタンプを取得
 */
export const getJSTDayEndUTC = (year: number, month: number, day: number): Date => {
	// ISO形式でJST時刻を指定（+09:00 タイムゾーン）
	const jstISOString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59.999+09:00`;
	return new Date(jstISOString);
};

/**
 * 文字列（YYYY-MM-DD）からJSTの日付範囲を取得
 */
export const parseJSTDateRange = (dateString: string): { start: Date; end: Date } => {
	const [year, month, day] = dateString.split('-').map(Number);
	if (!year || !month || !day) {
		throw new Error('Invalid date format. Use YYYY-MM-DD format.');
	}
	
	return {
		start: getJSTDayStartUTC(year, month, day),
		end: getJSTDayEndUTC(year, month, day)
	};
};

/**
 * 現在のJST日付の範囲を取得（今日の00:00:00 - 23:59:59）
 */
export const getCurrentJSTDateRange = (): { start: Date; end: Date } => {
	const jstNow = getCurrentJSTDate();
	const year = jstNow.getFullYear();
	const month = jstNow.getMonth() + 1;
	const day = jstNow.getDate();
	
	return {
		start: getJSTDayStartUTC(year, month, day),
		end: getJSTDayEndUTC(year, month, day)
	};
};

/**
 * 指定日数前までのJST日付範囲を取得
 */
export const getJSTDateRangeFromDaysBack = (daysBack: number): { start: Date; end: Date } => {
	const jstNow = getCurrentJSTDate();
	const endYear = jstNow.getFullYear();
	const endMonth = jstNow.getMonth() + 1;
	const endDay = jstNow.getDate();
	
	const startJst = getCurrentJSTDate();
	startJst.setDate(startJst.getDate() - daysBack);
	startJst.setHours(0, 0, 0, 0);
	
	// startJstの年月日を取得してUTC時刻に変換
	const startYear = startJst.getFullYear();
	const startMonth = startJst.getMonth() + 1;
	const startDay = startJst.getDate();
	
	return {
		start: getJSTDayStartUTC(startYear, startMonth, startDay),
		end: getJSTDayEndUTC(endYear, endMonth, endDay)
	};
};

/**
 * JST日付をローカル日付オブジェクトに変換（ハレ・ケ判定用）
 */
export const getJSTDateForJudgment = (dateString?: string): Date => {
	if (dateString) {
		const [year, month, day] = dateString.split('-').map(Number);
		return new Date(year, month - 1, day);
	}
	
	const jstNow = getCurrentJSTDate();
	return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate());
};

/**
 * 日付を詳細な日本語ロケール文字列に変換
 */
export const formatToDetailedJapaneseDate = (date: Date): string => {
	return date.toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		weekday: 'long'
	});
};

/**
 * 現在の日付を詳細な日本語形式で表示
 */
export const getCurrentJSTDateString = (): string => {
	return formatToDetailedJapaneseDate(getCurrentJSTDate());
};

/**
 * 月相を簡易計算（2025年1月13日を新月基準）
 */
export const getMoonPhase = (date: Date): string => {
	const baseDate = new Date('2025-01-13');
	const diffDays = Math.floor((date.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));
	const cycle = ((diffDays % 29.5) + 29.5) % 29.5;

	if (cycle < 2 || cycle > 27.5) {
		return '新月';
	}
	if (cycle >= 5 && cycle <= 9) {
		return '上弦の月';
	}
	if (cycle >= 12.75 && cycle <= 16.75) {
		return '満月';
	}
	if (cycle >= 20 && cycle <= 24) {
		return '下弦の月';
	}
	return '月';
};

/**
 * 六曜を計算（簡易計算）
 */
export const getRokuyou = (date: Date): string => {
	const rokuyouList = ['先勝', '友引', '先負', '仏滅', '大安', '赤口'] as const;
	const month = date.getMonth() + 1;
	const day = date.getDate();
	const index = (month + day) % 6;
	return rokuyouList[index];
};

/**
 * 現在のタイムスタンプを取得
 */
export const getCurrentTimestamp = (): number => {
	return getTimestamp(getCurrentJSTDate());
};

/**
 * 日付を日本語ロケール文字列に変換
 */
export const formatToJapaneseDate = (date: Date): string => {
	return date.toLocaleDateString("ja-JP");
};

/**
 * 日付を日本語時刻文字列に変換
 */
export const formatToJapaneseTime = (date: Date): string => {
	return date.toLocaleTimeString("ja-JP");
};

/**
 * 日付から時間を取得
 */
export const getHours = (date: Date): number => {
	return date.getHours();
};

/**
 * 日付から月と日を取得してMM-DD形式で返す
 */
export const getMonthDay = (date: Date): string => {
	return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * 日付から曜日番号を取得
 */
export const getDayOfWeek = (date: Date): number => {
	return date.getDay();
};

/**
 * 日付から月を取得
 */
export const getMonth = (date: Date): number => {
	return date.getMonth() + 1;
};

/**
 * 日付から日を取得
 */
export const getDay = (date: Date): number => {
	return date.getDate();
};

/**
 * 日付から年月日を取得してシード値を計算
 */
export const getDateSeed = (date: Date): number => {
	return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
};

/**
 * 日付のタイムスタンプを取得
 */
export const getTimestamp = (date: Date): number => {
	return date.getTime();
};

/**
 * 日付をUTC年月日形式で取得
 */
export const getUTCDateString = (date: Date): string => {
	return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
};

/**
 * 日付をローカル年月日形式で取得
 */
export const getLocalDateString = (date: Date): string => {
	return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

/**
 * 2つの日付の時間差を日数で計算
 */
export const getDaysDifference = (date1: Date, date2: Date): number => {
	return Math.floor((date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24));
};