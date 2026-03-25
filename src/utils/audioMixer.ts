import type {
	ChildProcess,
	ChildProcessWithoutNullStreams,
} from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import {
	type AudioResource,
	createAudioResource,
	StreamType,
} from "@discordjs/voice";
import { logDebug, logError } from "./logger";

const PCM_SAMPLE_RATE = 48_000;
const PCM_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;
const SILENCE_FRAME_MS = 20;
const SILENCE_FRAME_BYTES =
	(PCM_SAMPLE_RATE / (1000 / SILENCE_FRAME_MS)) *
	PCM_CHANNELS *
	PCM_BYTES_PER_SAMPLE;
const SILENCE_FRAME = Buffer.alloc(SILENCE_FRAME_BYTES);

interface RealtimeAudioMixerOptions {
	musicVolume: number;
	ttsVolume: number;
}

class PCMInputFeeder {
	private readonly target: Writable;
	private readonly label: string;
	private silenceTimer?: NodeJS.Timeout;
	private activeSource?: Readable;
	private destroyed = false;
	private gain = 1;

	public constructor(target: Writable, label: string, initialGain: number) {
		this.target = target;
		this.label = label;
		this.gain = clampVolume(initialGain);
		this.startSilenceLoop();
	}

	public async pipeFrom(source: Readable): Promise<void> {
		if (this.destroyed) {
			return;
		}

		this.activeSource = source;

		return new Promise((resolve, reject) => {
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) {
					return;
				}
				cleanedUp = true;
				this.activeSource = undefined;
				source.off("data", onData);
				source.off("end", onEnd);
				source.off("close", onEnd);
				source.off("error", onError);
				this.target.off("drain", onDrain);
			};

			const onDrain = () => {
				source.resume();
			};

			const onData = (chunk: Buffer) => {
				if (this.destroyed) {
					return;
				}

				const outputChunk = this.applyGain(chunk);
				if (!this.target.write(outputChunk)) {
					source.pause();
					this.target.once("drain", onDrain);
				}
			};

			const onEnd = () => {
				cleanup();
				resolve();
			};

			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};

			source.on("data", onData);
			source.once("end", onEnd);
			source.once("close", onEnd);
			source.once("error", onError);
		});
	}

	public setGain(gain: number): void {
		this.gain = clampVolume(gain);
	}

	public destroy(): void {
		this.destroyed = true;
		if (this.silenceTimer) {
			clearInterval(this.silenceTimer);
			this.silenceTimer = undefined;
		}
		if (!this.target.destroyed) {
			this.target.end();
		}
	}

	private startSilenceLoop(): void {
		this.silenceTimer = setInterval(() => {
			if (this.destroyed || this.activeSource || this.target.destroyed) {
				return;
			}

			try {
				this.target.write(SILENCE_FRAME);
			} catch (error) {
				logError(`${this.label} silence write error: ${error}`);
			}
		}, SILENCE_FRAME_MS);
		this.silenceTimer.unref();
	}

	private applyGain(chunk: Buffer): Buffer {
		if (this.gain === 1) {
			return chunk;
		}

		const output = Buffer.allocUnsafe(chunk.length);
		for (let offset = 0; offset < chunk.length; offset += 2) {
			const sample = chunk.readInt16LE(offset);
			const scaled = Math.max(
				-32768,
				Math.min(32767, Math.round(sample * this.gain)),
			);
			output.writeInt16LE(scaled, offset);
		}
		return output;
	}
}

function getFFmpegBinary(): string {
	return "ffmpeg";
}

