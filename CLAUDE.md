# MailChat — プロジェクト引継ぎガイド

## プロジェクト概要

**MailChat** はメールをチャット形式で表示・送受信するWebアプリ。  
バックエンドは **n8n**（セルフホスト）、フロントは **React 18 in-browser Babel**（ビルドなし・単一 `index.html`）。

- **本番URL（GitHub Pages）**: https://imai-1711.github.io/mailchat/
- **n8n**: https://n8n.niida-imai.work  
- **リポジトリ**: https://github.com/imai-1711/mailchat  
- **ローカルパス**: `C:\Users\User\Downloads\new-mailer\`

---

## アーキテクチャ

```
[MailChat SPA (index.html)]
        ↕ fetch (CORS)
[n8n Webhooks @ n8n.niida-imai.work]
        ↕ IMAP / SMTP
[Gmailサーバー]
        ↕ Webhook POST
[n8n StaticData キャッシュ (sd.emails)]
```

### フロントエンド
- **React 18** CDN + **Babel Standalone**（ビルド不要）
- 単一ファイル: `index.html`（約1,500行）
- ビルド/デプロイ: `git push → GitHub Pages 自動反映`

### バックエンド（n8n ワークフロー）

| ワークフロー | ID | 役割 |
|---|---|---|
| MailChat - メール取得 | `sRUVnMcEkIYzmbCJ` | IMAP取得・キャッシュ・Webhook配信 |
| MailChat - メール送信 | `YiVDaNWrzE8ra73t` | SMTP送信・sentMessage生成 |
| style-profile | （別途） | AI文体学習 |

**n8n 認証情報**
| 名前 | ID | 種別 |
|---|---|---|
| IMAP account | `eROWM7jFZxprra2M` | imap |
| SMTP account | `zQDcrHtq8kk9DU8I` | smtp |

---

## 主要 Webhook エンドポイント

| エンドポイント | メソッド | 役割 |
|---|---|---|
| `/webhook/fetch-emails` | GET | キャッシュからメール全件取得 |
| `/webhook/import-emails` | POST | メールをキャッシュに追記 |
| `/webhook/send-email` | POST | SMTP送信＋sentMessageをキャッシュに保存 |
| `/webhook/style-profile` | POST/GET | AI文体プロファイル保存・取得 |

---

## index.html — 主要 CONFIG

```javascript
const CONFIG = {
  N8N_BASE_URL: "https://n8n.niida-imai.work",
  FETCH_WEBHOOK: "/webhook/fetch-emails",
  SEND_WEBHOOK:  "/webhook/send-email",
  CLAUDE_API_KEY: "",          // ← 未設定（セキュリティリスク。将来n8nプロキシ化推奨）
  CLAUDE_MODEL: "claude-sonnet-4-20250514",
  ACCOUNTS: [
    { id:"work",    email:"imai@1711.jp",        name:"仕事用" },
    { id:"private", email:"private@example.com", name:"プライベート" },
  ],
  MY_EXTRA_EMAILS: ["fcbb.showtime@gmail.com"],  // 自分として扱う追加アドレス
};
```

---

## n8n ワークフロー詳細

### メール取得ワークフロー (`sRUVnMcEkIYzmbCJ`)

**ノード構成（10ノード）:**
```
IMAP - INBOX        → 受信を保存
IMAP - INBOX.Sent   → 送信を保存
Webhook GET         → メールを返す → レスポンス
Webhook POST        → 一括保存    → インポート完了
```

**キャッシュ機構:**
- `$getWorkflowStaticData("global").emails` に全メールをハッシュマップで保存
- キーは `item.metadata["message-id"]` または UID

**`getAttachments(item, bin)` の仕様（最新）:**
```javascript
// JSON側メタ情報 + binary側base64 を インデックスでマージ
// jsonAtts[i]のcontentを bin["attachment_i"].data で補完
// dataUrl: 全ファイル種別、5MB以内 → "data:<mime>;base64,<content>"
//   画像は <img>プレビュー、PDF等はダウンロードボタンで使用
// 5MB超はdataUrl=undefined（ダウンロード不可）
```

**全件ループ（修正済み）:**
```javascript
for(let idx=0; idx<items.length; idx++){
  const item = items[idx].json;
  const bin  = items[idx].binary || null;  // ← 各itemごとのbinary
  ...
}
```

### メール送信ワークフロー (`YiVDaNWrzE8ra73t`)

**ノード構成:**
```
Webhook POST → 添付変換&フィールド整形 → SMTP送信 → sentMessage作成 → キャッシュ保存 → レスポンス
```

**注意点:**
- `キャッシュ保存` ノードが `http://192.168.1.106:5678/webhook/import-emails` にPOST  
  → **ローカルIPのためDHCPで変わる可能性あり。確認・固定化推奨**
