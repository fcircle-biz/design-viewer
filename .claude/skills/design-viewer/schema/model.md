# design-viewer 入力モデル `model.json` 仕様

このスキルの入力は `<プロジェクト>/docs/spec/viewer-src/` に置く 3 種類のファイル。

```
viewer-src/
  model.json           ← 本書が説明する入力モデル（手書き・AI 生成。座標は書かない）
  screens/<ID>.html     ← 画面モックアップ 1 画面 1 ファイル（完全な HTML 文書。_shared.css を相対リンク）
  screens/_shared.css   ← モックアップ共通 CSS（任意。無くてもよい）
```

`model.json` は座標を一切含まない。座標・辺のルート（折れ線）は `layout.js` が ELK.js で計算し、
`viewer-data.js` として出力する。人（または AI）が手で座標を調整する必要はない
（どうしても固定したいノードだけ `pin` で指定できる。後述）。

## 1. 全体構造

```jsonc
{
  "meta": { "title": "…", "subtitle": "…", "statusNote": "…（任意）" },
  "screens": [ Screen, … ],
  "groups": [ Group, … ],
  "modes": {
    "flow":    { "label": "画面遷移",   "desc": "…", "nodes": [FlowNode], "edges": [Edge], "legend": [Legend], "toggles": [Toggle] },
    "gallery": { "label": "画面イメージ", "desc": "…" },
    "concept": { "label": "概念図",     "desc": "…", "nodes": [ConceptNode], "edges": [Edge], "legend": [Legend] },
    "er":      { "label": "ER 図",      "desc": "…", "nodes": [ErNode],      "edges": [Edge], "legend": [Legend] },
    "dfd":     { "label": "データフロー", "desc": "…", "nodes": [DfdNode],     "edges": [Edge], "legend": [Legend], "steps": [Step] }
  }
}
```

- `meta.title` は必須。`subtitle` / `statusNote` は任意（`statusNote` は「作成中」等の一言を
  タイトルカードに表示する用途）。
- `modes` の 5 モードはすべて省略可。無いモードはビューアのモード切替ボタンに出ない。
- `screens` / `groups` は `modes.flow` や `modes.gallery` が無くても、画面一覧・詳細パネルの
  メタ情報として使われるので用意しておくとよい。

## 2. `screens[]`（画面）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | 画面の一意 id。`screens/<id>.html` のファイル名と一致させる |
| `title` | string | ○ | 画面タイトル |
| `platform` | string | - | 例: `app`（Power Apps キャンバス/モデル駆動）、`teams`（Teams 上の画面） |
| `role` | string | - | 主な利用者役割（例: 「担当者」「管理者」） |
| `group` | string | 推奨 | `groups[].id` を参照。未設定でも動くが flow/gallery で「(未分類)」レーンに入る |
| `w` / `h` | number | - | 画面の幅・高さ（px）。省略時 `1440 × 900` |
| `tasks` | string[] | - | 関連タスク ID（詳細パネルに表示） |
| `spec` | string[] | - | 関連仕様書の節番号（詳細パネルに表示） |
| `purpose` | string | - | 画面の目的（詳細パネルに表示） |
| `ops` | string[] | - | 主な操作（詳細パネルに表示） |
| `reads` / `writes` | string[] | - | 読み取り／書き込みするデータ（詳細パネルに表示） |
| `notes` | string[] | - | 注意事項（詳細パネルに表示） |
| `pin` | `{x,y}` | - | このノードの最終座標を固定する（§7 参照） |

`screens[]` に列挙した画面は、`modes.flow` があれば flow モードのノードとして、
`modes.gallery` があれば gallery モードのノードとして**自動的に**追加される
（`modes.flow.nodes` / `modes.gallery.nodes` に画面ノードを書く必要はない）。

## 3. `groups[]`（グループ／レーン）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | グループの一意 id |
| `label` | string | ○ | レーン見出しに表示するラベル |
| `order` | number | ○ | 表示順（小さい方が上／先）。flow はこの順に上から積んだ横帯（レーン）になり、
gallery はこの順に見出し帯として並ぶ |

`screens[].group` と `modes.flow.nodes[].group` から参照される。
どちらのモードにも属さない（`flow` も `gallery` も無い）プロジェクトでは省略してよい。

## 4. `modes.flow`（画面遷移）