function spawnPcmDecoder(
	inputArgs: string[],
	stdinSource?: Readable,
): ChildProcessWithoutNullStreams {
	const decoder = spawn(
		getFFmpegBinary(),
		[
			"-hide_banner",
			"-loglevel",
			"error",
			...inputArgs,
			"-f",
			"s16le",
			"-ar",
			String(PCM_SAMPLE_RATE),
			"-ac",
			String(PCM_CHANNELS),
			"pipe:1",
		],
		{
			stdio: ["pipe", "pipe", "pipe"],
		},
	);

	if (stdinSource && decoder.stdin) {
		stdinSource.on("error", (error) => {
			logError(`decoder stdin source error: ${error}`);
			if (!decoder.killed) {
				decoder.kill("SIGKILL");
			}
		});
		decoder.stdin.on("error", (error) => {
			logDebug(`decoder stdin closed: ${error}`);
		});
		stdinSource.pipe(decoder.stdin);
	}

	decoder.stdout.on("error", (error) => {
		logDebug(`decoder stdout closed: ${error}`);
	});
	decoder.stderr.on("error", (error) => {
		logDebug(`decoder stderr closed: ${error}`);
	});

	return decoder;
}

async function waitForProcessExit(
	process: ChildProcess | undefined,
	label: string,
): Promise<void> {
	if (!process) {
		return;
	}

	if (process.exitCode !== null || process.signalCode !== null) {
		if (
			process.exitCode === 0 ||
			process.signalCode === "SIGTERM" ||
			process.signalCode === "SIGKILL"
		) {
			return;
		}

		throw new Error(
			`${label} exited with code=${process.exitCode} signal=${process.signalCode}`,
		);
	}

	await new Promise<void>((resolve, reject) => {
		process.once("error", reject);
		process.once("close", (code, signal) => {
			if (code === 0 || signal === "SIGTERM" || signal === "SIGKILL") {
				resolve();
				return;
			}

			reject(new Error(`${label} exited with code=${code} signal=${signal}`));
		});
	});
}

export class RealtimeAudioMixer {
	private mixerProcess?: ChildProcess;
	private readonly musicFeeder?: PCMInputFeeder;
	private readonly ttsFeeder?: PCMInputFeeder;
	private currentMusicDecoder?: ChildProcessWithoutNullStreams;
	private currentTtsDecoder?: ChildProcessWithoutNullStreams;
	private ttsChain: Promise<boolean> = Promise.resolve(true);
	private ttsQueueVersion = 0;
	private stopped = false;

	public constructor(options: RealtimeAudioMixerOptions) {
		const filterGraph = buildFilterGraph();
		const mixerProcess = spawn(
			getFFmpegBinary(),
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-f",
				"s16le",
				"-ar",
				String(PCM_SAMPLE_RATE),
				"-ac",
				String(PCM_CHANNELS),
				"-i",
				"pipe:3",
				"-f",
				"s16le",
				"-ar",
				String(PCM_SAMPLE_RATE),
				"-ac",
				String(PCM_CHANNELS),
				"-i",
				"pipe:4",
				"-filter_complex",
				filterGraph,
				"-map",
				"[out]",
				"-f",
				"s16le",
				"-ar",
				String(PCM_SAMPLE_RATE),
				"-ac",
				String(PCM_CHANNELS),
				"pipe:1",
			],
			{
				stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
			},
		);

		this.mixerProcess = mixerProcess;
		this.musicFeeder = new PCMInputFeeder(
			mixerProcess.stdio[3] as Writable,
			"music-mixer",
			options.musicVolume,
		);
		this.ttsFeeder = new PCMInputFeeder(
			mixerProcess.stdio[4] as Writable,
			"tts-mixer",
			options.ttsVolume,
		);

		mixerProcess.stderr?.on("data", (data) => {
			const text = data.toString().trim();
			if (text) {
				logError(`ffmpeg mixer stderr: ${text}`);
			}
		});
		mixerProcess.stdout?.on("error", (error) => {
			logDebug(`ffmpeg mixer stdout closed: ${error}`);
		});
		mixerProcess.stderr?.on("error", (error) => {
			logDebug(`ffmpeg mixer stderr closed: ${error}`);
		});
		(mixerProcess.stdio[3] as Writable | undefined)?.on("error", (error) => {
			logDebug(`ffmpeg mixer music pipe closed: ${error}`);
		});
		(mixerProcess.stdio[4] as Writable | undefined)?.on("error", (error) => {
			logDebug(`ffmpeg mixer tts pipe closed: ${error}`);
		});

