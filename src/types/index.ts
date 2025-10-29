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
