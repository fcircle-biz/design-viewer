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
  "meta": { "title": "…", "subtitle": "…", "statusNote": "…（任意）", "modeOrder": ["concept", "biz", "gallery", "flow", "er", "dfd"] },
  "screens": [ Screen, … ],
  "groups": [ Group, … ],
  "modes": {
    "flow":    { "label": "画面遷移",   "desc": "…", "nodes": [FlowNode], "edges": [Edge], "legend": [Legend], "toggles": [Toggle] },
    "gallery": { "label": "画面イメージ", "desc": "…" },
    "concept": { "label": "概念図",     "desc": "…", "nodes": [ConceptNode], "edges": [Edge], "legend": [Legend] },
    "biz":     { "label": "業務フロー", "desc": "…", "lanes": [Lane], "phases": [Phase], "nodes": [BizNode], "edges": [Edge], "legend": [Legend] },
    "er":      { "label": "ER 図",      "desc": "…", "nodes": [ErNode],      "edges": [Edge], "legend": [Legend] },
    "dfd":     { "label": "データフロー", "desc": "…", "nodes": [DfdNode],     "edges": [Edge], "legend": [Legend], "steps": [Step] }
  }
}
```

- `meta.title` は必須。`subtitle` / `statusNote` は任意（`statusNote` は「作成中」等の一言を
  タイトルカードに表示する用途）。
- `modes` の 6 モードはすべて省略可。無いモードはビューアのモード切替ボタンに出ない。
- モード切替ボタンの表示名は各モードの `label`。並び順は `meta.modeOrder`（任意。モードのキーの配列）で指定でき、
  書かなかったモードは既定順（flow, gallery, concept, biz, er, dfd）で後ろに続く。数字キー 1〜n はボタンの並び順に対応する。
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
| `pin` | `{x,y}` | - | このノードの最終座標を固定する（§9 参照） |
| `nudge` | `{dx,dy}` | - | `modes.flow.layout: "elk"` のとき、配置後に flow 上の位置をずらす（§4.1） |

`screens[]` に列挙した画面は、`modes.flow` があれば flow モードのノードとして、
`modes.gallery` があれば gallery モードのノードとして**自動的に**追加される
（`modes.flow.nodes` / `modes.gallery.nodes` に画面ノードを書く必要はない）。

## 3. `groups[]`（グループ／レーン）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | グループの一意 id |
| `label` | string | ○ | レーン見出しに表示するラベル |
| `order` | number | ○ | 表示順（小さい方が上／先）。flow はこの順に上から積んだ横帯（レーン）になり、
gallery はこの順に左→右（棚詰めで折り返し）のブロックとして並ぶ |

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
- `layout`: `"lanes"`（既定）または `"elk"`。下記の 2 方式を切り替える。
- **`lanes`**: レーン（横帯）は `groups[].order` の順に上から積む。**同一レーン内は
  記述順の安定位相ソートで 1 行に並べ、レーンをまたぐ辺は後から手動の直交ルートで
  つなぐ**（`layout.js` の設計判断。詳細はスクリプト冒頭のコメントを参照）。

### 4.1 `layout: "elk"`（全体 ELK ＋ カード ＋ 曲線）

`docs/design-viewer-elk.html` と同じ見た目にする方式。レーンを作らず、全ノードを
1 回の ELK layered（左→右）で配置する。役割・チャネルの区別はカードのバッジで示す。

```jsonc
"flow": {
  "label": "画面遷移", "layout": "elk",
  "edgeStyle": "curve",                                  // 任意。curve（既定）| orthogonal
  "layoutOptions": { "spacing.nodeNode": 520 },          // 任意。ELK オプションの上書き（ワールド px）
  "nodes": [
    { "id": "START", "kind": "pill", "label": "アプリ起動", "sub": "Power Apps / deep link", "attachTo": "S01" }
  ],
  "edges": [ … ]
}
// screens 側: { "id": "T01", …, "nudge": { "dy": -720 } }
```

| 項目 | 説明 |
|---|---|
| 画面ノード | 白い角丸カード（上部に「ID タイトル」と `platform / role` バッジ、下にサムネイル）。寸法は幅 360px のカードを基準にした参照 px の 4 倍（1440 幅の画面ならカード 1520×1116） |
| `edgeStyle: "curve"` | 辺の向き（中心間の dx/dy の大きい方）で出る側・入る側を決め、3 次ベジェで結ぶ。同じ側に複数の辺が付くと相手の位置順に散らすので、往復の辺も重ならない |
| `edgeStyle: "orthogonal"` | ELK の直交ルートをそのまま使う |
| `layoutOptions` | 既定値は参照 HTML と同じ間隔（参照 px: nodeNode 130・層間 230・edgeNode 80・edgeEdge 40・componentComponent 220・padding 100）の 4 倍。キーは `elk.` を省略可 |
| `nudge: {dx, dy}` | ELK 配置後にノードをずらす（ワールド px。`screens[]` と `nodes[]` に書ける）。「T 系の画面は上、FAQ 系は下」のような見た目上の段分けに使う |
| `attachTo` / `attachSide` / `attachGap` | そのノードを ELK に渡さず、`attachTo` のノードの横（`left` 既定 \| `right` \| `top` \| `bottom`）に `attachGap`（参照 px、既定 130）空けて置く。起点ノード向け。起点を ELK に含めると層が 1 つ増えて全体の並びが変わるため。相手が `pin` 済みなら固定後の座標を基準にする |

- `group` は使わない（書いてもよいが flow では無視。gallery では従来どおり使う）。
- **`type: "weak"` の辺は層の決定に使わない**（配置後に描くだけ）。「保存後に詳細へ戻る」のような逆向きの
  遷移は `weak` にする。`user` のまま往復の辺を書くと ELK が層順を入れ替え、主な流れ（左→右）が読めなくなる。
  既定で隠したい場合は `toggles: [{ "type": "weak", "label": "戻る遷移を表示", "default": false }]`。
- ハブ型（ダッシュボードから各機能へ放射状に分かれる）で、長い辺がカードの下を通る場合は、
  全画面を `pin` で格子に置くほうが読みやすい（列の間隔を行の間隔より広くすると、辺が上下でなく左右から出入りしてカード見出しを避ける）。
- nudge / attachTo / pin の結果ノードが重なると、`layout.js` が警告を出す。
- 辺ラベル・線幅はズームに比例する。ラベルは 10〜13px に収め、全体表示でも消さない。画面カードの見出しは
  12px 未満になるとカードの上に固定 12px で表示する（全体表示で遷移を読めるようにするため）。
- `screens[].platform` はカードのバッジに出る（`teams` → Teams、`app` / 未指定 → App、それ以外は値をそのまま表示）。
- 辺が多く入り組んだグラフ（1 画面あたり 3 本超など）は曲線が交差して読みにくくなる。
  その場合は `lanes` を使うか、`edgeStyle: "orthogonal"` を試す。

## 5. `modes.gallery`（画面イメージ）

```jsonc
"gallery": { "label": "画面イメージ", "desc": "…" }
```

`nodes` / `edges` は書かない（書いても無視され、`validate.js` が警告する）。
`screens[]` を `groups[].order` → 出現順で group ごとのブロック（格子）にまとめ、ブロックを左→右に
棚詰めする。ブロックの行数と棚の幅は、全体表示の倍率が最も大きくなる組み合わせを自動で選ぶ
（表示領域は横長なので、グループを縦に積むより横に並べるほうが大きく見える）。
画面名・グループ見出しは画面上で固定サイズの文字なので、隙間は「全体表示の想定倍率で必要な画面 px」から決め、
縮小しても文字が隣の画面やグループに重ならないようにしている（`layout.js` の `GALLERY_PX`）。

## 6. `modes.concept`（概念図）／ `modes.biz`（業務フロー）／ `modes.dfd`（データフロー）

### 6.1 `modes.concept`（概念図）／ `modes.dfd`（データフロー）

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

```jsonc
"dfd": {
  "label": "データフロー", "desc": "…",
  "nodes": [ { "id": "P1", "kind": "dfd", "variant": "proc", "code": "P1", "icon": "gear", "label": "問い合わせ登録", "sub": "…" } ],
  "edges": [ { "from": "EXT1", "to": "P1", "type": "flow", "label": "問い合わせ内容", "step": 1 } ],
  "steps": [ { "n": 1, "title": "利用者が入力する", "desc": "…" } ]
}
```

- concept: `variant` は `actor | entity | system`。ノードサイズは 240×88 固定。
- dfd は `variant` が `ext | proc | store`（外部エンティティ／プロセス／データストア）で、
  `code`（例: `P1`）を持てる。ノードサイズは 240×92 固定。`edges[].step` を使うと
  `steps[]`（`{n, title, desc}` の配列）の手順と紐づき、ビューアの DFD ステップカードから
  該当する辺だけをハイライトできる。
- 両モードとも layout.js は ELK の `layered`（左→右。折り返しなし／MULTI_EDGE 折り返しあり）と `stress` を試し、
  重なり 0 → フィットズーム（85% までを評価。それ以上は読みやすさに効かない）→ 交差 → 辺の総延長 の順で採点して選ぶ。
  折り返しは数ノードを次の段へ送って辺を図全体に回り込ませることがあるため、折り返しなしと比べて決める。
- 層の間隔は最長の辺ラベルが収まる幅（上限 200px）にする。辺ラベルは、どのノードにも重ならない線分のうち
  水平で長いものの中点に置く（合流する縦の通路に置くと隣のノードに食い込むため）。

### 6.2 `modes.biz`（業務フロー）

担当者・システムのレーンと業務フェーズの列に、作業・分岐のノードを並べて矢印で結ぶスイムレーン図。

```jsonc
"biz": {
  "label": "業務フロー", "desc": "…",
  "lanes":  [ { "id": "L_STAFF", "label": "担当者", "sub": "管理者・スタッフ" } ],   // 配列順に上→下
  "phases": [ { "id": "PH1", "label": "① 商品を登録・公開する" } ],              // 任意。配列順に左→右
  "nodes": [
    { "id": "B01", "kind": "biz", "variant": "start", "lane": "L_STAFF", "phase": "PH1",
      "label": "新商品を扱う", "sub": "任意の補足", "screen": "S05", "spec": ["§5.1"], "info": ["…"] }
  ],
  "edges": [ { "from": "B01", "to": "B02", "type": "flow", "label": "任意（分岐は はい/いいえ）" } ],
  "legend": [ { "type": "flow", "label": "業務の流れ" } ]
}
```

`lanes[]`（レーン）:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | レーンの一意 id |
| `label` | string | ○ | レーン見出し |
| `sub` | string | - | 見出しの下に小さく出す補足（例: 担当の内訳） |

`phases[]`（業務フェーズ。任意）:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | フェーズの一意 id |
| `label` | string | ○ | フェーズ見出し |

`nodes[]`（業務ノード）:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | ノードの一意 id |
| `kind` | string | - | 省略可（`biz` とみなす） |
| `variant` | string | ○ | `start`（開始）\| `end`（終了）\| `task`（人の作業）\| `system`（システムの処理）\| `decision`（分岐） |
| `lane` | string | ○ | `lanes[].id` を参照 |
| `phase` | string | `phases` があるとき○ | `phases[].id` を参照 |
| `label` | string | ○ | ノードの見出し |
| `sub` | string | - | 補足 |
| `screen` | string | - | 関連画面（`screens[].id`）。詳細パネルに表示し、クリックでその画面のプレビューを開ける |
| `spec` | string[] | - | 関連仕様書の節番号（詳細パネルに表示） |
| `info` | string[] | - | 補足情報（詳細パネルに表示） |

`edges[].type` は `flow`（実線。業務の流れ）| `weak`（破線。差し戻し・戻り）。

レイアウト（layout.js v2）:

- フェーズごとに**独立したスイムレーンのブロック**を作る。ブロックにはそのフェーズでノードを持つレーンだけを積む（空のレーンは出さない）。`phases` を省略すると全ノードを 1 ブロックにまとめる。
- ブロックは記述順に左→右・上→下の格子に詰める。列数は 1〜ブロック数を総当たりし、想定表示領域に対する全体表示の倍率が最大になる列数を採用する（フェーズ数が増えても文字が小さくなりすぎないようにするため）。
- ブロック内の各ノードの列（フェーズ内での左右位置）は、そのフェーズ内でノードが持つ最長経路の長さ順で決まる。同じ列（同じレーン・フェーズのセル）に複数ノードがあるときは縦に積む。
- 列と列の間隔（隙間）は、その隙間から出る辺のラベル幅に合わせて個別に決める（ラベルが長い隙間ほど広く取る）。
- `type: "weak"` の辺は列（層）の決定には使わない（配置後に描くだけ）。差し戻し・やり直しの矢印を `weak` にすると、主な流れが列の並びを乱さない。
- 分岐（`variant: "decision"`）から出る辺は、行き先ごとに異なる辺（上下左右）から出し、ラベルは分岐の近くに置く。
- レーン見出し欄の幅は 190px 固定。
- 辺のルートは直交（水平・垂直の折れ線）で、他ノードを避ける経路の候補から選ぶ。辺が多いレーン・フェーズでは通路が重なることがある（既知の制約は `SKILL.md` 参照）。
- 全体表示など低倍率でノード・レーン・フェーズの文字が読めなくなる縮尺では、ラスタ化した図形とは別に画面上で固定サイズ（読める最小限の px）のラベルを重ねて描く。

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
- concept ノードの `variant` が未知の値
- biz ノードの `variant` が未知の値、`lane` が `lanes[].id` に、`phase`（`phases` があるとき）が
  `phases[].id` に存在しない
- biz ノードの `screen` が `screens[].id` に存在しない（警告のみ）
- `phases` を定義したのにノードが 1 つも属さないフェーズがある（警告のみ）
- ER の `fromField` / `toField` が対応ノードの `fields[].name` に存在しない
- dfd の `edges[].step` が `steps[].n` に存在しない
- `screens[].group` / flow ノードの `group` が `groups[].id` に存在しない
- `modes.flow.layout` / `edgeStyle` / `attachSide` の未知の値、`nudge` / `attachGap` / `layoutOptions` の型違い、
  `attachTo` の未知 id・連鎖（`layout: "elk"` 以外で使うと警告）
- `screens/<ID>.html` が無い（警告のみ）
- 必須項目（`meta.title`、`screens[].id/title`、`groups[].id/label`、各ノードの `id` など）の欠落

エラーは非 0 終了。警告は表示のみで終了コードに影響しない。
