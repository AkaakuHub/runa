export interface TTSSynthesisOptions {
	text: string;
	speaker: number;
	speed: number;
	pitch: number;
	volume: number;
}

export interface TTSAudioProvider {
	synthesize(options: TTSSynthesisOptions): Promise<ArrayBuffer>;
}
