export const JST_DATE_OPTION_DESCRIPTION = "日付（JST、例：2025-06-30）";

export const JST_TIME_OPTION_DESCRIPTION = "時刻（JST、例：09:30）";

interface DateParts {
	year: number;
	month: number;
	day: number;
}

interface TimeParts {
	hour: number;
	minute: number;
	second: number;
}

export function parseJSTDateInput(dateString: string): DateParts {
	const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) {
		throw new Error("日付は `YYYY-MM-DD` 形式で指定してください。");
	}

	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	const date = new Date(Date.UTC(year, month - 1, day));

	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		throw new Error("存在する日付を指定してください。");
	}

	return { year, month, day };
}

function parseJSTTimeInput(timeString: string): TimeParts {
	const match = timeString.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (!match) {
		throw new Error("時刻は `HH:mm` 形式で指定してください。");
	}

	const hour = Number.parseInt(match[1], 10);
	const minute = Number.parseInt(match[2], 10);
	const second = match[3] ? Number.parseInt(match[3], 10) : 0;

	if (
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59 ||
		second < 0 ||
		second > 59
	) {
		throw new Error("存在する時刻を指定してください。");
	}

	return { hour, minute, second };
}

export function parseJSTDateTimeInput(
	dateString: string,
	timeString: string,
): Date {
	const date = parseJSTDateInput(dateString);
	const time = parseJSTTimeInput(timeString);

	return buildJSTDateTime(date, time);
}

export function getJSTDateInputFromDate(date: Date): string {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

export function getJSTTimeInputFromDate(date: Date): string {
	return new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Tokyo",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

function buildJSTDateTime(date: DateParts, time: TimeParts): Date {
	const isoString = `${date.year}-${pad2(date.month)}-${pad2(date.day)}T${pad2(time.hour)}:${pad2(time.minute)}:${pad2(time.second)}+09:00`;
	return new Date(isoString);
}

function pad2(value: number): string {
	return value.toString().padStart(2, "0");
}