		mixerProcess.on("close", (code, signal) => {
			logDebug(`ffmpeg mixer closed code=${code} signal=${signal}`);
		});
	}

	public createResource(): AudioResource {
		const stdout = this.mixerProcess?.stdout as Readable | null | undefined;
		if (!stdout) {
			throw new Error("ミキサー出力が初期化されていません");
		}

		return createAudioResource(stdout, {
			inputType: StreamType.Raw,
			inlineVolume: true,
		});
	}

	public async playMusicStream(stream: Readable): Promise<void> {
		if (this.stopped || !this.musicFeeder) {
			return;
		}

		this.currentMusicDecoder = spawnPcmDecoder(["-i", "pipe:0"], stream);
		this.currentMusicDecoder.stderr?.on("data", (data) => {
			const text = data.toString().trim();
			if (text) {
				logError(`music decoder stderr: ${text}`);
			}
		});

		if (!this.currentMusicDecoder.stdout) {
			throw new Error("音楽デコーダーの stdout が取得できません");
		}

		await this.musicFeeder.pipeFrom(this.currentMusicDecoder.stdout);
		await waitForProcessExit(this.currentMusicDecoder, "music decoder");
		this.currentMusicDecoder = undefined;
	}

	public enqueueTtsFile(audioFile: string): Promise<boolean> {
		this.ttsQueueVersion += 1;
		this.ttsChain = this.ttsChain
			.catch(() => false)
			.then(() => this.playTtsFile(audioFile));
		return this.ttsChain;
	}

	public setMusicVolume(volume: number): void {
		this.musicFeeder?.setGain(volume);
	}

	public setTtsVolume(volume: number): void {
		this.ttsFeeder?.setGain(volume);
	}

	public async waitForTtsDrain(): Promise<boolean> {
		while (!this.stopped) {
			const observedVersion = this.ttsQueueVersion;
			const result = await this.ttsChain.catch(() => false);
			if (observedVersion === this.ttsQueueVersion && !this.currentTtsDecoder) {
				return result;
			}
		}

		return false;
	}

	public skipCurrentTts(): boolean {
		if (!this.currentTtsDecoder) {
			return false;
		}

		this.currentTtsDecoder.kill("SIGKILL");
		this.currentTtsDecoder = undefined;
		return true;
	}

	public stop(): void {
		if (this.stopped) {
			return;
		}

		this.stopped = true;
		this.currentMusicDecoder?.kill("SIGKILL");
		this.currentMusicDecoder = undefined;
		this.currentTtsDecoder?.kill("SIGKILL");
		this.currentTtsDecoder = undefined;
		this.musicFeeder?.destroy();
		this.ttsFeeder?.destroy();
		this.mixerProcess?.kill("SIGKILL");
		this.mixerProcess = undefined;
	}

	private async playTtsFile(audioFile: string): Promise<boolean> {
		if (this.stopped || !this.ttsFeeder) {
			return false;
		}

		try {
			this.currentTtsDecoder = spawnPcmDecoder(["-i", audioFile]);
			this.currentTtsDecoder.stderr?.on("data", (data) => {
				const text = data.toString().trim();
				if (text) {
					logError(`tts decoder stderr: ${text}`);
				}
			});

			if (!this.currentTtsDecoder.stdout) {
				throw new Error("TTSデコーダーの stdout が取得できません");
			}

			await this.ttsFeeder.pipeFrom(this.currentTtsDecoder.stdout);
			await waitForProcessExit(this.currentTtsDecoder, "tts decoder");
			this.currentTtsDecoder = undefined;
			return true;
		} catch (error) {
			logError(`TTS overlay error: ${error}`);
			this.currentTtsDecoder = undefined;
			return false;
		}
	}
}

function buildFilterGraph(): string {
	return "[1:a]asplit=2[tts_sidechain][tts_mix];[0:a]anull[music_in];[music_in][tts_sidechain]sidechaincompress=threshold=0.02:ratio=10:attack=12:release=220[ducked];[ducked][tts_mix]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.98[out]";
}

function clampVolume(volume: number): number {
	return Math.max(0, Math.min(2, volume));
}
