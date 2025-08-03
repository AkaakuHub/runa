# 本番環境デプロイメントガイド

## 前提条件

- Node.js 18+
- pnpm
- PM2 (推奨) または systemd

## セットアップ手順

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

`.env` ファイルを作成し、以下の環境変数を設定：

```bash
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GOOGLE_API_KEY=your_google_api_key
```

### 3. デプロイ方法

#### Option A: PM2を使用（推奨）

```bash
# PM2をグローバルにインストール
npm install -g pm2

# ecosystem.config.jsのcwdパスを実際のプロジェクトパスに変更
# 例: cwd: '/home/user/miurd'

# PM2でアプリケーションを開始
pnpm pm2:start

# 自動起動を有効化
pm2 startup
pm2 save
```

#### Option B: systemdを使用

```bash
# miurd.serviceファイルのパスを実際のプロジェクトパスに変更
# WorkingDirectory, ExecStart, ログパス、ReadWritePathsを修正

# サービスファイルをコピー
sudo cp miurd.service /etc/systemd/system/

# systemdをリロード
sudo systemctl daemon-reload

# サービスを有効化して開始
sudo systemctl enable miurd
sudo systemctl start miurd
```

## 運用コマンド

### PM2を使用している場合

```bash
# ステータス確認
pm2 status

# ログ確認
pnpm pm2:logs

# 再起動
pnpm pm2:restart

# 停止
pnpm pm2:stop

# モニタリング
pnpm pm2:monitor
```

### systemdを使用している場合

```bash
# ステータス確認
sudo systemctl status miurd

# ログ確認
sudo journalctl -u miurd -f

# 再起動
sudo systemctl restart miurd

# 停止
sudo systemctl stop miurd
```

## Daily Summary機能について

- 毎日23:50 JSTに自動実行されます
- ボットが継続的に稼働している必要があります
- ログで実行状況を確認できます：
  - `"Starting scheduled daily summary generation..."` で開始
  - `"Daily summary sent to..."` で完了

## トラブルシューティング

### Daily Summaryが実行されない場合

1. ボットが稼働しているか確認
2. ログでエラーメッセージを確認
3. 環境変数（GOOGLE_API_KEY等）が正しく設定されているか確認
4. Discord チャンネルの設定が正しいか確認

### ログの確認場所

- PM2: `./logs/pm2-*.log`
- systemd: `journalctl -u miurd`
- アプリケーション: `./logs/combined.log`