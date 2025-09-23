import type { ChatInputCommandInteraction } from "discord.js";

export type IYAKind = "寝る！" | "起きる！" | "遊ぶ！" | "ご飯を食べる！";

interface CommandOption {
	name: string;
	description: string;
	type:
		| "STRING"
		| "INTEGER"
		| "BOOLEAN"
		| "USER"
		| "CHANNEL"
		| "ROLE"
		| "MENTIONABLE"
		| "NUMBER";
	required: boolean;
	choices?: Array<{
		name: string;
		value: string | number;
	}>;
	min_value?: number;
	max_value?: number;
}

export interface CommandDefinition {
	name: string;
	description: string;
	options?: CommandOption[];
	execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// ハレ・ケ判定結果の型
export interface HareKeResult {
	isHare: boolean;
	score: number;
	level:
		| "dai-hare"
		| "hare"
		| "yaya-hare"
		| "neutral"
		| "yaya-ke"
		| "ke"
		| "dai-ke";
	emoji: string;
	title: string;
	breakdown: {
		activity: { score: number; reason: string };
		emotion: { score: number; reason: string };
		tradition: { score: number; reason: string };
		nature: { score: number; reason: string };
		fortune: { score: number; reason: string };
	};
	message: string;
}

// メッセージデータの型
export interface MessageData {
	content: string;
	author: string;
	timestamp: Date;
	channel: string;
}
