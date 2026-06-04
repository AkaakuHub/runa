import type { TTSAudioProvider, TTSSynthesisOptions } from "./types";

interface VoicevoxAudioQuery {
	speedScale?: number;
	pitchScale?: number;
	volumeScale?: number;
	[key: string]: unknown;
}

export class VoicevoxAudioProvider implements TTSAudioProvider {
	public constructor(private readonly baseUrl: string) {}

	public async synthesize(options: TTSSynthesisOptions): Promise<ArrayBuffer> {
		const audioQuery = await this.createAudioQuery(options);
		audioQuery.speedScale = options.speed;
		audioQuery.pitchScale = options.pitch;
		audioQuery.volumeScale = options.volume;

		const synthesisParams = new URLSearchParams();
		synthesisParams.append("speaker", options.speaker.toString());

		const response = await fetch(
			`${this.baseUrl}/synthesis?${synthesisParams.toString()}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(audioQuery),
			},
		);

		if (!response.ok) {
			throw new Error(`音声合成エラー: ${response.status}`);
		}

		return response.arrayBuffer();
	}

	private async createAudioQuery(
		options: TTSSynthesisOptions,
	): Promise<VoicevoxAudioQuery> {
		const params = new URLSearchParams();
		params.append("text", options.text);
		params.append("speaker", options.speaker.toString());

		const response = await fetch(
			`${this.baseUrl}/audio_query?${params.toString()}`,
			{
				method: "POST",
			},
		);

		if (!response.ok) {
			throw new Error(`音声クエリ作成エラー: ${response.status}`);
		}

		return (await response.json()) as VoicevoxAudioQuery;
	}
}
