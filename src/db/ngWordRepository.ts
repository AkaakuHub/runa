import { getDatabase } from "./database";

export interface NgWord {
	id: number;
	word: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

interface NgWordRow {
	id: number;
	word: string;
	enabled: number;
	created_at: string;
	updated_at: string;
}

function isNgWordRow(value: unknown): value is NgWordRow {
	if (!value || typeof value !== "object") {
		return false;
	}

	const row = value as Record<string, unknown>;
	return (
		typeof row.id === "number" &&
		typeof row.word === "string" &&
		typeof row.enabled === "number" &&
		typeof row.created_at === "string" &&
		typeof row.updated_at === "string"
	);
}

function toNgWord(row: NgWordRow): NgWord {
	return {
		id: row.id,
		word: row.word,
		enabled: row.enabled === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

class NgWordRepository {
	public list(): NgWord[] {
		const rows = getDatabase()
			.prepare("SELECT * FROM ng_words ORDER BY word ASC")
			.all();
		const words: NgWord[] = [];
		for (const row of rows) {
			if (isNgWordRow(row)) {
				words.push(toNgWord(row));
			}
		}
		return words;
	}

	public listEnabledWords(): string[] {
		return this.list()
			.filter((word) => word.enabled)
			.map((word) => word.word);
	}

	public add(word: string): void {
		const normalizedWord = word.trim();
		if (!normalizedWord) {
			return;
		}

		const now = new Date().toISOString();
		getDatabase()
			.prepare(`
				INSERT INTO ng_words (word, enabled, created_at, updated_at)
				VALUES (?, 1, ?, ?)
				ON CONFLICT(word) DO UPDATE SET
					enabled = 1,
					updated_at = excluded.updated_at
			`)
			.run(normalizedWord, now, now);
	}

	public setEnabled(id: number, enabled: boolean): void {
		getDatabase()
			.prepare("UPDATE ng_words SET enabled = ?, updated_at = ? WHERE id = ?")
			.run(enabled ? 1 : 0, new Date().toISOString(), id);
	}

	public delete(id: number): void {
		getDatabase().prepare("DELETE FROM ng_words WHERE id = ?").run(id);
	}
}

export const ngWordRepository = new NgWordRepository();