```jsonc
"flow": {
  "label": "画面遷移", "desc": "…",
  "nodes": [
    { "id": "START", "kind": "pill", "label": "アプリ起動", "sub": "…", "group": "staff" }
  ],
  "edges": [
    { "from": "START", "to": "S01", "type": "start", "label": "通常起動" },
    { "from": "S01", "to": "S02", "type": "user", "label": "行を選択" }
  ],
  "legend": [ { "type": "user", "label": "利用者の操作による遷移" } ],
  "toggles": [ { "type": "nav", "label": "左ナビの移動を表示", "default": false } ]
}
```

- `nodes[]`: 画面**以外**のノード（起点・分岐点など）だけを書く。`kind` は既定 `pill`
  （360×110 の角丸ノード）。`group` は `groups[].id` を参照（レーン配置に使う）。
- `edges[]`: `from`/`to` は画面 id（`screens[]`）または `nodes[]` の id を参照する。
  `type` は `user | system | nav | start | rel | weak | flow` のいずれか（未指定・未知の値でも
  動くが、v1 と同じ配色・線種に対応させたいなら上記を使う。色は engine 側で固定）。
- レーン（横帯）は `groups[].order` の順に上から積む。**同一レーン内は ELK の layered
  アルゴリズム（左→右）で自動配置し、レーンをまたぐ辺だけ後から手動の直交ルートで
  つなぐ**（`layout.js` の設計判断。詳細はスクリプト冒頭のコメントを参照）。

## 5. `modes.gallery`（画面イメージ）

```jsonc
"gallery": { "label": "画面イメージ", "desc": "…" }
```

`nodes` / `edges` は書かない（書いても無視され、`validate.js` が警告する）。
`screens[]` を `groups[].order` → 出現順で group ごとに見出し帯へ格子状に並べる。

## 6. `modes.concept`（概念図）／ `modes.dfd`（データフロー）

```jsonc
"concept": {
  "label": "概念図", "desc": "…",
  "nodes": [
    { "id": "ACTOR1", "kind": "concept", "variant": "actor", "icon": "user", "label": "利用者", "sub": "…", "info": ["…"] }
  ],
  "edges": [ { "from": "ACTOR1", "to": "SYS1", "type": "rel", "label": "問い合わせる" } ],
  "legend": [ … ]
}
```

- concept: `variant` は `actor | entity | system`。ノードサイズは 240×88 固定。
- dfd は `variant` が `ext | proc | store`（外部エンティティ／プロセス／データストア）で、
  `code`（例: `P1`）を持てる。ノードサイズは 240×92 固定。`edges[].step` を使うと
  `steps[]`（`{n, title, desc}` の配列）の手順と紐づき、ビューアの DFD ステップカードから
  該当する辺だけをハイライトできる。
- 両モードとも layout.js は ELK の `layered`（左→右）と `stress` を両方試し、辺の交差が
  少ない方を自動採用する。

```jsonc
"dfd": {
  "label": "データフロー", "desc": "…",
  "nodes": [ { "id": "P1", "kind": "dfd", "variant": "proc", "code": "P1", "icon": "gear", "label": "問い合わせ登録", "sub": "…" } ],
  "edges": [ { "from": "EXT1", "to": "P1", "type": "flow", "label": "問い合わせ内容", "step": 1 } ],
  "steps": [ { "n": 1, "title": "利用者が入力する", "desc": "…" } ]
}
```

## 7. `modes.er`（ER 図）

```jsonc
"er": {
  "label": "ER 図", "desc": "…",
  "nodes": [
    { "id": "T_CUSTOMER", "kind": "er", "tone": "blue", "label": "顧客", "sub": "fc_Customer", "info": ["…"],
      "fields": [
        { "name": "id", "type": "int", "key": "PK", "note": "主キー" },
        { "name": "name", "type": "string", "key": "", "note": "" }
      ] }
  ],
  "edges": [
    { "from": "T_ORDER", "to": "T_CUSTOMER", "type": "rel", "fromField": "customer_id", "toField": "id", "label": "" }
  ]
}
```

- `tone` は `blue | amber | green | slate | purple | teal`（ヘッダー色）。
- `fields[].key` は `PK | FK | UK | ""`（バッジ表示に使う。`""` または省略でバッジ無し）。
- `fromField` / `toField` を指定すると、その行の左右中央（`y = 56 + 30×行番号 + 15`）に
  ELK の固定位置ポートを作り、そこに辺を接続する（**必ず `fromField`/`toField` は対応する
  ノードの `fields[].name` と一致させること**。一致しないと `validate.js` がエラーにする）。
  省略した場合はノード全体（自動位置）につなぐ。
