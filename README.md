# アゲテナ（登記完了予定日確認アプリ）

申請日を入力すると、**掲載データのある法務局の不動産（権利）登記／商業・法人登記**の完了予定日を自動表示し、案件を一覧管理するPWA。
完了予定日を過ぎた案件だけ、一覧と画面上部に控えめな超過表示が出る。

## いまの状態：Phase 2a + 全国第2波対応テスト版

- `file://` で直接開いて動く（ローカルサーバー不要）
- GitHub Pages では起動時に最新の `kanryo.json` を取得
- ユーザーの検索操作では法務局サイトへアクセスせず、保存済みデータだけを照会
- 画面上に「目安であり正確性を保証しない」旨を表示
- `kanryo.json` は `kanryo-integrity.js` のSHA-256ハッシュで整合性確認
- GitHub Actions が日本時間8:00〜16:00の間、1時間に1回データを自動更新
- 取得済みの過去申請日データは消さずに蓄積（現在掲載中／過去取得済みを区別）
- 対象法務局：50法務局・地方法務局（8法務局＋42地方法務局。47都道府県単位ではなく、北海道が札幌・函館・旭川・釧路の4つに分かれるため全国計50）
- UIは「法務局 → 登記種別 → 申請方法 → 管轄 → 申請日」の5段選択
- 保存案件は検索、法務局・種別・時期での絞り込み、今週／来週などのグルーピングに対応
- レターパック申請は、法務局データによる完了予定日の1営業日後（土日を除く）として登録
- 完了予定日が表示される場合も未掲載の場合も、アゲテナ上で登録日と案件名を入力してから、その内容でGoogleカレンダー予定作成画面を開ける
- レターパック申請と未掲載補完を併用した場合は、Googleカレンダーに渡す候補日を直前の取得済み予定日から合計2営業日後
- 未掲載案件で選んだ仮日付は、案件名と一緒に案件一覧へ保存・更新される（同じ案件の未掲載行やメモなしの近接仮登録は重複作成せず更新）
- 保存案件の件名を押すと、案件名と完了予定日を差し込んだ申請報告文を表示・コピー
- 各案件からGoogleカレンダーの予定作成画面を開ける（未掲載案件は日付を選んで保存案件も更新。件名は「【完了予定日】＋保存した件名」）
- 保存案件には、保存時点のデータ基準日・データ識別情報を保持
- オフライン時や取得失敗時は端末内の同梱データを使用
- 事務所共有モードの土台を追加（通常URLでは非表示。チーム用URLで開いた端末だけ表示）

## 使い方（Windowsで見た目確認）

1. エクスプローラで `touki-kanryo-app/app/index.html` をダブルクリック（ブラウザで開く）
2. 法務局・登記種別・管轄・申請日を選ぶと完了予定日がプレビュー表示
3. 「一覧に保存」で案件を保存（初期状態は端末のlocalStorageに保存。サーバーに送信しない）
4. 事務所共有を使う場合は、`docs/shared-office-setup.md` に沿ってSupabaseを設定し、「保存先」からログイン

## フォルダ構成

```
touki-kanryo-app/
├─ app/                  PWA本体（これを配布する）
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js            画面・案件管理・完了予定日lookup
│  ├─ shared-config.js  事務所共有モードの接続設定（初期値は無効）
│  ├─ sw.js             オフライン用（http(s)配信時のみ有効）
│  ├─ manifest.webmanifest
│  ├─ CNAME             GitHub Pagesカスタムドメイン
│  ├─ icon.svg
│  └─ data/
│     ├─ kanryo.json          取得データ（人間確認用）
│     ├─ kanryo.js            同じ内容のJS版（file://で読むのはこちら）
│     └─ kanryo-integrity.js  kanryoデータのSHA-256整合性情報
├─ docs/
│  └─ shared-office-setup.md  事務所共有モード設定手順
├─ supabase/
│  └─ shared-office-schema.sql  事務所共有モード用DB/RLS
├─ extension/
│  ├─ manifest.json     Chrome拡張版の設定
│  └─ popup.html        Chrome拡張版の画面
├─ scraper/
│  ├─ scrape.mjs        法務局サイト→ kanryo.json / kanryo.js を生成
│  ├─ build-single.mjs  単一HTML生成
│  └─ build-zip.mjs     配布Zip生成
├─ package.json         PDF読取用依存関係
└─ package-lock.json
```

## データ更新

```
npm run scrape
```

掲載データのある対応法務局の完了予定日ページから、
`法務局 → 登記種別 → 庁 → 申請日 → 完了予定日` を `app/data/` へ書き出す。
前回までに取得したデータと合体し、現在の公式ページから消えた申請日も「過去取得済み」として保持する。

