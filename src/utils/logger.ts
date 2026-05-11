import { createLogger, format, transports } from "winston";

const allowedLogLevels = ["error", "warn", "info", "debug", "trace"] as const;
type AppLogLevel = (typeof allowedLogLevels)[number];

const levelPriority: Record<AppLogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4,
};

const envLogLevel = (process.env.LOG_LEVEL || "warn").toLowerCase();
const resolvedLogLevel: AppLogLevel = (
	allowedLogLevels.includes(envLogLevel as AppLogLevel) ? envLogLevel : "warn"
) as AppLogLevel;

const formatJstTimestamp = (): string => {
	const now = new Date();
	const parts = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(now);
	const byType = new Map(parts.map((part) => [part.type, part.value]));
	const milliseconds = now.getMilliseconds().toString().padStart(3, "0");

	return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")} ${byType.get("hour")}:${byType.get("minute")}:${byType.get("second")}.${milliseconds} JST`;
};

const logger = createLogger({
	levels: levelPriority,
	level: resolvedLogLevel,
	format: format.combine(
		format.timestamp({ format: formatJstTimestamp }),
		format.printf(({ timestamp, level, message }) => {
			return `${timestamp} [${level}]: ${message}`;
		}),
	),
	transports: [new transports.Console()],
});

const log = (level: AppLogLevel, message: string): void => {
	logger.log(level, message);
};

export const logError = (message: string): void => log("error", message);
export const logWarn = (message: string): void => log("warn", message);
export const logInfo = (message: string): void => log("info", message);
export const logDebug = (message: string): void => log("debug", message);
