# 10秒ニュース（スワイプ型ニュースWebアプリ / Cloudflare Workers版）

「Pages Functions はサポートされていません」というエラーを回避するため、
**Cloudflare Pages + Pages Functions ではなく、単一の Cloudflare Worker（静的アセット配信 + APIを1つのWorkerで両方処理）** という
現在Cloudflareが推奨している構成に変更しました。この方式なら「Pages Functions」という概念自体が登場しないため、
今回のようなエラーは発生しません。

## なぜエラーが出たのか

Cloudflare Pagesの管理画面から **Direct Upload（ドラッグ&ドロップでのアップロード）** を使った場合、
`functions/` フォルダは公式にサポートされていません（Git連携かWrangler CLIでのデプロイが必要）。
本構成ではそもそも `functions/` フォルダを使わず、1つのWorkerスクリプトの中でAPI処理と静的ファイル配信の両方を行うため、
この制限を回避できます。

## 構成

```
.
├── src/
│   └── index.js       # 1つのWorker: /api/news はAPI処理、それ以外は静的ファイルを配信
├── public/
│   └── index.html      # フロントエンド（Swiper.jsによるスワイプUI）
├── wrangler.jsonc       # Worker設定（静的アセットのバインディングを含む）
├── package.json
└── README.md
```

- `src/index.js` が唯一のサーバーサイドコードです。リクエストパスが `/api/news` の場合はYahoo!ニュースのRSSを
  サーバーサイドで取得・パースしてJSONを返し、それ以外は `env.ASSETS.fetch(request)` で `public/` 内の静的ファイルを返します。
- ブラウザは常に同一オリジンの `/api/news` を呼ぶだけなので、CORSの問題は発生しません。

## 事前準備

- Node.js（v18以上推奨）
- npm
- Cloudflareアカウント

## ローカルで動作確認する

```bash
npm install
npx wrangler dev
```

表示されたURL（通常 `http://localhost:8787`）をブラウザで開いてください。

## Cloudflareへデプロイする

### 方法A: Wrangler CLIから直接デプロイ（最も確実）

```bash
npx wrangler login
npx wrangler deploy
```

初回実行時にWorkerが自動的に作成されます。完了すると `https://news-swipe-app.<あなたのサブドメイン>.workers.dev`
のようなURLが発行され、すぐにアクセスできます。

### 方法B: GitHub連携（継続的デプロイ）

1. このプロジェクト一式をGitHubリポジトリにpushする。
2. Cloudflareダッシュボード → **Workers & Pages** → **Create** → **Workers** → **Import a repository** を選択。
3. 対象リポジトリを選ぶと、`wrangler.jsonc` の設定を自動で読み込んでビルド・デプロイされます。
4. 追加のビルドコマンドは不要です（静的ファイル + Workerスクリプトのみのため）。

## カスタマイズのヒント

- RSSの取得元を変更したい場合は `src/index.js` の `RSS_URL` を書き換えてください。
- キャッシュ時間を変えたい場合は同ファイルの `Cache-Control` の値（`s-maxage=300`）を調整してください。
- 要約文の文字数（現在80文字）は `public/index.html` の `truncate(article.description, 80)` の数値を変更してください。
- テーマカラーは `public/index.html` の `:root` 内のCSS変数（`--bg`, `--card`, `--accent` 等）で調整できます。
- 独自ドメインを使いたい場合は、Cloudflareダッシュボードの対象Worker → **Settings** → **Domains & Routes** から追加できます。

## 注意事項

- RSSの構造やYahoo!ニュース側の仕様変更により、パース結果が変わる可能性があります。その場合は
  `src/index.js` の `parseRss` 関数を対象RSSの構造に合わせて調整してください。
- 本アプリは学習・個人利用を想定した構成です。商用・大規模運用の際は取得元サイトの利用規約を確認してください。