ユーザー検索のたびに法務局サイトへ取りに行く都度取得型ではなく、定期取得したスナップショットを配信する設計。
更新スクリプトは登録済みURLだけを順番に取得し、各リクエストの開始間隔を既定で1.5秒以上空ける。

- HTML表型：各法務局の完了予定日一覧を取得
- HTMLリンク型：東京法務局の完了予定日ページ群を取得
- PDF文字型：PDFの完了予定日表を取得して文字抽出（ブロック型・横長表型に対応）

GitHub上では `.github/workflows/pages.yml` が日本時間8:00〜16:00の間、毎時自動実行し、変更があれば
`app/data/kanryo.json` と `app/data/kanryo.js` をコミットしてPagesへ公開する。

- 出典：各法務局の登記完了予定日ページ
- AM/PMは区別せず、同一申請日の遅い方の完了予定日を採用
- 不動産（表示）登記は対象外
- 既存の保存案件は、法務局未指定の場合は東京法務局として扱う
- 履歴蓄積により、過去に取得済みの申請日は公式ページの掲載終了後も検索できる

## Chrome拡張版

案件保存あり・事務所共有なしのChrome拡張版を生成できます。

```
npm run build:extension
```

生成物:

- `dist/chrome-extension/`
  - Chromeの `chrome://extensions/` で「パッケージ化されていない拡張機能を読み込む」から指定するフォルダ
- `dist/アゲテナChrome拡張.zip`
  - テスター配布用Zip

拡張版の案件保存は、そのChrome拡張の中だけです。事務所共有DBには送信しません。
完了予定日の最新データは `https://tools.ishimoto-legal.com/data/kanryo.json` を読み込みます。
通信できないときは、拡張機能に同梱したデータを使います。

## 事務所共有モード

通常はこれまでどおり端末内保存です。`app/shared-config.js` を設定すると、Supabase Auth + RLS による事務所共有モードを使えます。

- 共有対象：案件名、法務局、管轄、登記種別、申請日、登記完了予定日、完了状態
- 事務所ごとに `office_id` で分離
- 先生・事務員さんはチーム用URLから開き、メールアドレス／パスワードでログイン
- 設定手順：`docs/shared-office-setup.md`
- DB/RLS SQL：`supabase/shared-office-schema.sql`

## 設計判断（合意済み）

- 形態：PWA（Mac不要・App Store不要・月額0円）
- 対象：掲載データのある法務局・不動産（権利）登記／商業・法人登記
- 完了予定日：申請日から自動算出（カメラ読取は将来構想）
- 「過ぎたら」基準：完了予定日の**翌日**（当日は通常表示）
- データ置き場：初期状態は端末内のみ。事務所共有モードを有効にした場合だけ、ログイン済み事務所メンバー用DBに保存する
- 事務所共有：案件名も共有対象になるため、Supabase側でRLSを必ず有効化し、事務所メンバーだけに限定する

## Phase 2

### 2a（実装済み）

- GitHub Actions で日次スクレイピング → 最新データを自動配信
- GitHub Pages のHTTPS配信 → iPhoneの「ホーム画面に追加」で常用
- `tools.ishimoto-legal.com` のカスタムドメインで公開

### 2b（次の予定）

- Cloudflare（Workers・KV・無料枠）＋ Web Push（VAPID）で当日通知
  - 通知本文は汎用文（依頼者情報はサーバーに送らない＝守秘義務）

## Phase 3（構想）

- 受付のお知らせをカメラ撮影 → OCR で申請日を自動入力
- 未対応の法務局・地方法務局へ順次拡大
## 公開中の関連ツール

- テナシリーズ ポータル（トップ）: https://tools.ishimoto-legal.com/ ← ソースは `site/`。掲載するのは完成済みツールのみ
- アゲテナ（新URL）: https://tools.ishimoto-legal.com/agetena/
- ミチテナ（法定公告 満了日計算）: https://tools.ishimoto-legal.com/michitena/
- トウシテナ（登記用電子署名チェッカー・**開発中のためポータル未掲載**）: https://tools.ishimoto-legal.com/toshitena/
- トウシテナ（従来URL・リダイレクト）: https://tools.ishimoto-legal.com/electronic-signature-checker/
- アゲテナの従来のプライバシー説明URL（`/privacy.html`）は `/agetena/privacy.html` へリダイレクト
- ルート（`/`）をホーム画面に追加済みの旧アゲテナ利用者は、アプリとして起動したときだけ `/agetena/` へ自動転送される
