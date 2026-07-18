# JOYFIT24 9周年チャレンジ 特設ページ

## 内容

- `index.html`: スマホ向けの投稿フォーム兼ランキングページです。
- `joyfit9-pop.png`: POP画像をページ上部に使う素材です。
- `Code.gs`: Google Apps Scriptに貼り付けるスプレッドシート連携コードです。

## 画面の使い方

1. `index.html` をブラウザで開くと、デモデータ付きで見た目を確認できます。
2. 「記録を送信」からイニシャル、識別メモ、記録、区分を入力できます。
3. 「ランキング」で今週TOP10と過去WeekのTOP10を確認できます。

## GAS連携手順

1. Googleスプレッドシートを新規作成します。
2. `拡張機能 > Apps Script` を開きます。
3. `Code.gs` の中身を貼り付けて保存します。
4. `デプロイ > 新しいデプロイ > ウェブアプリ` を選びます。
5. 実行ユーザーは「自分」、アクセス権は運用方針に合わせて「全員」または「リンクを知っている全員」にします。
6. 発行されたウェブアプリURLを `index.html` の `CONFIG.gasEndpoint` に貼り付けます。

```js
const CONFIG = {
  gasEndpoint: "https://script.google.com/macros/s/xxxxxxxxxxxxxxxx/exec"
};
```

このページはGASとJSONP方式で通信します。静的HTMLをそのまま公開しても、ブラウザのCORS制限に引っかかりにくい構成です。

## スプレッドシート列

GASは `records` シートを自動作成し、次の列を使います。

`id`, `createdAt`, `dateKey`, `displayName`, `participantKey`, `week`, `event`, `score`, `unit`, `division`, `proxyInput`, `userAgent`

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
