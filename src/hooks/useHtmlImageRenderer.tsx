import { type Browser, chromium } from "playwright";
import type { ReactElement, ReactNode } from "react";
import { useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";

interface HtmlImageDocumentOptions {
	width: number;
	height: number;
	css: string;
	lang?: string;
	background?: string;
}

interface HtmlImageRenderOptions {
	width: number;
	height: number;
	debugLabel?: string;
	deviceScaleFactor?: number;
}

interface HtmlImageDocumentModel extends Required<HtmlImageDocumentOptions> {}

let browserPromise: Promise<Browser> | null = null;

function debugTime(label: string): void {
	if (process.env.HTML_IMAGE_DEBUG === "1") console.time(label);
}

function debugTimeEnd(label: string): void {
	if (process.env.HTML_IMAGE_DEBUG === "1") console.timeEnd(label);
}

async function getBrowser(): Promise<Browser> {
	browserPromise ??= chromium
		.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-dev-shm-usage"],
		})
		.catch((error) => {
			browserPromise = null;
			throw error;
		});
	return browserPromise;
}

export function useHtmlImageDocument(
	options: HtmlImageDocumentOptions,
): HtmlImageDocumentModel {
	return useMemo(
		() => ({
			width: options.width,
			height: options.height,
			css: options.css,
			lang: options.lang ?? "ja",
			background: options.background ?? "#fff",
		}),
		[
			options.width,
			options.height,
			options.css,
			options.lang,
			options.background,
		],
	);
}

export function HtmlImageDocument({
	document,
	children,
}: {
	document: HtmlImageDocumentModel;
	children: ReactNode;
}): ReactElement {
	return (
		<html lang={document.lang}>
			<head>
				<meta charSet="utf-8" />
				<style>{`
					html,
					body {
						margin: 0;
						width: ${document.width}px;
						height: ${document.height}px;
						overflow: hidden;
						background: ${document.background};
					}
					* {
						box-sizing: border-box;
					}
					${document.css}
				`}</style>
			</head>
			<body>{children}</body>
		</html>
	);
}

export async function renderReactHtmlToPng(
	element: ReactElement,
	options: HtmlImageRenderOptions,
): Promise<Buffer> {
	const label = options.debugLabel ?? "html-image";
	debugTime(`${label}:render`);
	const html = `<!doctype html>${renderToStaticMarkup(element)}`;
	debugTimeEnd(`${label}:render`);

	debugTime(`${label}:browser`);
	const browser = await getBrowser();
	debugTimeEnd(`${label}:browser`);

	debugTime(`${label}:page`);
	const page = await browser.newPage({
		viewport: { width: options.width, height: options.height },
		deviceScaleFactor: options.deviceScaleFactor ?? 1,
	});
	debugTimeEnd(`${label}:page`);

	try {
		debugTime(`${label}:setContent`);
		await page.setContent(html, { waitUntil: "load" });
		debugTimeEnd(`${label}:setContent`);
		debugTime(`${label}:screenshot`);
		const screenshot = await page.screenshot({
			type: "png",
			clip: { x: 0, y: 0, width: options.width, height: options.height },
			animations: "disabled",
		});
		debugTimeEnd(`${label}:screenshot`);
		return screenshot;
	} finally {
		await page.close();
	}
}
