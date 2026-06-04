import { basename } from "node:path";
import { getDatabase } from "./database";

interface StateRow {
	value: string;
}

function isStateRow(value: unknown): value is StateRow {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as { value?: unknown }).value === "string"
	);
}

function getStateKey(filePath: string): string {
	return basename(filePath, ".json");
}

class StateStore {
	public read<T>(filePath: string, fallback: T): T {
		const key = getStateKey(filePath);
		const row = getDatabase()
			.prepare("SELECT value FROM app_state WHERE key = ?")
			.get(key);
		if (isStateRow(row)) {
			try {
				return JSON.parse(row.value) as T;
			} catch {
				return fallback;
			}
		}

		return fallback;
	}

	public write<T>(filePath: string, data: T): void {
		const key = getStateKey(filePath);
		getDatabase()
			.prepare(`
				INSERT INTO app_state (key, value, updated_at)
				VALUES (?, ?, ?)
				ON CONFLICT(key) DO UPDATE SET
					value = excluded.value,
					updated_at = excluded.updated_at
			`)
			.run(key, JSON.stringify(data), new Date().toISOString());
	}
}

export const stateStore = new StateStore();