- 送信メールのfake MessageID: `<mailchat-{timestamp}-{random}@mailchat>`

---

## フロントエンド — コンポーネント構造

```
App
├── Sidebar（スレッド一覧）
│   └── ThreadItem
├── ChatPanel（チャット表示）
│   ├── ChatBubble（メールバブル）
│   │   └── AttachmentBubble（添付ファイル）
│   ├── ReplyBar（返信入力）
│   └── SummaryCard（AI要約）
└── SettingsPanel（設定・文体学習）
```

### AttachmentBubble の仕様（最新）

```javascript
// att.dataUrl が存在する場合:
//   画像 → <img> プレビュー（クリックで新タブ原寸表示）+ ダウンロードボタン
//   PDF  → 「📄 開く」ボタン（新タブ）
//   他   → 「⬇ ダウンロード」ボタン（blob保存）
// att.dataUrl が存在しない場合:
//   「キャッシュなし（再取得で表示）」と案内
```

### スクロール制御

```javascript
const chatAreaRef = React.useRef(null);  // スクロールコンテナのref
const scrollToBottom = React.useCallback((smooth=false)=>{
  const el = chatAreaRef.current;
  if(!el) return;
  smooth ? el.scrollTo({top:el.scrollHeight,behavior:'smooth'}) : (el.scrollTop=el.scrollHeight);
},[]);

// スレッド切替時
React.useEffect(()=>{ ... setShowSidebar(false); setTimeout(()=>scrollToBottom(false),80); }, [selectedThreadId,...]);
// 同スレッドでメール追加時
React.useEffect(()=>{ if(!selThread)return; requestAnimationFrame(()=>requestAnimationFrame(()=>scrollToBottom(false))); },[selThread?.mails?.length,...]);
```

### モバイル対応

- `100dvh` で iOS Safariのブラウザバー問題に対応
- `env(safe-area-inset-bottom)` でホームバー・ノッチ対応（`.bottom-bar-safe` クラス）
- `viewport-fit=cover` メタタグ
- スクロール: `scrollTop = scrollHeight`（`scrollIntoView` は使わない）
- `setTimeout(80ms)` でサイドバー非表示後の再レンダリングを待つ

---

## ローカル開発環境

```bash
# サーバー起動
python serve.py          # port 8080
# または
start-server.bat

# GitHubへのプッシュ（Windows Credential Managerを回避するためURL埋め込みを使用）
git push https://<YOUR_CLASSIC_PAT>@github.com/imai-1711/mailchat.git main
```

**注意: Classic PAT（`repo` スコープ必要）を上記 `<YOUR_CLASSIC_PAT>` に置き換えて使用。**  
**Fine-grained PATは "Contents: Read and write" が必要で過去に403になった実績あり。**  
（Fine-grained PATは "Contents: Read and write" が必要で過去に403になった実績あり）

---

## n8n ワークフロー更新手順

n8nワークフローの変更は以下のフローで行う：

1. `_inbox_code.js` / `_sent_code.js` を編集（実際のJSコード）
2. `python fix_workflow.py` → `n8n-workflow-fetch-emails.json` を更新（ローカル保存）
3. `python gen_sdk.py` → `_workflow_sdk_fixed.js` を生成（バックスラッシュ二重エスケープ）
4. n8n MCP の `validate_workflow` → `update_workflow` → `publish_workflow` でデプロイ

