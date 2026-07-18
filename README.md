# JOYFIT24 9周年チャレンジ 特設ページ

## 内容

- `index.html`: スマホ向けのログイン制投稿フォーム兼ランキングページです。
- `joyfit9-pop.png`: POP画像をページ上部に使う素材です。
- `Code.gs`: Google Apps Scriptに貼り付けるスプレッドシート連携コードです。

## 運用イメージ

1. 店舗側で `participants` シートに参加者を登録します。
2. 参加者はQRからページを開き、参加者IDと4桁PINでログインします。
3. ログイン後、今週の種目の記録だけ入力して送信します。
4. 送信データは `records` シートに入り、ランキングに反映されます。

## 画面の使い方

1. 「記録を送信」で参加者IDと4桁PINを入力します。
2. ログイン後、記録を入力して送信します。
3. 「ランキング」で今週TOP10と過去WeekのTOP10を確認できます。

## GAS連携手順

1. Googleスプレッドシートを開きます。
2. `拡張機能 > Apps Script` を開きます。
3. `Code.gs` の中身を貼り付けて保存します。
4. エディタ上部の関数選択で `setupSheets` を選んで実行します。
5. 初回だけGoogleの権限許可を行います。
6. `participants` シートに参加者を登録します。
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

店舗側で管理するログイン用シートです。

`participantId`, `displayName`, `pin`, `division`, `active`, `memo`, `createdAt`

- `participantId`: 参加者IDです。例: `0001`
- `displayName`: ランキング表示名です。例: `T.K`
- `pin`: 4桁PINです。例: `1234`
- `division`: `member` または `staff`
- `active`: `TRUE` ならログイン可能

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
