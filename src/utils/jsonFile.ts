import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { dirname } from "node:path";

function ensureParentDirectorySync(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
}

async function ensureParentDirectory(filePath: string): Promise<void> {
	await fs.mkdir(dirname(filePath), { recursive: true });
}

export function readJsonFileSync<T>(filePath: string, fallback: T): T {
	try {
		const raw = readFileSync(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export async function readJsonFile<T>(
	filePath: string,
	fallback: T,
): Promise<T> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function writeJsonFileSync<T>(filePath: string, data: T): void {
	ensureParentDirectorySync(filePath);
	writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export async function writeJsonFile<T>(
	filePath: string,
	data: T,
): Promise<void> {
	await ensureParentDirectory(filePath);
	await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}
