import { SlashCommandBuilder } from "discord.js";
import { CommandDefinition } from "../types";

// コマンドのコレクション
let commands: CommandDefinition[] = [];

/**
 * コマンドを登録する
 * @param commandsList コマンド定義の配列
 */
export const registerCommands = (commandsList: CommandDefinition[]): void => {
	commands = commandsList;
};

/**
 * 登録されたすべてのコマンドを取得する
 */
export const getCommands = (): CommandDefinition[] => {
	return commands;
};

/**
 * 名前でコマンドを取得する
 * @param name コマンド名
 */
export const getCommandByName = (
	name: string,
): CommandDefinition | undefined => {
	return commands.find((cmd) => cmd.name === name);
};

/**
 * SlashCommandBuilderオブジェクトのリストを取得する（deploy-commands用）
 */
export const getCommandBuilders = (): object[] => {
	return commands.map((cmd) => {
		const builder = new SlashCommandBuilder()
			.setName(cmd.name)
			.setDescription(cmd.description);

		// オプションがある場合、それらを追加
		if (cmd.options && cmd.options.length > 0) {
			for (const option of cmd.options) {
				switch (option.type) {
					case "STRING":
						builder.addStringOption((opt) => {
							opt
								.setName(option.name)
								.setDescription(option.description)
								.setRequired(option.required);

							if (option.choices) {
								for (const choice of option.choices) {
									opt.addChoices({
										name: choice.name,
										value: choice.value as string,
									});
								}
							}
							return opt;
						});
						break;
					case "INTEGER":
						builder.addIntegerOption((opt) => {
							opt
								.setName(option.name)
								.setDescription(option.description)
								.setRequired(option.required);

							if (option.min_value !== undefined) {
								opt.setMinValue(option.min_value);
							}
							if (option.max_value !== undefined) {
								opt.setMaxValue(option.max_value);
							}

							if (option.choices) {
								for (const choice of option.choices) {
									opt.addChoices({
										name: choice.name,
										value: choice.value as number,
									});
								}
							}
							return opt;
						});
						break;
					// 他のタイプも必要に応じて追加
				}
			}
		}

		return builder.toJSON();
	});
};
