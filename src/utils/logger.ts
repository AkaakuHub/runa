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

const logger = createLogger({
	levels: levelPriority,
	level: resolvedLogLevel,
	format: format.combine(
		format.timestamp(),
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