**重要:** SDKコードでは `String.raw` テンプレートリテラルは **使用不可**（`TaggedTemplateExpression` 禁止）。  
バックスラッシュは二重エスケープ（`\\xC0` → テンプレートリテラル内で `\xC0` として評価される）。

---

## 既知の問題・未対応事項

### P1 — 添付ファイルのキャッシュ更新
- **既存キャッシュ**（StaticData）には古いデータ（`attachments:[]`）が残っている
- 次回IMAPポーリングで自動更新されるが、強制したい場合はn8nでIMAP手動実行
- 更新後、アプリをリロードする必要あり

### P2 — 5MB超の添付ファイル
- `dataUrl` が生成されないため「ダウンロード不可」表示になる
- 将来的にはn8nからのストリーミング配信やR2/S3保存が必要

### P2 — インライン画像（CIDリファレンス）
- HTMLメール内の `<img src="cid:...">` は未対応
- 現状はHTML本文をテキスト化しているため `<img>` タグが失われる
- 対応するにはHTMLレンダリングモードの実装が必要

### P3 — 重複排除（sentメール）
- MailChat送信メールの fake MessageID `<mailchat-...@mailchat>` と
  IMAPで取得したリアルなMessageIDが重複する可能性がある

### P3 — Claude API キー
- `CONFIG.CLAUDE_API_KEY` が空文字のため要約・文体学習が動かない
- セキュリティ上、クライアントにAPIキーを置くべきでない
- n8nプロキシ化（`/webhook/claude-proxy`）を推奨

### P3 — send-email ワークフローの内部IP
- `キャッシュ保存` ノードが `http://192.168.1.106:5678/webhook/import-emails` を参照
- DHCPで変わる可能性あり。`host.docker.internal` または固定IPを推奨

---

## 直近の変更履歴（セッション内）

| コミット | 内容 |
|---|---|
| `123e3db` | モバイルスクロール修正（`scrollTop=scrollHeight`、`setTimeout(80ms)`） |
| `7c87f30` | getAttachments binary+JSONマージ、全itemsループ、scrollEffect依存追加 |
| `e624091` | dataUrl全ファイル種別対応（5MB以内）、AttachmentBubble開く/DLボタン追加 |

---

## デバッグ用コマンド（ブラウザConsole）

```javascript
// メールキャッシュの状態確認
fetch("https://n8n.niida-imai.work/webhook/fetch-emails")
  .then(r=>r.json())
  .then(d=>console.log(d.emails.slice(0,3).map(e=>({
    subject: e.subject,
    attCount: e.attachments?.length,
    att0filename: e.attachments?.[0]?.filename,
    att0hasDataUrl: !!e.attachments?.[0]?.dataUrl,
    att0dataUrlLen: e.attachments?.[0]?.dataUrl?.length,
  }))))
```

---

## ファイル構成

```
new-mailer/
├── index.html                    ← メインSPA（React, 全機能）
├── manifest.json                 ← PWAマニフェスト
├── sw.js                         ← Service Worker
├── serve.py                      ← ローカル開発サーバー
├── n8n-workflow-fetch-emails.json ← メール取得WF定義（ローカルコピー）
├── n8n-workflow-send-email.json   ← メール送信WF定義（ローカルコピー）
├── _inbox_code.js                 ← 受信を保存 ノードのJSコード（編集用ソース）
├── _sent_code.js                  ← 送信を保存 ノードのJSコード（編集用ソース）
├── fix_workflow.py                ← _inbox/sent_code.js → JSON更新スクリプト
├── gen_sdk.py                     ← JSON → n8n SDK形式JS生成スクリプト
├── _workflow_sdk_fixed.js         ← gen_sdk.py出力（validate/updateに使用）
└── CLAUDE.md                      ← このファイル
```
