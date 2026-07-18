# JOYFIT24 9周年チャレンジ 特設ページ

## 内容

- `index.html`: スマホ向けのログイン制投稿フォーム兼ランキングページです。
- `joyfit9-pop.png`: POP画像をページ上部に使う素材です。
- `Code.gs`: Google Apps Scriptに貼り付けるスプレッドシート連携コードです。

## 運用イメージ

1. 参加者はQRからページを開き、ニックネーム、4桁パスワードでログインします。
2. 初回ログイン時に `participants` シートへ自動登録されます。
3. ログイン後、今週の種目の記録だけ入力して送信します。
4. 送信データは `records` シートに入り、ランキングに反映されます。

## 画面の使い方

1. 「記録を送信」でニックネーム、4桁パスワードを入力します。
2. ログイン後、記録を入力して送信します。
3. 「ランキング」で今週TOP10と過去WeekのTOP10を確認できます。

## GAS連携手順

1. Googleスプレッドシートを開きます。
2. `拡張機能 > Apps Script` を開きます。
3. `Code.gs` の中身を貼り付けて保存します。
4. エディタ上部の関数選択で `setupSheets` を選んで実行します。
5. 初回だけGoogleの権限許可を行います。
6. `participants` シートにサンプル参加者が作成されます。通常は参加者の初回ログインで自動追加されます。
7. `デプロイ > 新しいデプロイ > ウェブアプリ` を選びます。
8. 実行ユーザーは「自分」、アクセス権は運用方針に合わせて「全員」または「リンクを知っている全員」にします。
9. 発行されたウェブアプリURLを `index.html` の `CONFIG.gasEndpoint` に貼り付けます。

```js
const CONFIG = {
  gasEndpoint: "https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec"
};
```

このページはGASとJSONP方式で通信します。静的HTMLをそのまま公開しても、ブラウザのCORS制限に引っかかりにくい構成です。

今回のスプレッドシートIDは `Code.gs` の `SPREADSHEET_ID` に設定済みです。

## participants シート

店舗側で確認できる参加者管理シートです。

`participantId`, `fullName`, `nickname`, `pin`, `division`, `active`, `memo`, `createdAt`, `updatedAt`

- `participantId`: 自動発行される内部IDです。
- `fullName`: 今回は入力画面では使いません。空欄でOKです。
- `nickname`: ランキング表示名です。個人が特定されない名前を案内してください。
- `pin`: 4桁パスワードです。例: `1234`
- `division`: `member` または `staff`
- `active`: `TRUE` ならログイン可能

## テストWeek

現在は本番前確認のため、`index.html` の `testWeekOverride` と `Code.gs` の `TEST_WEEK_OVERRIDE` を `1` にしています。
イベント開始後に日付で自動切替したい場合は、どちらも空または `0` に変更してください。

## records シート

送信された記録が入るシートです。

`id`, `createdAt`, `dateKey`, `participantId`, `displayName`, `week`, `event`, `score`, `unit`, `division`, `inputBy`, `userAgent`

## 現在のルール

- 開催期間は 2026/8/3 から 2026/8/30 です。
- Week 1: 握力測定
- Week 2: 前屈
- Week 3: プランク
- Week 4: 腕立て伏せ
- 同じ識別情報は1週間に最大3回まで登録できます。
- 同じ識別情報は同じ日に1回まで登録できます。
- ランキングは同じ識別情報の週内記録を合計して並べます。

## 調整しやすいところ

- イベント日程や種目名は `index.html` と `Code.gs` の `weeks` / `EVENT_WEEKS` を変更します。
- 識別メモを必須にしたい場合は、`index.html` の該当inputに `required` を追加し、GAS側でも空欄チェックを追加します。
- スタッフをランキングから分けたい場合は、`division` を使って表示条件を追加できます。
