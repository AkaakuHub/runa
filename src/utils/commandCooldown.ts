import type { ChatInputCommandInteraction } from "discord.js";
import { commandCooldownService } from "../services/CommandCooldownService";

interface CommandCooldownOptions {
	commandName: string;
	cooldownMs?: number;
}

function formatCooldownDuration(remainingMs: number): string {
	const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		if (minutes > 0) {
			return `${hours}時間${minutes}分`;
		}
		return `${hours}時間`;
	}

	if (minutes > 0) {
		if (seconds > 0) {
			return `${minutes}分${seconds}秒`;
		}
		return `${minutes}分`;
	}

	return `${seconds}秒`;
}

export async function checkCommandCooldown(
	interaction: ChatInputCommandInteraction,
	options: CommandCooldownOptions,
): Promise<boolean> {
	if (!options.cooldownMs) {
		return true;
	}

	const result = commandCooldownService.checkAndConsume({
		commandName: options.commandName,
		userId: interaction.user.id,
		cooldownMs: options.cooldownMs,
	});

	if (result.allowed) {
		return true;
	}

	await interaction.reply({
		content: `このコマンドはクールタイム中です。あと${formatCooldownDuration(result.remainingMs)}待ってから再実行してください。`,
		ephemeral: true,
	});

	return false;
}
