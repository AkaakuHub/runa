import type { Guild } from "discord.js";

export function formatTTSInput(
	text: string,
	guild: Guild,
	textLengthLimit = 100,
): string {
	// コードブロック（```...```）を省略し，前後の文章は残す
	const fencedCodeBlockPattern = /```[\s\S]*?```|```[\s\S]*$/g;
	let processed = text.replace(fencedCodeBlockPattern, "こーどぶろっく");

	// URLを省略する
	const linkPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi;
	processed = processed.replace(linkPattern, "ゆーあーるえる");

	// @everyone,@hereを置き換える
	processed = processed.replace(/@everyone/g, "あっとえぶりわん");
	processed = processed.replace(/@here/g, "あっとひあ");

	// @mentionをユーザー名に置き換える
	const mentionPattern = /<@!?\d+>/g;
	processed = processed.replace(mentionPattern, (match) => {
		const userId = match.replace(/<@!?/, "").replace(">", "");
		const member = guild.members.cache.get(userId);
		return member ? `あっと${member.displayName}` : "あっとあんのうん";
	});

	// ロールメンションをロール名に置き換える
	const roleMentionPattern = /<@&\d+>/g;
	processed = processed.replace(roleMentionPattern, (match) => {
		const roleId = match.replace(/<@&/, "").replace(">", "");
		const role = guild.roles.cache.get(roleId);
		return role ? `あっと${role.name}` : "あんのうんろーる";
	});

	// チャンネルメンションをチャンネル名に置き換える
	const channelMentionPattern = /<#\d+>/g;
	processed = processed.replace(channelMentionPattern, (match) => {
		const channelId = match.replace(/<#/, "").replace(">", "");
		const channel = guild.channels.cache.get(channelId);
		return channel ? `${channel.name}` : "不明";
	});

	// カスタム絵文字を名前に置き換える
	const emojiPattern = /<a?:(\w+):[\d-]+>/g;
	processed = processed.replace(emojiPattern, "$1");

	// Guild Navigationを置き換え
	const guildNavigationPattern = /<id:(customize|browse|guide|linked-roles)>/g;
	processed = processed.replace(guildNavigationPattern, (match, p1: string) => {
		switch (p1) {
			case "customize":
				return "チャンネル&ロール";
			case "browse":
				return "チャンネル一覧";
			case "guide":
				return "サーバーガイド";
			case "linked-roles":
				return "連携ロール";
			default:
				return match;
		}
	});

	if (processed.length > textLengthLimit) {
		processed = `${processed.slice(0, textLengthLimit)}…`;
	}

	return processed;
}