- ノードサイズは自動計算: 幅 420、高さ `56 + 30 × fields.length`（ヘッダー 56px、行 30px）。
- **層方向のヒューリスティック**: `layout.js` は ER 辺の `from`（FK を持つ側）を東（右）側の
  ポート、`to`（参照される側）を西（左）側のポートとして ELK に渡す。ELK は layered（左→右）
  で解くため、通常は FK を持つテーブルが参照先テーブルより右に来る。循環参照や逆向きの
  参照が多いスキーマでは、辺が左に戻って引かれる（見た目は崩れないが右→左のループになる）
  ことがある。既知の制約として `SKILL.md` / 最終報告に記載する。

## 8. `Edge` 共通形式

全モード共通:

```jsonc
{ "from": "…", "to": "…", "label": "…", "type": "user|system|nav|start|rel|weak|flow",
  "fromField": "…", "toField": "…",     // er のみ
  "fromLabel": "…", "toLabel": "…",     // 端点近くの小さな補助ラベル（任意）
  "step": 1                              // dfd のみ。modes.dfd.steps[].n を参照
}
```

`fromSide` / `toSide` は **v2 では廃止**（ルートは ELK / layout.js が自動で決める）。
v1 の `data.js` からの移植時はこの 2 プロパティを削除してよい（渡しても無視される）。

## 9. `pin`（座標の手動固定）

任意のノード（`screens[]` の画面、`modes.*.nodes[]` の各ノード）に

```jsonc
"pin": { "x": 0, "y": 0 }
```

を書くと、レイアウト計算後にそのノードの最終座標を `pin` の値で上書きする
（ワールド座標。モードのローカル原点基準）。**用途はごく少数の「どうしてもここに
固定したい」ノードに限る**。理由:

- 他ノードとの重なり回避の対象には**ならない**（ELK の自動配置の外側で上書きするため）。
- そのノードに接続する辺は、ELK が計算した経路ではなく単純な直交（L 字）ルートに
  引き直される。
- 大量に `pin` を使うと見た目が崩れやすい。`layout.js` は `pin` を適用するたびに
  警告を出す。

## 10. icon 名の集合

`icon` に指定できる名前は v1 と同じ固定集合:
`chat bell team cal bot apps search inbox doc check tag user flow db spark shield gear plus back list send warn`

## 11. 最小の例

```jsonc
{
  "meta": { "title": "サンプル" },
  "screens": [
    { "id": "S01", "title": "一覧", "group": "g1", "purpose": "一覧を見る" },
    { "id": "S02", "title": "詳細", "group": "g1", "purpose": "詳細を見る" }
  ],
  "groups": [ { "id": "g1", "label": "担当者", "order": 1 } ],
  "modes": {
    "flow": {
      "label": "画面遷移",
      "nodes": [ { "id": "START", "label": "起動", "group": "g1" } ],
      "edges": [
        { "from": "START", "to": "S01", "type": "start" },
        { "from": "S01", "to": "S02", "type": "user", "label": "行を選択" }
      ]
    },
    "gallery": { "label": "画面イメージ" }
  }
}
```

`screens/S01.html` と `screens/S02.html`（完全な HTML 文書）を用意すれば、
`node build.js <viewer-src> <out>` でビューアが生成できる。

## 12. `validate.js` が検出するもの

- id の重複（`screens` / `groups` / 各モードの `nodes`。ただしモードをまたいだ id 再利用は
  エラーにしない — 同じ id が複数モードに出てくるとビューアはモード切替時にその
  ノードをトゥイーンする仕様のため）
- 未知の id を参照する辺（`from`/`to`）
- ER の `fromField` / `toField` が対応ノードの `fields[].name` に存在しない
- dfd の `edges[].step` が `steps[].n` に存在しない
- `screens[].group` / flow ノードの `group` が `groups[].id` に存在しない
- `screens/<ID>.html` が無い（警告のみ）
- 必須項目（`meta.title`、`screens[].id/title`、`groups[].id/label`、各ノードの `id` など）の欠落

エラーは非 0 終了。警告は表示のみで終了コードに影響しない。
