# cc-discord-bot

Discord Bot 経由で Claude Code を制御するシステム

## 概要

EC2 上の Claude Code を Discord Bot 経由で制御し、リモートから実装指示を出せるシステムです。

## 機能

- @Bot メンションでコマンド実行
- 特定ユーザーのみアクセス可能（User ID で管理）
- Discord スレッドごとにセッションを維持
- 2000文字を超える出力はファイル添付

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、設定を行います。

```bash
cp .env.example .env
```

必須の環境変数:

| 変数名 | 説明 |
|--------|------|
| `DISCORD_BOT_TOKEN` | Discord Bot のトークン |
| `ALLOWED_USER_IDS` | 許可するユーザー ID（カンマ区切り） |

オプションの環境変数:

| 変数名 | デフォルト | 説明 |
|--------|------------|------|
| `DISCORD_APPLICATION_ID` | - | Discord アプリケーション ID |
| `CLAUDE_WORKING_DIR` | カレントディレクトリ | Claude CLI の作業ディレクトリ |
| `CLAUDE_TIMEOUT_MS` | 300000 (5分) | CLI 実行タイムアウト |
| `LOG_LEVEL` | info | ログレベル |

### 3. ビルドと起動

```bash
# 開発モード
npm run dev

# 本番用ビルド
npm run build
npm start
```

## 使い方

Discord でボットをメンションしてコマンドを送信します:

```
@ClaudeBot このコードをリファクタリングしてください
```

同じスレッドでの会話は継続されます。

## プロジェクト構造

```
src/
├── index.ts                    # エントリーポイント
├── bot/
│   ├── client.ts               # Discord クライアント
│   ├── events/
│   │   ├── index.ts
│   │   ├── ready.ts
│   │   └── messageCreate.ts
│   └── handlers/
│       └── mentionHandler.ts
├── claude/
│   ├── executor.ts             # Claude CLI 実行
│   ├── sessionManager.ts       # セッション管理
│   └── outputProcessor.ts      # 出力処理
├── auth/
│   └── accessControl.ts        # アクセス制御
├── config/
│   └── index.ts                # 設定
├── types/
│   └── index.ts                # 型定義
└── utils/
    └── logger.ts               # ロガー
```

## 必要条件

- Node.js 18+
- Claude CLI がインストールされていること
- Discord Bot Token
