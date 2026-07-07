import asyncio
import json
import sys
from typing import Any

from crawl4ai import AsyncWebCrawler


def get_markdown(result: Any) -> str:
    markdown = getattr(result, "markdown", "")
    if isinstance(markdown, str):
        return markdown

    raw_markdown = getattr(markdown, "raw_markdown", "")
    if isinstance(raw_markdown, str):
        return raw_markdown

    fit_markdown = getattr(markdown, "fit_markdown", "")
    if isinstance(fit_markdown, str):
        return fit_markdown

    return ""


def get_title(result: Any) -> str:
    metadata = getattr(result, "metadata", None)
    if isinstance(metadata, dict):
        title = metadata.get("title")
        if isinstance(title, str):
            return title

    return ""


async def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("URLを1つ指定してください。")

    url = sys.argv[1]
    try:
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=url)
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "error",
                    "url": url,
                    "error": str(error),
                },
                ensure_ascii=False,
            )
        )
        return

    markdown = get_markdown(result).strip()
    if not markdown:
        print(
            json.dumps(
                {
                    "status": "empty",
                    "url": url,
                    "error": "Crawl4AIで本文を抽出できませんでした。",
                },
                ensure_ascii=False,
            )
        )
        return

    print(
        json.dumps(
            {
                "status": "ok",
                "url": url,
                "title": get_title(result),
                "markdown": markdown,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
