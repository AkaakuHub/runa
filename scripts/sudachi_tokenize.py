#!/usr/bin/env python3
"""Small CLI that tokenizes input text with SudachiPy and writes JSON to stdout."""

import argparse
import json
import sys

try:
    from sudachipy import dictionary, tokenizer
except ImportError:  # pragma: no cover - dependency check
    sys.stderr.write(
        "SudachiPy is not installed. Run pnpm run sudachi:setup before using this script.\n"
    )
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tokenize Japanese text with SudachiPy")
    parser.add_argument(
        "--mode",
        choices=("A", "B", "C"),
        default="C",
        help="Sudachi split mode (C = coarse, B = middle, A = fine)",
    )
    parser.add_argument(
        "--config",
        default=None,
        help="Optional path to sudachi.json configuration (defaults to SudachiPy bundled config)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    raw_text = sys.stdin.read()
    text = raw_text.strip()

    if not text:
        print("[]")
        return

    dict_args = {}
    if args.config:
        dict_args["config_path"] = args.config

    tokenizer_obj = dictionary.Dictionary(**dict_args).create()
    split_mode = getattr(tokenizer.Tokenizer.SplitMode, args.mode)

    morphemes = tokenizer_obj.tokenize(text, split_mode)
    payload = []
    for morpheme in morphemes:
        payload.append(
            {
                "surface": morpheme.surface(),
                "dictionaryForm": morpheme.dictionary_form(),
                "reading": morpheme.reading_form(),
                "partOfSpeech": list(morpheme.part_of_speech()),
                "normalizedForm": morpheme.normalized_form(),
            }
        )

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
