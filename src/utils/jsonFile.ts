import { stateStore } from "../db/stateStore";

export function readJsonFileSync<T>(filePath: string, fallback: T): T {
	return stateStore.read(filePath, fallback);
}

export async function readJsonFile<T>(
	filePath: string,
	fallback: T,
): Promise<T> {
	return stateStore.read(filePath, fallback);
}

export function writeJsonFileSync<T>(filePath: string, data: T): void {
	stateStore.write(filePath, data);
}

export async function writeJsonFile<T>(
	filePath: string,
	data: T,
): Promise<void> {
	stateStore.write(filePath, data);
}
