# vendor/elk.bundled.js

[ELK.js](https://github.com/kieler/elkjs)（Eclipse Layered Graphs フレームワークの JavaScript 移植版）を
`npm pack` 相当で取得し、`lib/elk.bundled.js` をそのままコピーしたもの。

- **パッケージ**: `elkjs`
- **バージョン**: `0.12.0`（2026-09-15 に npm レジストリから取得）
- **取得方法**: 一時フォルダーで `npm install elkjs` → `node_modules/elkjs/lib/elk.bundled.js` と
  `node_modules/elkjs/LICENSE.md` をコピー。リポジトリルートの `package.json` は変更していない
  （このスキルはプロジェクト非依存で `vendor/` 同梱のみに依存する設計のため）。
- **ライセンス**: Eclipse Public License 2.0 / GPL-3.0-or-later のデュアルライセンス。
  全文は同梱の `ELK-LICENSE.md` を参照。
- **Node からの使い方**: `elk.bundled.js` は UMD バンドルで、`require()` すると ELK コンストラクター
  （`elk.bundled.d.ts` の型で言う `ELK` クラス）がそのまま返る。ワーカースレッドや `web-worker`
  パッケージは不要（既定でバンドル内の同期フェイクワーカー `elk-worker.min.js` を使う。
  `workerUrl` オプションを渡さない限り外部依存を要求しない。動作確認済み）。

  ```js
  const ELK = require('./vendor/elk.bundled.js');
  const elk = new ELK();
  const result = await elk.layout({ id: 'root', children: [...], edges: [...] });
  ```

- **更新方法**: 同じ手順で新しいバージョンを取得し、このファイルのバージョン表記を更新する。
  ブラウザー（engine/viewer.js）側では ELK を使わない（レイアウトはビルド時に layout.js が
  計算し、結果を `viewer-data.js` に焼き込む）ため、engine 側に ELK を同梱する必要はない。
