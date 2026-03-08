export type SimpleSingNote = {
	key: number | null;
	frame_length: number;
	lyric: string;
};

export type SimpleSingScore = {
	notes: SimpleSingNote[];
};

export type TalkRequest = (
	url: URL,
	option: RequestInit,
) => Promise<Response | undefined>;
