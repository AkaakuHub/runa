miurd

## deploy
```bash
pnpm run deploy
```

## run
```bash
# 使用方法:
# 初回セットアップ
pnpm run voicevox:setup
pnpm run sudachi:setup

# 両方を同時に起動
pnpm run start:full

# 個別に起動
pnpm run voicevox:start  # Voicevoxのみ
pnpm start              # Discord botのみ
```

## Sudachi 形態素解析コマンド

1. `pnpm run sudachi:setup` で SudachiPy + 辞書をローカルの `sudachi/.venv` にインストールします。（Python 3.14 以上を使う場合は `PYTHON_BIN=python3.12 pnpm run sudachi:setup` のように互換バージョンを指定するか、スクリプトが自動で `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1` を設定します。）
2. `.env` に `SUDACHI_PYTHON_PATH`（例: `sudachi/.venv/bin/python3`）と任意で `SUDACHI_MODE`（`A/B/C`。省略時は `C`）を設定します。
3. Discord 上で `/sudachi` コマンドを使い、`text` 引数に解析したい文章を入力すると、先頭 10 トークン（または `limit` オプションで指定した件数）までの解析結果が返信されます。
