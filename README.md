# design-viewer

仕様書・設計書から、**システムの全体像を 1 枚の無限キャンバスで見られる静的ビューア**（HTML）を生成する Claude Code スキルです。

生成物は `file://` で開ける HTML 一式で、サーバーも外部 CDN も要りません。概念図から構成図まで 8 種類の図を 1 つのキャンバスでボタン切り替えして見られます。

## 8 つの表示モード

| モード | 内容 |
| --- | --- |
| 概念図 | 人・仕組み・情報・外部ファイルの関係 |
| 業務フロー | アクター（列）× 業務内容（行）のスイムレーン表 |
| 機能一覧 | 全画面とバッチ機能の一覧（サムネイル格子／1 機能 1 行の表） |
| 画面遷移図 | 画面モックアップのサムネイルを遷移の矢印で結ぶ |
| ER図 | テーブル・列・リレーション・多重度（論理名を表示、物理名は詳細パネル） |
| データフロー | 外部実体・処理・データストアの流れ（ステップ再生つき） |
| ジョブフロー | バッチのジョブの順序。正常終了・異常終了・再実行を線種で区別 |
| 構成図 | AWS などのクラウド構成（クラウド › VPC › AZ › サブネットの入れ子） |

ビューアの操作: ドラッグで移動、ホイールで拡大縮小、`F` で全体表示、`1`〜`8` でモード切替、`/` で検索、クリックで詳細パネル（画面の等倍プレビュー・仕様の転記・つながり）、右下のミニマップで移動。

## 使い方

### 1. スキルを置く

`.claude/skills/design-viewer/` をそのままビューアを作りたいリポジトリへコピーします。プロジェクト非依存なので、これ以外に必要なファイルはありません。

```
cp -r .claude/skills/design-viewer <あなたのリポジトリ>/.claude/skills/
```

### 2. Claude Code から呼ぶ

仕様書を指してスキルを起動します。

```
/design-viewer docs/仕様書.md からビューアを作って
```

「画面遷移図」「ER 図」「システム構成図」「設計ビューア」といった依頼でも呼び出されます。Claude が仕様書を読み、入力（`model.json` と画面モックアップ HTML）を書き、ビルドまで行います。

### 3. 開く

```
<アプリ>/docs/spec/html/index.html
```

をブラウザで開きます。

## 入力と生成物

```
<アプリ>/docs/spec/viewer-src/   入力（人・AI が書く）
  model.json                     図の定義（大きい場合は model/**/*.json に分割可）
  screens/<ID>.html              画面モックアップ（1 画面 1 ファイル）
  screens/_shared.css            画面共通のスタイル

<アプリ>/docs/spec/html/         生成物（手で編集しない）
  index.html                     これを開く
```

座標は書きません。配置は ELK.js による自動レイアウトで決まります。入力仕様の詳細は [schema/model.md](.claude/skills/design-viewer/schema/model.md)、作成手順は [SKILL.md](.claude/skills/design-viewer/SKILL.md) にあります。

## 手動でビルドする

Claude を介さず、入力を直接編集して再ビルドすることもできます。リポジトリルートで:

```
node .claude/skills/design-viewer/scripts/build.js <アプリ>/docs/spec/viewer-src <アプリ>/docs/spec/html
```

- `--skip-thumbs` でサムネイル生成を飛ばせます（変更の無い画面はハッシュで自動スキップ）。
- 各段階は単体でも実行できます: `validate.js` / `layout.js` / `thumbs.js` / `assemble.js`。

## 前提

- Node 18 以上。ELK.js は同梱しているので `npm install` は不要です。
- サムネイル生成に Playwright（`node_modules/playwright`）。無い場合はサムネイルを飛ばし、画面は灰色の矩形になります。
- ビューアは `file://` で動きます（サーバー不要・外部 CDN 不要）。

## 規模の目安

〜100 画面・〜50 テーブル規模を想定しています。描画は Canvas 2D で、ダミー 100 画面・50 テーブル・400 辺で 1 フレーム p95 おおむね 5〜9ms です。

自動レイアウトの効きにくいケース（60 画面規模の画面遷移、共有データストアの多いデータフローなど）と回避策は [SKILL.md の「既知の制約」](.claude/skills/design-viewer/SKILL.md#既知の制約) にまとめてあります。

## サンプル

[docs/](docs/) は、このスキルで生成したサンプルです。仕様書 → 入力 → 生成物が一式そろっています。

| サンプル | 内容 |
| --- | --- |
| [docs/商品管理システム/](docs/商品管理システム/) | 商品・カテゴリ・在庫の管理。10 画面、6 モード |
| [docs/顧客管理システム/](docs/顧客管理システム/) | 顧客管理。21 画面、ジョブフロー・構成図を含む 8 モード |

それぞれ `spec/html/index.html` をブラウザで開くと、実際のビューアを見られます。

## ライセンス

MIT License（[LICENSE](LICENSE)）。

同梱している ELK.js（elkjs 0.12.0）は EPL-2.0 です（[ELK-LICENSE.md](.claude/skills/design-viewer/scripts/vendor/ELK-LICENSE.md)）。
