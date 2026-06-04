import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

let database: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
	if (!database) {
		const dbPath = join(process.cwd(), "data", "runa.sqlite");
		mkdirSync(dirname(dbPath), { recursive: true });
		database = new DatabaseSync(dbPath);
		database.exec("PRAGMA journal_mode = WAL");
		database.exec("PRAGMA foreign_keys = ON");
		migrateDatabase(database);
	}

	return database;
}

function migrateDatabase(db: DatabaseSync): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS bot_clients (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			token TEXT NOT NULL,
			client_id TEXT NOT NULL,
			guild_id TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS app_state (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS ng_words (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			word TEXT NOT NULL UNIQUE,
			enabled INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`);
}
