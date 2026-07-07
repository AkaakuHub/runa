export const getChannelContextScopeId = (
	guildId: string | null | undefined,
	channelId: string,
): string => `channel:${guildId ?? "dm"}:${channelId}`;
