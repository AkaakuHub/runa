import { join } from "node:path";
import { readJsonFileSync, writeJsonFileSync } from "../utils/jsonFile";
import { logError } from "../utils/logger";

interface CommandCooldownStore {
	[commandName: string]: {
		[userId: string]: number;
	};
}

interface CommandCooldownCheckParams {
	commandName: string;
	userId: string;
	cooldownMs: number;
}

interface CommandCooldownCheckResult {
	allowed: boolean;
	remainingMs: number;
}

class CommandCooldownService {
	private readonly storagePath = join(
		process.cwd(),
		"data",
		"command-cooldowns.json",
	);

	private store: CommandCooldownStore = {};

	constructor() {
		this.store = readJsonFileSync<CommandCooldownStore>(this.storagePath, {});
	}

	public checkAndConsume({
		commandName,
		userId,
		cooldownMs,
	}: CommandCooldownCheckParams): CommandCooldownCheckResult {
		if (cooldownMs <= 0) {
			return {
				allowed: true,
				remainingMs: 0,
			};
		}

		const now = Date.now();
		const commandStore = this.store[commandName] ?? {};
		const lastExecutedAt = commandStore[userId];

		if (
			typeof lastExecutedAt === "number" &&
			now - lastExecutedAt < cooldownMs
		) {
			return {
				allowed: false,
				remainingMs: cooldownMs - (now - lastExecutedAt),
			};
		}

		this.store[commandName] = {
			...commandStore,
			[userId]: now,
		};
		this.persist();

		return {
			allowed: true,
			remainingMs: 0,
		};
	}

	private persist(): void {
		try {
			writeJsonFileSync(this.storagePath, this.store);
		} catch (error) {
			logError(`Failed to save command cooldowns: ${error}`);
		}
	}
}

export const commandCooldownService = new CommandCooldownService();
