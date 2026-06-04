import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";

export interface BotClientConfig {
	id: string;
	name: string;
	token: string;
	clientId: string;
	guildId: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

interface BotClientRow {
	id: string;
	name: string;
	token: string;
	client_id: string;
	guild_id: string;
	enabled: number;
	created_at: string;
	updated_at: string;
}

interface UpsertBotClientParams {
	id?: string;
	name: string;
	token: string;
	clientId: string;
	guildId: string;
	enabled: boolean;
}

function isBotClientRow(value: unknown): value is BotClientRow {
	if (!value || typeof value !== "object") {
		return false;
	}

	const row = value as Record<string, unknown>;
	return (
		typeof row.id === "string" &&
		typeof row.name === "string" &&
		typeof row.token === "string" &&
		typeof row.client_id === "string" &&
		typeof row.guild_id === "string" &&
		typeof row.enabled === "number" &&
		typeof row.created_at === "string" &&
		typeof row.updated_at === "string"
	);
}

function toConfig(row: BotClientRow): BotClientConfig {
	return {
		id: row.id,
		name: row.name,
		token: row.token,
		clientId: row.client_id,
		guildId: row.guild_id,
		enabled: row.enabled === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

class BotClientRepository {
	public list(): BotClientConfig[] {
		const rows = getDatabase()
			.prepare("SELECT * FROM bot_clients ORDER BY created_at ASC")
			.all();
		const configs: BotClientConfig[] = [];
		for (const row of rows) {
			if (isBotClientRow(row)) {
				configs.push(toConfig(row));
			}
		}
		return configs;
	}

	public listEnabled(): BotClientConfig[] {
		const rows = getDatabase()
			.prepare(
				"SELECT * FROM bot_clients WHERE enabled = 1 ORDER BY created_at ASC",
			)
			.all();
		const configs: BotClientConfig[] = [];
		for (const row of rows) {
			if (isBotClientRow(row)) {
				configs.push(toConfig(row));
			}
		}
		return configs;
	}

	public isEmpty(): boolean {
		const row = getDatabase()
			.prepare("SELECT COUNT(*) AS count FROM bot_clients")
			.get();
		if (!row || typeof row !== "object") {
			return true;
		}
		const count = (row as { count?: unknown }).count;
		return typeof count !== "number" || count === 0;
	}

	public upsert(params: UpsertBotClientParams): BotClientConfig {
		const now = new Date().toISOString();
		const id = params.id || randomUUID();
		const existing = params.id ? this.find(params.id) : undefined;

		if (existing) {
			getDatabase()
				.prepare(`
					UPDATE bot_clients
					SET name = ?, token = ?, client_id = ?, guild_id = ?, enabled = ?, updated_at = ?
					WHERE id = ?
				`)
				.run(
					params.name,
					params.token,
					params.clientId,
					params.guildId,
					params.enabled ? 1 : 0,
					now,
					id,
				);
		} else {
			getDatabase()
				.prepare(`
					INSERT INTO bot_clients
						(id, name, token, client_id, guild_id, enabled, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`)
				.run(
					id,
					params.name,
					params.token,
					params.clientId,
					params.guildId,
					params.enabled ? 1 : 0,
					now,
					now,
				);
		}

		const saved = this.find(id);
		if (!saved) {
			throw new Error("bot client save failed");
		}
		return saved;
	}

	public find(id: string): BotClientConfig | undefined {
		const row = getDatabase()
			.prepare("SELECT * FROM bot_clients WHERE id = ?")
			.get(id);
		return isBotClientRow(row) ? toConfig(row) : undefined;
	}

	public delete(id: string): void {
		getDatabase().prepare("DELETE FROM bot_clients WHERE id = ?").run(id);
	}
}

export const botClientRepository = new BotClientRepository();
