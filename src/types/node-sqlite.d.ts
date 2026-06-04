declare module "node:sqlite" {
	export class DatabaseSync {
		constructor(path: string);
		exec(sql: string): void;
		prepare(sql: string): StatementSync;
		close(): void;
	}

	export class StatementSync {
		run(...values: unknown[]): {
			changes: number;
			lastInsertRowid: number | bigint;
		};
		get(...values: unknown[]): unknown;
		all(...values: unknown[]): unknown[];
	}
}
