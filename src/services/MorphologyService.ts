import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { logError, logInfo } from "../utils/logger";

type SudachiMode = "A" | "B" | "C";

interface Morpheme {
	surface: string;
	dictionaryForm: string;
	normalizedForm: string;
	reading: string;
	partOfSpeech: string[];
}

const DEFAULT_TIMEOUT_MS = 8000;

export class MorphologyService {
	private static instance: MorphologyService;

	private readonly pythonPath: string;
	private readonly scriptPath: string;
	private readonly mode: SudachiMode;
	private readonly timeoutMs: number;

	private constructor() {
		this.scriptPath =
			process.env.SUDACHI_SCRIPT_PATH ||
			path.join(process.cwd(), "scripts", "sudachi_tokenize.py");
		this.pythonPath = this.resolvePythonExecutable();
		this.mode = this.resolveMode();
		this.timeoutMs = Number(
			process.env.SUDACHI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
		);
	}

	public static getInstance(): MorphologyService {
		if (!MorphologyService.instance) {
			MorphologyService.instance = new MorphologyService();
		}
		return MorphologyService.instance;
	}

	public getMode(): SudachiMode {
		return this.mode;
	}

	public async analyze(text: string): Promise<Morpheme[]> {
		if (!text.trim()) {
			return [];
		}

		if (!existsSync(this.scriptPath)) {
			throw new Error(
				`Sudachi tokenizer script not found at ${this.scriptPath}. Run pnpm run sudachi:setup`,
			);
		}

		return new Promise((resolve, reject) => {
			const args = [this.scriptPath, "--mode", this.mode];
			const child = spawn(this.pythonPath, args, {
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			child.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			child.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			child.on("error", (error) => {
				reject(error);
			});

			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				reject(new Error("Sudachi tokenize process timed out"));
			}, this.timeoutMs);

			child.on("close", (code) => {
				clearTimeout(timer);
				if (code !== 0) {
					logError(`Sudachi process exited with code ${code}: ${stderr}`);
					reject(new Error(stderr || "Sudachi process failed"));
					return;
				}

				try {
					const tokens = JSON.parse(stdout) as Morpheme[];
					resolve(tokens);
				} catch (error) {
					logError(
						`Failed to parse Sudachi output: ${(error as Error).message}`,
					);
					reject(error);
				}
			});

			child.stdin.write(text);
			child.stdin.end();
		});
	}

	private resolvePythonExecutable(): string {
		const override = process.env.SUDACHI_PYTHON_PATH;
		if (override) {
			return override;
		}

		const venvDir = path.join(process.cwd(), "sudachi", ".venv");
		const unixCandidate = path.join(venvDir, "bin", "python3");
		if (existsSync(unixCandidate)) {
			return unixCandidate;
		}

		const winCandidate = path.join(venvDir, "Scripts", "python.exe");
		if (existsSync(winCandidate)) {
			return winCandidate;
		}

		logInfo("Falling back to system python3 for Sudachi");
		return "python3";
	}

	private resolveMode(): SudachiMode {
		const envMode = (process.env.SUDACHI_MODE || "C").toUpperCase();
		if (envMode === "A" || envMode === "B" || envMode === "C") {
			return envMode;
		}
		logInfo(`Unknown SUDACHI_MODE '${envMode}', defaulting to C`);
		return "C";
	}
}
