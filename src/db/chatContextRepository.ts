import { getDatabase } from "./database";

export type ChatContextRole = "user" | "assistant";

export interface ChatContextMessage {
	id: number;
	role: ChatContextRole;
	content: string;
	createdAt: string;
}

interface ChatContextMessageRow {
	id: number;
	role: ChatContextRole;
	content: string;
	created_at: string;
}

const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_MESSAGE_LENGTH = 1200;
const MAX_CONTEXT_AGE_MS = 1000 * 60 * 60 * 6;

const isChatContextMessageRow = (
	value: unknown,
): value is ChatContextMessageRow => {
	if (!value || typeof value !== "object") return false;
	const row = value as Partial<ChatContextMessageRow>;

	return (
		typeof row.id === "number" &&
		(row.role === "user" || row.role === "assistant") &&
		typeof row.content === "string" &&
		typeof row.created_at === "string"
	);
};

const truncateContent = (content: string): string => {
	if (content.length <= MAX_CONTEXT_MESSAGE_LENGTH) {
		return content;
	}

	return content.slice(0, MAX_CONTEXT_MESSAGE_LENGTH);
};

class ChatContextRepository {
	public list(scopeId: string): ChatContextMessage[] {
		this.prune(scopeId);
		const rows = getDatabase()
			.prepare(`
				SELECT id, role, content, created_at
				FROM chat_context_messages
				WHERE scope_id = ?
				ORDER BY created_at ASC, id ASC
			`)
			.all(scopeId);

		const messages: ChatContextMessage[] = [];
		for (const row of rows) {
			if (!isChatContextMessageRow(row)) continue;

			messages.push({
				id: row.id,
				role: row.role,
				content: row.content,
				createdAt: row.created_at,
			});
		}

		return messages;
	}

	public add(scopeId: string, role: ChatContextRole, content: string): void {
		getDatabase()
			.prepare(`
				INSERT INTO chat_context_messages (scope_id, role, content, created_at)
				VALUES (?, ?, ?, ?)
			`)
			.run(scopeId, role, truncateContent(content), new Date().toISOString());
		this.prune(scopeId);
	}

	public clear(scopeId: string): void {
		getDatabase()
			.prepare("DELETE FROM chat_context_messages WHERE scope_id = ?")
			.run(scopeId);
	}

	private prune(scopeId: string): void {
		const expiresAt = new Date(Date.now() - MAX_CONTEXT_AGE_MS).toISOString();
		getDatabase()
			.prepare(
				"DELETE FROM chat_context_messages WHERE scope_id = ? AND created_at < ?",
			)
			.run(scopeId, expiresAt);

		getDatabase()
			.prepare(`
				DELETE FROM chat_context_messages
				WHERE scope_id = ?
					AND id NOT IN (
						SELECT id
						FROM chat_context_messages
						WHERE scope_id = ?
						ORDER BY created_at DESC, id DESC
						LIMIT ?
					)
			`)
			.run(scopeId, scopeId, MAX_CONTEXT_MESSAGES);
	}
}

export const chatContextRepository = new ChatContextRepository();
