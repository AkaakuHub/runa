import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { parse } from "node:querystring";
import * as dotenv from "dotenv";
import {
	botClientRepository,
	type BotClientConfig,
} from "../db/botClientRepository";
import { ngWordRepository, type NgWord } from "../db/ngWordRepository";
import { logError, logInfo } from "../utils/logger";

dotenv.config({ quiet: true });

const host = process.env.ADMIN_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.ADMIN_PORT || "8787", 10);

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function sendHtml(response: ServerResponse, html: string): void {
	response.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
	});
	response.end(html);
}

function redirect(response: ServerResponse, location: string): void {
	response.writeHead(303, { Location: location });
	response.end();
}

async function readForm(
	request: IncomingMessage,
): Promise<Record<string, string>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	const parsed = parse(Buffer.concat(chunks).toString("utf8"));
	return Object.fromEntries(
		Object.entries(parsed).map(([key, value]) => [
			key,
			Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
		]),
	);
}

function renderClientRow(client: BotClientConfig): string {
	return `
		<tr>
			<td>${escapeHtml(client.name)}</td>
			<td><code>${escapeHtml(client.clientId)}</code></td>
			<td><code>${escapeHtml(client.guildId)}</code></td>
			<td>${client.enabled ? "起動する" : "起動しない"}</td>
			<td>
				<form method="post" action="/clients/save">
					<input type="hidden" name="id" value="${escapeHtml(client.id)}">
					<input name="name" value="${escapeHtml(client.name)}" aria-label="name">
					<input name="clientId" value="${escapeHtml(client.clientId)}" aria-label="clientId">
					<input name="guildId" value="${escapeHtml(client.guildId)}" aria-label="guildId">
					<input name="token" type="password" placeholder="変更時のみ入力" aria-label="token">
					<label><input name="enabled" type="checkbox" value="1"${client.enabled ? " checked" : ""}> 起動</label>
					<button type="submit">保存</button>
				</form>
				<form method="post" action="/clients/delete">
					<input type="hidden" name="id" value="${escapeHtml(client.id)}">
					<button type="submit">削除</button>
				</form>
			</td>
		</tr>
	`;
}

function renderNgWordRow(ngWord: NgWord): string {
	return `
		<tr>
			<td>${escapeHtml(ngWord.word)}</td>
			<td>${ngWord.enabled ? "有効" : "無効"}</td>
			<td>
				<form method="post" action="/ng-words/toggle">
					<input type="hidden" name="id" value="${ngWord.id}">
					<input type="hidden" name="enabled" value="${ngWord.enabled ? "0" : "1"}">
					<button type="submit">${ngWord.enabled ? "無効化" : "有効化"}</button>
				</form>
				<form method="post" action="/ng-words/delete">
					<input type="hidden" name="id" value="${ngWord.id}">
					<button type="submit">削除</button>
				</form>
			</td>
		</tr>
	`;
}

function renderIndex(): string {
	const clients = botClientRepository.list();
	const ngWords = ngWordRepository.list();
	return `<!doctype html>
<html lang="ja">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Runa Admin</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 24px; color: #222; }
		table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
		th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
		input { margin: 2px; padding: 6px; }
		button { margin: 2px; padding: 6px 10px; }
		form { margin: 0 0 6px; }
		code { user-select: all; }
	</style>
</head>
<body>
	<h1>Runa Admin</h1>
	<table>
		<thead>
			<tr>
				<th>名前</th>
				<th>CLIENT_ID</th>
				<th>GUILD_ID</th>
				<th>起動</th>
				<th>編集</th>
			</tr>
		</thead>
		<tbody>
			${clients.map(renderClientRow).join("")}
		</tbody>
	</table>

	<h2>追加</h2>
	<form method="post" action="/clients/save">
		<input name="name" placeholder="名前" required>
		<input name="clientId" placeholder="CLIENT_ID" required>
		<input name="guildId" placeholder="GUILD_ID" required>
		<input name="token" type="password" placeholder="TOKEN" required>
		<label><input name="enabled" type="checkbox" value="1" checked> 起動</label>
		<button type="submit">追加</button>
	</form>

	<h2>NGワード</h2>
	<table>
		<thead>
			<tr>
				<th>単語</th>
				<th>状態</th>
				<th>操作</th>
			</tr>
		</thead>
		<tbody>
			${ngWords.map(renderNgWordRow).join("")}
		</tbody>
	</table>
	<form method="post" action="/ng-words/add">
		<input name="word" placeholder="NGワード" required>
		<button type="submit">追加</button>
	</form>
</body>
</html>`;
}

async function saveClient(request: IncomingMessage): Promise<void> {
	const form = await readForm(request);
	const existing = form.id ? botClientRepository.find(form.id) : undefined;
	const token = form.token || existing?.token || "";
	if (!token) {
		throw new Error("TOKENが入力されていません");
	}

	botClientRepository.upsert({
		id: form.id || undefined,
		name: form.name || "bot",
		token,
		clientId: form.clientId || "",
		guildId: form.guildId || "",
		enabled: form.enabled === "1",
	});
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	try {
		if (request.method === "GET" && request.url === "/") {
			sendHtml(response, renderIndex());
			return;
		}

		if (request.method === "HEAD" && request.url === "/") {
			response.writeHead(200);
			response.end();
			return;
		}

		if (request.method === "POST" && request.url === "/clients/save") {
			await saveClient(request);
			redirect(response, "/");
			return;
		}

		if (request.method === "POST" && request.url === "/clients/delete") {
			const form = await readForm(request);
			if (form.id) {
				botClientRepository.delete(form.id);
			}
			redirect(response, "/");
			return;
		}

		if (request.method === "POST" && request.url === "/ng-words/add") {
			const form = await readForm(request);
			ngWordRepository.add(form.word || "");
			redirect(response, "/");
			return;
		}

		if (request.method === "POST" && request.url === "/ng-words/toggle") {
			const form = await readForm(request);
			ngWordRepository.setEnabled(
				Number.parseInt(form.id || "0", 10),
				form.enabled === "1",
			);
			redirect(response, "/");
			return;
		}

		if (request.method === "POST" && request.url === "/ng-words/delete") {
			const form = await readForm(request);
			ngWordRepository.delete(Number.parseInt(form.id || "0", 10));
			redirect(response, "/");
			return;
		}

		response.writeHead(404);
		response.end("Not Found");
	} catch (error) {
		logError(`管理画面エラー: ${error}`);
		response.writeHead(400, {
			"Content-Type": "text/plain; charset=utf-8",
		});
		response.end("保存に失敗しました");
	}
}

createServer((request, response) => {
	void handleRequest(request, response);
}).listen(port, host, () => {
	console.log(`管理画面を起動しました: http://${host}:${port}`);
	logInfo(`管理画面を起動しました: http://${host}:${port}`);
});
