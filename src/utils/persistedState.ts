import { stateStore } from "../db/stateStore";

export function readPersistedStateSync<T>(statePath: string, fallback: T): T {
	return stateStore.read(statePath, fallback);
}

export async function readPersistedState<T>(
	statePath: string,
	fallback: T,
): Promise<T> {
	return stateStore.read(statePath, fallback);
}

export function writePersistedStateSync<T>(statePath: string, data: T): void {
	stateStore.write(statePath, data);
}

export async function writePersistedState<T>(
	statePath: string,
	data: T,
): Promise<void> {
	stateStore.write(statePath, data);
}
