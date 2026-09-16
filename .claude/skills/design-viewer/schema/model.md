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

## 1.1 `model.json` の分割（`model/` ディレクトリ）

`model.json` が肥大化する場合は、1 ファイルの代わりに `model/` ディレクトリ配下へ複数の
`*.json` に分割できる（サブディレクトリも可）。

```
viewer-src/
  model/
    10-meta.json          ← { "meta": {…} }
    20-screens.json       ← { "screens": […] }
    25-batches.json       ← { "batches": […] }
    30-groups.json        ← { "groups": […] }
    modes/
      10-flow.json        ← { "modes": { "flow": {…} } }
      20-gallery.json     ← { "modes": { "gallery": {…} } }
      30-concept.json     ← { "modes": { "concept": {…} } }
      35-jobflow.json     ← { "modes": { "jobflow": {…} } }
      40-biz.json         ← { "modes": { "biz": {…} } }
      50-er.json          ← { "modes": { "er": {…} } }
      60-dfd.json         ← { "modes": { "dfd": {…} } }
      70-arch.json        ← { "modes": { "arch": {…} } }
```

- 入力は **`model.json` か `model/` のどちらか一方**。両方存在する場合はどちらを使うか
  曖昧なためエラーになる。
- 各ファイルの中身は「`model.json` の一部分」と同じ形のオブジェクト（トップレベルの
  キーだけを持つ部分木でよい。上記の分け方は一例で、必須の分割単位ではない）。
- 読み込み順は `model/` からの相対パスを `/` 区切りの文字列としてそのまま辞書順に
  比較した順（OS のパス区切り文字に依存しない）。**ELK.js はノード・辺の記述順を
  ある程度尊重する**ため、複数ファイルにまたがって順序を制御したい場合は、上記の例の
  ように `10-` のような数字接頭辞をファイル名に付けて明示的に順序を決める。
- マージ規則（深いマージ）:
  1. 同じキーの値が両方ともオブジェクトなら再帰的にマージする。
  2. 同じキーの値が両方とも配列なら、読み込み順で後ろに連結する（要素同士はマージしない）。
  3. それ以外の組み合わせ（片方または両方がオブジェクト・配列でない、あるいは型が
     違う）で同じキーが複数ファイルに現れた場合はエラーにする（キーのパスと関与した
     ファイル名を示す）。例えば `meta.title` を 2 つのファイルに書いたり、あるファイルで
     `modes.biz` をオブジェクト、別のファイルで文字列にしたりすると失敗する。
  4. JSON のパースに失敗したファイルは、そのファイル名付きでエラーになる。
- `screens[]` は将来画面数が増えたら、グループ別など複数ファイル（例:
  `model/screens/10-staff.json`、`model/screens/20-admin.json`）に分けられる
  （このスキルの split 実装は screens 配列を単一ファイルに限定しない。上の「配列は
  連結」の規則がそのまま使える）。
- 実装は `scripts/lib/load-model.js`（`readModel(viewerSrcDir)`）。`validate.js` /
  `layout.js` / `thumbs.js` はすべてこの共通ローダー経由で `model.json` / `model/` を読む。
- `gen-dummy.js` は従来どおり単一の `model.json` を出力する（`model/` 分割形式では出力しない。
  ローダーは `model.json` を後方互換として読めるため、そのまま使える）。

## 1. 全体構造

```jsonc
{
  "meta": { "title": "…", "subtitle": "…", "statusNote": "…（任意）", "modeOrder": ["concept", "biz", "gallery", "flow", "er", "dfd", "jobflow", "arch"] },
  "screens": [ Screen, … ],
  "batches": [ Batch, … ],
  "groups": [ Group, … ],
  "modes": {
    "concept": { "label": "概念図",     "desc": "…", "nodes": [ConceptNode], "edges": [Edge], "legend": [Legend] },
    "biz":     { "label": "業務フロー", "desc": "…", "lanes": [Lane], "phases": [Phase], "nodes": [BizNode], "edges": [Edge], "legend": [Legend] },
    "gallery": { "label": "機能一覧", "arrange": "table", "desc": "…" },
    "flow":    { "label": "画面遷移図", "desc": "…", "nodes": [FlowNode], "edges": [Edge], "legend": [Legend], "toggles": [Toggle] },
    "jobflow": { "label": "ジョブフロー", "desc": "…", "lanes": [Lane], "phases": [Phase], "nodes": [JobNode], "edges": [Edge], "legend": [Legend] },
    "er":      { "label": "ER図",       "desc": "…", "nodes": [ErNode],      "edges": [Edge], "legend": [Legend] },
    "dfd":     { "label": "データフロー", "desc": "…", "nodes": [DfdNode],     "edges": [Edge], "legend": [Legend], "steps": [Step], "arrange": "elk | steps" },
    "arch":    { "label": "構成図",     "desc": "…", "containers": [Container], "nodes": [ArchNode], "edges": [Edge], "legend": [Legend], "direction": "right | down" }
  }
}
```

- `meta.title` は必須。`subtitle` / `statusNote` は任意（`statusNote` は「作成中」等の一言を
  タイトルカードに表示する用途）。
- `modes` の 8 モードはすべて省略可。無いモードはビューアのモード切替ボタンに出ない。
- モード切替ボタンの表示名は各モードの `label`（省略時の既定名は 概念図 / 業務フロー / 機能一覧 / 画面遷移図 / ER図 / データフロー / ジョブフロー / 構成図）。
  並び順は `meta.modeOrder`（任意。モードのキーの配列）で指定でき、書かなかったモードは既定順
  （concept, biz, gallery, flow, er, dfd, jobflow, arch）で後ろに続く。数字キー 1〜n はボタンの並び順に対応する。
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
| `spec` | string[] | - | 関係する仕様書の記述の転記。1 要素 1 項目で「出典の名前: 内容」（例: `"業務ルール（在庫）: 出庫によって在庫数が 0 未満になる場合はエラーとする。"`）。節番号だけにしない（詳細パネルに表示） |
| `status` | string | - | 実装状況。`done`（実装済）\| `wip`（実装中）\| `designed`（設計済・未実装）\| `planned`（未着手）。機能一覧の表（`modes.gallery.arrange: "table"`）の列と詳細パネルのタグに出る |
| `purpose` | string | - | 画面の目的（詳細パネルに表示。機能一覧の表では「概要」列） |
| `ops` | string[] | - | 主な操作（詳細パネルに表示） |
| `reads` / `writes` | string[] | - | 読み取り／書き込みするデータ（詳細パネルに表示） |
| `notes` | string[] | - | 注意事項（詳細パネルに表示） |
| `pin` | `{x,y}` | - | このノードの最終座標を固定する（§9 参照） |
| `nudge` | `{dx,dy}` | - | `modes.flow.layout: "elk"` のとき、配置後に flow 上の位置をずらす（§4.1） |

`screens[]` に列挙した画面は、`modes.flow` があれば flow モードのノードとして、
`modes.gallery` があれば gallery モードのノードとして**自動的に**追加される
（`modes.flow.nodes` / `modes.gallery.nodes` に画面ノードを書く必要はない）。

## 2.1 `batches[]`（バッチ機能）

画面を持たない処理（定時起動・ファイル到着などのイベント起動）を 1 機能 1 件で書く。粒度は機能一覧の単位
（例: 仕様書の機能一覧の「受注データ出力（バッチ）」）。バッチを構成するジョブの順序は `modes.jobflow`（§6.4）に書く。

```jsonc
"batches": [
  { "id": "J01", "title": "受注データ出力", "schedule": "毎日 2:00", "trigger": "時刻起動", "status": "designed",
    "purpose": "前日に受注になった商談を会計システム向けの CSV に出力する。",
    "ops": ["前日に受注になった商談を抽出する", "CSV に出力する", "出力日時を記録する"],
    "reads": ["商談（stage, exported_at）"], "writes": ["商談（exported_at）", "受注データ CSV"],
    "onError": "運用担当へメールで通知する", "rerun": "再実行可（出力済みの商談は除く）",
    "spec": ["業務ルール（受注データ出力）: 出力済みの商談には出力日時を記録し、再出力しない。"], "notes": ["…"] }
]
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | バッチの一意 id（例: `J01`）。`screens[].id` と重複不可。**各モードのノード id とも重ねない**（ビューアはモードをまたいで同じ id を同じノードとみなすため、業務フローの `B01` などと重なると表示できない） |
| `title` | string | ○ | バッチ名 |
| `group` | string | - | `groups[].id` を参照。書くと機能一覧で「<グループ名>（バッチ）」のセクションに入る。省略すると「バッチ機能」のセクションにまとまる |
| `schedule` | string | 推奨 | 起動のタイミング（例: 「毎日 2:00」「毎月 1 日 3:00」「ファイル到着時」）。機能一覧の表の「利用者／起動」列・格子のカード・詳細パネルに出る |
| `trigger` | string | - | 起動条件の種類（例: 「時刻起動」「ファイル到着」「前のバッチの正常終了」） |
| `status` | string | - | 実装状況。`screens[].status` と同じ値（`done` \| `wip` \| `designed` \| `planned`） |
| `purpose` | string | - | バッチの目的（機能一覧の表では「概要」列） |
| `ops` | string[] | - | 処理の流れ（詳細パネルに番号付きで表示） |
| `reads` / `writes` | string[] | - | 読み取り／書き込みするデータ・ファイル（詳細パネルに表示） |
| `onError` | string | - | 異常時の扱い（通知先・後続を止めるかなど）。仕様書に無ければ書かず、`notes` に「未確定」と書く |
| `rerun` | string | - | 再実行の可否と手順 |
| `tasks` / `spec` / `notes` | string[] | - | `screens[]` と同じ（`spec` は「出典の名前: 転記した内容」） |

`batches[]` に列挙したバッチは、`modes.gallery` があれば機能一覧に**自動的に**追加される（§5）。
詳細パネルには、`modes.jobflow` のノードのうち `batch` がそのバッチを指すもの（ジョブ）が並び、クリックするとジョブフローへ移る。

## 3. `groups[]`（グループ／レーン）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | グループの一意 id |
| `label` | string | ○ | レーン見出しに表示するラベル |
| `order` | number | ○ | 表示順（小さい方が上／先）。flow はこの順に上から積んだ横帯（レーン）になり、
gallery はこの順に左→右（棚詰めで折り返し）のブロックとして並ぶ |

`screens[].group` と `modes.flow.nodes[].group` から参照される。
どちらのモードにも属さない（`flow` も `gallery` も無い）プロジェクトでは省略してよい。

## 4. `modes.flow`（画面遷移図）

```jsonc
"flow": {
  "label": "画面遷移図", "desc": "…",
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
- `arrange`（`layout: "elk"` のときだけ有効）: `"elk"`（既定。ELK layered に全ノードを渡す）または
  `"groups"`（ELK を使わず、グループ行＋ハブ列の決定的な格子に配置する。§4.2）。それ以外の値はエラー、
  `layout: "elk"` 以外で書くと警告になる。
- **`lanes`**: レーン（横帯）は `groups[].order` の順に上から積む。**同一レーン内は
  記述順の安定位相ソートで 1 行に並べ、レーンをまたぐ辺は後から手動の直交ルートで
  つなぐ**（`layout.js` の設計判断。詳細はスクリプト冒頭のコメントを参照）。

### 4.1 `layout: "elk"`（全体 ELK ＋ カード ＋ 曲線）

`docs/design-viewer-elk.html` と同じ見た目にする方式。レーンを作らず、全ノードを
1 回の ELK layered（左→右）で配置する。役割・チャネルの区別はカードのバッジで示す。

```jsonc
"flow": {
  "label": "画面遷移図", "layout": "elk",
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

- `group` は `arrange: "elk"`（既定）では使わない（書いてもよいが flow では無視。gallery では従来どおり使う）。
  `arrange: "groups"` では行の割り当てに使う（§4.2）。
- **`type: "weak"` の辺は層の決定に使わない**（配置後に描くだけ）。「保存後に詳細へ戻る」のような逆向きの
  遷移は `weak` にする。`user` のまま往復の辺を書くと ELK が層順を入れ替え、主な流れ（左→右）が読めなくなる。
  既定で隠したい場合は `toggles: [{ "type": "weak", "label": "戻る遷移を表示", "default": false }]`。
- ハブ型（メニューなどの入口から各機能へ放射状に分かれ、機能内に戻り・エラーの循環がある）で、
  画面数が多く（20 画面超が目安）、長い辺がカードの下を通ったり層が入れ替わって縦長になる場合は、
  ELK に全体を任せず `arrange: "groups"` ＋ `hubGroup` を使うほうが読みやすい（§4.2）。画面数が少ない
  ハブ型や循環の無いグラフでは、既定の `arrange: "elk"` のまま全画面を `pin` で格子に置く方法も使える
  （列の間隔を行の間隔より広くすると、辺が上下でなく左右から出入りしてカード見出しを避ける）。
- nudge / attachTo / pin の結果ノードが重なると、`layout.js` が警告を出す。
- 辺ラベル・線幅はズームに比例する。ラベルは 10〜13px に収め、全体表示でも消さない。画面カードの見出しは
  12px 未満になるとカードの上に固定 12px で表示する（全体表示で遷移を読めるようにするため）。
- `screens[].platform` はカードのバッジに出る（`teams` → Teams、`app` / 未指定 → App、それ以外は値をそのまま表示）。
- 辺が多く入り組んだグラフ（1 画面あたり 3 本超など）は曲線が交差して読みにくくなる。
  その場合は `lanes` を使うか、`edgeStyle: "orthogonal"` を試す。

### 4.2 `arrange: "groups"`（グループ行＋ハブ列の格子配置）

`layout: "elk"` のまま、ELK layered を使わずに決定的な格子へ配置する方式。見た目（カード・
曲線）は §4.1 と同じ。66 画面規模のハブ型（メニューから 10 機能程度へ分かれ、機能内に
戻り・エラー遷移の循環がある）を 1 回の ELK layered で解くと、循環で層が入れ替わり縦長の
塊になって読めなくなる、という問題への対処として用意した。

```jsonc
"flow": {
  "label": "画面遷移図", "layout": "elk", "arrange": "groups", "hubGroup": "g_hub",
  "edgeStyle": "curve",
  "nodes": [
    { "id": "START", "kind": "pill", "label": "アプリ起動", "attachTo": "S_LOGIN", "group": "g_hub" }
  ],
  "edges": [ … ]
}
// groups 側: [
//   { "id": "g_hub",  "label": "入口",   "order": 1 },
//   { "id": "g_a",    "label": "機能A", "order": 2 },
//   { "id": "g_b",    "label": "機能B", "order": 3 }
// ]
```

| 項目 | 説明 |
|---|---|
| `hubGroup` | 任意。`groups[].id` を 1 つ指定する。この group に属する画面・`nodes[]` は左端に横 1 列の「ハブ列」としてまとめ、格子全体の高さの中央に置く（ログイン→メニューのような入口向け）。未知の id はエラー。`arrange: "groups"` 以外で書くと警告。省略するとハブ列は作らない |
| ブロック（グループ） | `hubGroup` 以外の group は 1 つずつ「ブロック」になる。ブロックの内側は `groups[].order` の順に上から並ぶ縦の帯で、破線の枠とグループ名の見出しを描く。`group` 未設定の画面・ノードは最後のブロック「(未分類)」にまとまる |
| ブロック列（K 本） | ハブ列の右側に、ブロックを **記述順のまま K 本の縦の列に分けて左→右に並べる**（1 本の縦積みにはしない）。各列の高さがそろうように貪欲に分け、K は 1 本〜ブロック数の中から全体表示の倍率が最大になるものを自動で選ぶ（表示領域は横長なので、通常は複数列に分かれる）。列の幅は、その列にあるブロックの最大幅にする。列内では各ブロックを上から順に積む |
| 列（段）の x 位置 | ブロック内部の左右位置（後述の段）の x オフセットは、**どのブロック列に属していても同じ段番号なら同じ相対位置**になる（ブロックの左端からの相対 x が段番号だけで決まり、ブロック列をまたいでも揃う）。段自体は、**同じグループ内の画面・ノードだけを辺でたどった最長経路の段数**で決まる（同じ段の画面が縦に並ぶので「一覧 → 詳細 → 入力 → 確認 → 完了」のような段が読み取れる）。同じブロック・同じ段に複数要素があるときは `screens[]` → `modes.flow.nodes[]` の記述順に縦に積む |
| 段数の計算に使わない辺 | 次はどれも段数の計算には数えない（配置後に描くだけ）: `type` が `weak` / `nav` / `rel` の辺、`toggles` で `default: false`（既定で非表示）にした type の辺、そして `screens[]` → `modes.flow.nodes[]` の記述順で**後ろのノードから前のノードへ向かう辺**（戻り・エラー遷移はここで無視することで循環を断ち切る）。この 3 条件のどれにも当てはまらない辺だけが「前向きの辺」として段を決める |
| `attachTo` / `nudge` / `pin` | 従来どおり使える。`attachTo` は起点ノードを格子に含めず、相手ノードの横に置く。`nudge` / `pin` は格子配置のあとに適用される |
| 間隔 | `layoutOptions` は効かない（`arrange: "groups"` は ELK を使わないため）。固定値（参照 px。ワールドでは 4 倍）: ブロック列間 300・ブロック内の行間 200・同じセル内の縦間隔 90・ハブ列と格子の間 420 |
| 辺の描き方 | §4.1 と同じ。`edgeStyle: "curve"` は 3 次ベジェ、`orthogonal` は単純な直交ルート。曲線はカードを避けないので、段を飛ばす辺（例: 一覧 → 登録入力）は間のカードの上を通ることがある |

使い分けの目安:

- 画面が 20 画面程度まで、かつメニューのようなハブ型でなければ既定の `arrange: "elk"` のままでよい。
- 画面が 20 を超え、かつ入口（メニューなど）から多数の機能へ分かれるハブ型なら
  `arrange: "groups"` ＋ `hubGroup` を使う。
- 戻る遷移は `weak`、メニューへ戻る導線は `nav`、共通エラー画面への遷移は `rel` にして、
  `toggles` で既定非表示にしておくと、段数の計算にも使われず、全体表示で主な流れだけが見える。

既知の制約: ハブ列から 2 本目以降のブロック列にあるブロックへ向かう辺は、1 本目のブロック列にある
ブロックの上を横切る（ブロックは記述順に列へ振り分けられ、辺は列をまたいで直接引かれるため）。
ビューアの［近傍のみ］で選択画面の辺だけに絞ると追いやすい。

## 5. `modes.gallery`（機能一覧）

```jsonc
"gallery": { "label": "機能一覧", "arrange": "table", "desc": "…" }
```

`nodes` / `edges` は書かない（書いても無視され、`validate.js` が警告する）。画面は `screens[]`、バッチ機能は `batches[]` から自動で並ぶ
（バッチは画面のセクション・ブロックの後ろ。`batches[].group` があれば `groups[].order` 順に「<グループ名>（バッチ）」、無ければ「バッチ機能」にまとまる）。
`arrange` で並べ方を選ぶ: `"grid"`（既定。サムネイルの格子）| `"table"`（表）。

### 5.1 `arrange: "table"`（表）

1 画面 1 行の表にする。列は **画面イメージ（サムネイル）| ID | 画面名 | 概要（`purpose`）| 利用者（`role`）| 実装状況（`status`）**。
画面の概要と実装状況を一覧で確認したいときに使う。

- `groups[].order` 順に見出し行（セクション）で区切る。見出し行にはグループ名・画面数・実装状況ごとの画面数を出す。
  セクション内は `screens[]` の記述順。
- サムネイルは縦横比を保ったまま 220×150 に収める（縦長の画面は細くなる）。サムネイルは画面ノードなので、
  クリックで詳細パネル、モード切替で他のモードとの間を移動するアニメーションになる。行のサムネイル以外の場所をクリックしても同じ画面を選ぶ。
- 行の高さは、サムネイルの高さと、各列の文字を列幅で折り返した行数の大きい方。文字はズームに比例する（等倍で 14〜16px）。
- 全体表示（F）は表の幅に合わせて上端から見せる（66 画面で高さ約 12,000px になり、全体を収めると文字が読めないため）。
  列見出しはスクロールしても画面の上端に貼り付く。検索でノードに寄ると、その画面の行に寄る。
- `status` の無い画面は実装状況が空欄になる（`validate.js` が警告する）。
- `batches[]` があると、列名が **イメージ | ID | 名称 | 概要 | 利用者／起動 | 実装状況** になる。バッチの行はサムネイルの代わりに
  時計のアイコンのカード（220×120）を置き、「利用者／起動」列に `schedule` を出す。セクションの見出しは「N バッチ」と数える。

### 5.2 `arrange: "grid"`（格子。既定）

`screens[]` を `groups[].order` → 出現順で group ごとのブロック（格子）にまとめ、ブロックを左→右に
棚詰めする。ブロックの行数と棚の幅は、全体表示の倍率が最も大きくなる組み合わせを自動で選ぶ
（表示領域は横長なので、グループを縦に積むより横に並べるほうが大きく見える）。
画面名・グループ見出しは画面上で固定サイズの文字なので、隙間は「想定倍率で必要な画面 px」から決め、
文字が隣の画面やグループに重ならないようにしている（`layout.js` の `GALLERY_PX`）。ただし画面名はサムネイルが
画面上で 90px 未満になる縮尺では描かないので、想定倍率は「全体表示の倍率」と「画面名が出る倍率（90 ÷ 画面幅）」の
大きい方にする。画面数が多いとき、全体表示の倍率で隙間を決めると隙間が画面幅の半分を超えてサムネイルが小さく見えたため。
行の高さはブロック内のその行で最も高い画面に合わせる（縦長の画面が 1 枚あっても他の行を広げない）。
バッチ機能は画面と同じ 1440×900 のカード（時計のアイコン・名称・`schedule`）で、見出しの右端に「バッチ」のタグを出す。

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

- concept: `variant` は `actor | entity | system | file`（`file` は外部ファイル。CSV／帳票など、
  システムの外から入出力されるファイルを表す。人・仕組み・情報とは別の形・色・破線枠のカードで描く）。
  ノードサイズは 240×88 固定。
- dfd は `variant` が `ext | proc | store`（外部エンティティ／プロセス／データストア）で、
  `code`（例: `P1`）を持てる。ノードサイズは 240×92 固定。`edges[].step` を使うと
  `steps[]`（`{n, title, desc}` の配列）の手順と紐づき、ビューアの DFD ステップカードから
  該当する辺だけをハイライトできる。
- concept の `legend[]` は、辺の線種（`{ "type": "rel", "label": "関係" }`）に加えて
  ノード種別の凡例を `{ "variant": "actor" | "entity" | "system" | "file", "label": "…" }` の形で書ける。
  この形式を書くと、ビューアは線の見本ではなくそのノード種別のカードの形・色の見本を凡例に出す
  （例: `{ "variant": "file", "label": "外部ファイル" }`）。
- 両モードとも layout.js は ELK の `layered`（左→右。折り返しなし／MULTI_EDGE 折り返しあり）と `stress` を試し、
  重なり 0 → フィットズーム（85% までを評価。それ以上は読みやすさに効かない）→ 交差 → 辺の総延長・逆走（層の流れと
  逆向きに戻る辺の長さ。折り返しが図全体を回り込ませていないかの指標） の順で採点して選ぶ。
  折り返しは数ノードを次の段へ送って辺を図全体に回り込ませることがあるため、折り返しなしと比べて決める。
- 層の間隔は最長の辺ラベルが収まる幅＋辺ラベルと矢じりの間隔（18px。矢じりの大きさ＋余白）ぶん広げた幅
  （上限 240px）にする。辺ラベルは、どのノードにも重ならない線分のうち水平で長いものの中点付近に置く
  （終点の矢じりに食い込まないよう手前で止め、既に置いた他のラベルとも重ねない）。
- dfd は `arrange` で配置方式を選べる: `"elk"`（既定。上記の 1 枚配置）| `"steps"`（ステップ別ブロック。§6.3）。

### 6.2 `modes.biz`（業務フロー）

横軸にアクター（担当者・システム）の列、縦軸に業務内容（フェーズ）の行をとった 1 枚の表に、作業・分岐のノードを並べて
矢印で結ぶスイムレーン図。流れは上から下へ進む。

```jsonc
"biz": {
  "label": "業務フロー", "desc": "…",
  "lanes":  [ { "id": "L_STAFF", "label": "担当者", "sub": "管理者・スタッフ" } ],   // アクターの列。配列順に左→右
  "phases": [ { "id": "PH1", "label": "① 商品を登録・公開する" } ],              // 業務内容の行。任意。配列順に上→下
  "nodes": [
    { "id": "B01", "kind": "biz", "variant": "start", "lane": "L_STAFF", "phase": "PH1",
      "label": "新商品を扱う", "sub": "任意の補足", "screen": "S05", "spec": ["業務ルール（商品）: SKU は英数字とハイフンのみ、重複不可。"], "info": ["…"] }
  ],
  "edges": [ { "from": "B01", "to": "B02", "type": "flow", "label": "任意（分岐は はい/いいえ）" } ],
  "legend": [ { "type": "flow", "label": "業務の流れ" } ]
}
```

`lanes[]`（アクター。表の列）:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | アクターの一意 id |
| `label` | string | ○ | 列見出し（表の上端） |
| `sub` | string | - | 見出しの下に小さく出す補足（例: 担当の内訳）。列幅に収まらない分は省略記号で切る |

`phases[]`（業務内容。表の行。任意）:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | フェーズの一意 id |
| `label` | string | ○ | 行見出し（表の左端。欄の幅に合わせて折り返す） |

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
| `spec` | string[] | - | 関係する仕様書の記述の転記。1 要素 1 項目で「出典の名前: 内容」（例: `"業務ルール（在庫）: 出庫によって在庫数が 0 未満になる場合はエラーとする。"`）。節番号だけにしない（詳細パネルに表示） |
| `info` | string[] | - | 補足情報（詳細パネルに表示） |

`edges[].type` は `flow`（実線。業務の流れ）| `weak`（破線。差し戻し・戻り）。

レイアウト（layout.js v3）:

- **アクターを列（左→右）、フェーズを行（上→下）にした 1 枚の表**を作る。同じアクターの作業は全フェーズを通して同じ列に並ぶ。
  ノードの無いアクターも列として出す。`phases` を省略すると全ノードを見出しの無い 1 行にまとめる（行見出しの欄も出さない）。
- 行の中の各ノードの段（上下の位置）は、そのフェーズ内でノードが持つ最長経路の長さ順で決まる。同じセル（同じアクター・フェーズ・段）に
  複数ノードがあるときは横に並べる（分岐の行き先が同じアクターに複数あると列が広がる）。
- 列幅はそのアクターで最も幅の広いセル＋左右の余白 44px（最小 280px）。段の間隔は、その段から出る辺にラベルがあれば 88px、無ければ 56px。
- 見出し欄はアクター（上端）が高さ 72px、フェーズ（左端）が幅 170px。ビューアではスクロールしても画面の上端・左端に貼り付き、
  縮小して文字が収まらなくなると表の外側へ広げて描く。フェーズ見出しをクリックするとその行へ寄る。
- `type: "weak"` の辺は段の決定には使わない（配置後に描くだけ）。差し戻し・やり直しの矢印を `weak` にすると、主な流れが段の並びを乱さない。
- 辺のルートは直交（水平・垂直の折れ線）。下の段へは「真下へ直線」「段の間の横通路経由」「横に出て相手の真上から下へ」、
  上の段・同じ段へは「列の左右端の縦通路経由」「上端から出て相手の下端へ」の候補を作り、ノードとの交差 → 分岐で使用済みの出口 →
  既に引いた辺との重なり・並走（24px 未満）→ ルート長 の順に比べて選ぶ。主な流れ（`flow`）を先に引き、差し戻し（`weak`）は
  それと重ならない経路を後から選ぶ。
- フェーズをまたぐ辺も引ける（行をまたいで通路を通る）。
- 分岐（`variant: "decision"`）から出る辺は、行き先ごとに異なる辺（上下左右）から出し、ラベルは分岐の出口の近くに置く。
- 全体表示など低倍率でノードの文字が読めなくなる縮尺では、ラスタ化した図形とは別に画面上で固定サイズ（読める最小限の px）のラベルを重ねて描く。
  アクター・フェーズの見出しは 11px を下回らない。

### 6.3 `modes.dfd.arrange: "steps"`（ステップ別ブロック）

共有データストア（例: 受注テーブル）に多数のプロセスがつながる DFD を 1 枚で配置すると、長い辺が
図全体を横切り、交差とラベルの重なりで読めなくなる（実測: 29 ノード・60 辺で交差 52）。
`arrange: "steps"` は `steps[]` の 1 ステップを 1 ブロックにし、そのステップの辺だけで小さな図を描く。

```jsonc
"dfd": {
  "label": "データフロー", "arrange": "steps",
  "nodes": [ … ],
  "edges": [ { "from": "E1", "to": "P3", "type": "flow", "label": "受注の入力", "step": 4 }, … ],
  "steps": [ { "n": 4, "title": "受注を登録する", "desc": "…" } ]
}
```

| 項目 | 説明 |
|---|---|
| ブロック | `steps[]` の記述順に 1 ステップ 1 ブロック。「n. title」の見出し付きの破線枠で囲む。step の無い辺と、どの辺にも使われないノードは最後の「ステップなし」ブロックに入る |
| ノードの複製 | 複数ステップに出るノード（共有データストア・外部実体）は、ブロックごとに複製して描く（DFD の重複記号の慣習）。複製の id は `<元の id>@<ステップ番号>`、`baseId` に元の id を持つ。詳細パネルの見出しは `code`（無ければ `baseId`）を表示する |
| ブロック内の配置 | 3 列固定: 左＝外部実体（`ext`）、中＝プロセス（`proc`）、右＝データストア（`store`）。列内の並びは隣の列の重心で並べ替えて交差を減らし、各ノードは隣接ノードの重心の高さを目標に重ならないよう詰める |
| 辺 | 左右から出入りするベジェ曲線。同じ側に複数の辺が付くときは相手の位置順に散らす。ラベルは曲線上で他のラベル・ノードに重ならない位置（t = 0.5 付近から順に）に置く。列の間隔は最長ラベルの幅＋余白（200〜360px） |
| ブロックの並び | 記述順に格子へ詰める。列数は全体表示の倍率が最大になるものを自動で選ぶ |
| ビューア | 右上のステップ一覧でステップをクリック（▶ の自動再生を含む）すると、そのステップのブロックへ寄り、そのステップの辺を強調する |

- 使い分けの目安: ノードが 15 程度までで共有ストアが少なければ既定の `elk`。共有データストアに多数のプロセスが
  つながる、または辺が 30 本を超えるなら `steps`（すべての辺に `step` を付ける）。
- 同じノードが複数ブロックに出るので、検索結果に同じ名前が複数並ぶ。1 つのデータストアに書き込む処理の一覧は、
  ノードの `info` や ER図で補う。
- 列が固定なので、同じ列どうしの辺（proc → proc など）は曲線が大きく回り込む。

### 6.4 `modes.jobflow`（ジョブフロー）

バッチを構成するジョブの順序を、業務フロー（§6.2）と同じスイムレーン表で描く。レイアウト（列・行・段・辺のルート）は
業務フローとまったく同じ（`layout.js` の `layoutSwimlane` を共用）。

```jsonc
"jobflow": {
  "label": "ジョブフロー", "desc": "…",
  "lanes":  [ { "id": "JL_SYS", "label": "顧客管理システム", "sub": "バッチサーバー" }, { "id": "JL_ACC", "label": "会計システム" } ],
  "phases": [ { "id": "JP1", "label": "J01 受注データ出力（毎日 2:00）" } ],
  "nodes": [
    { "id": "J01-0", "variant": "start", "lane": "JL_SYS", "phase": "JP1", "label": "毎日 2:00 に起動", "batch": "J01" },
    { "id": "J01-1", "variant": "job", "lane": "JL_SYS", "phase": "JP1", "label": "受注商談を抽出する", "sub": "出力済みは除く", "batch": "J01",
      "spec": ["…"], "info": ["…"] },
    { "id": "J01-2", "variant": "decision", "lane": "JL_SYS", "phase": "JP1", "label": "正常終了？" }
  ],
  "edges": [
    { "from": "J01-0", "to": "J01-1", "type": "flow" },
    { "from": "J01-2", "to": "J01-3", "type": "ng", "label": "いいえ" }
  ],
  "legend": [ { "type": "flow", "label": "正常終了で次へ" }, { "type": "ng", "label": "異常終了時" }, { "type": "weak", "label": "再実行" } ]
}
```

- `lanes[]`: 処理するシステム・サーバー（外部システムを含む）。左→右。書き方は §6.2 と同じ。
- `phases[]`: バッチ（起動のタイミング）ごとの行。上→下。1 バッチ 1 行にし、見出しに `batches[].id` と `schedule` を入れると機能一覧と対応が取りやすい。
- `nodes[]` は §6.2 の `nodes[]` と同じ項目で、`screen` の代わりに `batch`（`batches[].id`。未知なら警告）を持つ。
  `batch` を書くとノードの右下にバッジを出し、詳細パネルの［関連バッチ］から機能一覧のそのバッチへ移れる。
  id は `<バッチ id>-<連番>`（例: `J01-1`）にすると、どのバッチのジョブか分かりやすい。

**機能の絞り込み**: ビューアのジョブフローでは右上に「機能で絞り込む」セレクトボックスが出る（`batch` を持つノードが 1 件以上あるとき）。

- 選択肢は「すべての機能」と、ノードの `batch` が参照するバッチ（ノードの記述順に 1 回ずつ。表示は `<id> <batches[].title>`）。
- バッチを選ぶと、表示するのは **`batch` がそのバッチのノード** と **`batch` を持たず、それらと同じ行（`phase`）にあるノード** だけ。
  辺は両端が表示されているものだけを描き、対象のノードが無い行は取り除いてその下の行を上へ詰める。全体表示（F）は詰めた表に寄る。検索・ミニマップ・［近傍のみ］も同じ範囲に絞る。
- レイアウト（layout.js）は作り直さず、ビューアが行の y 座標を詰め直すだけ（列の幅・行の高さは全バッチ分のまま）。1 バッチ 1 行（`phase`）にしておくと、絞り込んだときに余白が出ない。
- `start` / `end` のノードにも `batch` を付ける（付けないと、同じ行にそのバッチのジョブが無い場合に絞り込みから外れる）。

| `variant` | 形 | 用途 |
|---|---|---|
| `start` / `end` | 業務フローと同じ角丸（黒地 / 白地） | 起動・終了。外部システム側の受け取りを `end` で置いてもよい |
| `job` | 白地・左に緑の色帯の角丸 | 1 つのジョブ（プログラム・SQL・転送など） |
| `jobnet` | 淡緑地・二重枠、右上に「ジョブネット」 | 複数のジョブをまとめたジョブネット（中身は別の行・`info` に書く） |
| `wait` | 白地・破線枠、右上に「待ち合わせ」 | ファイル到着・先行ジョブの終了などの待ち合わせ |
| `decision` | 業務フローと同じひし形 | 終了コード・件数などによる分岐 |

`edges[].type`:

| `type` | 線 | 用途 |
|---|---|---|
| `flow` | 青の実線 | 正常終了で次のジョブへ（段の決定に使う） |
| `ng` | 赤の破線 | 異常終了時の流れ（段の決定に使う。`flow` の後に空いている経路を選ぶ） |
| `weak` | 灰の破線 | 再実行・戻り（段の決定に使わない。§6.2 と同じ） |

- 仕様書に異常時の扱いが無い場合は `ng` の辺・分岐を推測で描かず、ノードの `info` やバッチの `notes` に「未確定」と書く。

### 6.5 `modes.arch`（構成図）

AWS のようなクラウド上のシステム構成を、入れ子の枠（クラウド › VPC › アベイラビリティゾーン › サブネット）に
サービスを置いて描く。枠は `containers[]`、その中に置くものは `nodes[]` で、`nodes[].container` で所属を指す。
**枠の入れ子は `containers[].parent` だけで決まり、座標は書かない**（ELK の階層レイアウトが枠の中と外をまとめて解く）。

```jsonc
"arch": {
  "label": "構成図", "desc": "…",
  "containers": [
    { "id": "AWS",  "kind": "cloud",           "label": "AWS アカウント", "sub": "ap-northeast-1" },
    { "id": "VPC",  "kind": "vpc",  "parent": "AWS", "label": "VPC", "sub": "10.0.0.0/16" },
    { "id": "AZ1",  "kind": "az",   "parent": "VPC", "label": "アベイラビリティゾーン a" },
    { "id": "PUB1", "kind": "subnet-public",  "parent": "AZ1", "label": "パブリックサブネット", "sub": "10.0.1.0/24" },
    { "id": "PRI1", "kind": "subnet-private", "parent": "AZ1", "label": "プライベートサブネット", "sub": "10.0.11.0/24" }
  ],
  "nodes": [
    { "id": "USER", "variant": "ext", "icon": "user", "label": "利用者", "sub": "社内 PC のブラウザ" },
    { "id": "ALB",  "variant": "service", "container": "PUB1", "icon": "lb",
      "service": "Elastic Load Balancing（ALB）", "label": "ロードバランサー", "sub": "HTTPS 443",
      "info": ["2 つの AZ に振り分ける。"], "spec": ["（非機能要件）: …"], "notes": ["…"] },
    { "id": "APP",  "variant": "compute", "container": "PRI1", "icon": "srv",
      "service": "Amazon ECS on AWS Fargate", "label": "アプリケーション" },
    { "id": "DB",   "variant": "store", "container": "PRI1", "icon": "db",
      "service": "Amazon RDS for PostgreSQL", "label": "業務データベース" }
  ],
  "edges": [
    { "from": "USER", "to": "ALB", "type": "flow", "label": "HTTPS" },
    { "from": "APP",  "to": "DB",  "type": "flow", "label": "SQL" }
  ],
  "legend": [ { "type": "flow", "label": "通信" }, { "type": "system", "label": "非同期・連携" } ]
}
```

`containers[]`:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | 枠の一意 id。`nodes[].id` と重複させない（エラー） |
| `label` | string | 推奨 | 枠の名前（見出しの札に出る） |
| `sub` | string | - | 補足（リージョン名・CIDR など。札の名前の右に小さく出る） |
| `kind` | string | - | 枠の種類。色・線種が変わる。既定 `group` |
| `parent` | string | - | 外側の枠の `id`。省略すると一番外側（循環・自分自身はエラー） |
| `info` | string[] | - | 補足（現在はビューアに出さない。将来の枠の詳細表示用） |

`kind` の集合（左が外側で使うものの目安）:

| `kind` | 枠線 | 用途 |
|---|---|---|
| `cloud` | 橙の実線 | クラウド全体・アカウント |
| `region` | 青の破線 | リージョン |
| `vpc` | 紫の実線 | VPC |
| `az` | 灰の破線 | アベイラビリティゾーン |
| `subnet-public` | 緑の実線 | パブリックサブネット |
| `subnet-private` | 青の実線 | プライベートサブネット |
| `onprem` | 茶の実線 | オンプレミス・社内ネットワーク |
| `group` | 灰の破線（既定） | その他のまとまり（外部サービス群など） |

`nodes[]`:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ○ | ノードの一意 id |
| `label` | string | ○ | 図に描く名前（役割で書く。例: 「ロードバランサー」） |
| `variant` | string | - | `service`（マネージドサービス。紫）\| `compute`（サーバー・コンテナ・関数。橙）\| `store`（DB・ストレージ。緑）\| `ext`（利用者・外部システム。灰の破線）。既定 `service` |
| `container` | string | - | 置く枠の `id`。省略すると枠の外（利用者・外部システム向け） |
| `service` | string | - | 製品・サービス名（例: `Amazon ECS on AWS Fargate`）。カードの名前の下と詳細パネルに出る |
| `sub` | string | - | 補足（ポート・台数・インスタンスタイプなど） |
| `icon` | string | - | §10 のアイコン名。構成図向けに `cloud lb srv func bucket queue cdn fw key monitor net` がある |
| `info` / `spec` / `notes` | string[] | - | 詳細パネルの「説明」「仕様」「注意」 |
| `pin` | `{x,y}` | - | 座標の固定（§9。枠の外に出てしまうので、ふつうは使わない） |

- 辺（`edges[]`）は §8 の共通形式。構成図では `flow`（通信・同期呼び出し。青の実線）と `system`（非同期・ファイル連携。紫の破線）、
  `rel`（参照・管理関係。灰の実線）を使い分ける。**枠（`containers[].id`）を辺の端点にはできない**（エラー）。
- `type: "weak"`（灰の破線）の辺は**層（左→右の段）の決定に使わない**。NAT ゲートウェイの経由のような
  「流れではないつながり」を `weak` にすると、その辺のせいで枠の並びが実際の構成と逆になる（パブリックサブネットが
  プライベートサブネットの右に来るなど）のを防げる。配置のあとに直線的な直交ルートで結ぶだけなので、
  ほかのノード・枠を横切ることがある（業務フローの `weak` と同じ考え方。§6.2）。
- `legend[]` は辺の線種（`{ "type": "flow", "label": "通信" }`）に加えて、ノードの種別を
  `{ "variant": "service" | "compute" | "store" | "ext", "label": "…" }` の形で書ける
  （カードの色の見本が出る。色が何を表すかは凡例が無いと伝わらないので書いておく）。
- `direction`（任意）: 層の進む向き。`right`（左→右）\| `down`（上→下）。**省略を推奨** — 省略すると両方を試し、
  枠を含めた全体が大きく収まる方（＝文字が読める方）を自動で選ぶ。
- 図の読みやすさは枠の入れ子の深さと辺の本数で決まる。AZ をまたぐ冗長構成は、AZ ごとの枠に同じ役割のノードを
  並べて書く（`ALB-A` / `ALB-C` のように id を分ける）。ノードは 40 個程度までを目安にし、
  それ以上になるならサブシステムごとに分ける。
- **仕様書に無い構成を描かない。** 冗長化・バックアップ・監視などが仕様書に書かれていなければ、推測でノードを足さず
  `notes` や `meta.statusNote` に「未確定」と書く。

## 7. `modes.er`（ER図）

```jsonc
"er": {
  "label": "ER図", "desc": "…",
  "nodes": [
    { "id": "T_CUSTOMER", "kind": "er", "tone": "blue", "label": "顧客", "sub": "fc_Customer", "info": ["…"],
      "fields": [
        { "label": "顧客ID", "name": "id", "type": "int", "key": "PK", "note": "主キー" },
        { "label": "顧客名", "name": "name", "type": "string", "key": "", "note": "" }
      ] }
  ],
  "edges": [
    { "from": "T_ORDER", "to": "T_CUSTOMER", "type": "rel", "fromField": "customer_id", "toField": "id", "label": "" }
  ]
}
```

- `tone` は `blue | amber | green | slate | purple | teal`（ヘッダー色）。
- **論理名と物理名**: テーブルも列も両方を持たせる。

  | | 論理名 | 物理名 |
  | --- | --- | --- |
  | テーブル | `nodes[].label`（例: `顧客`） | `nodes[].sub`（例: `fc_Customer`） |
  | 列 | `fields[].label`（例: `顧客ID`） | `fields[].name`（例: `id`） |

  **ER 図（キャンバス）に描くのは論理名**（テーブルは `label` を大きく・`sub` を
  その下に小さく、列は `label` だけ）。物理名は詳細パネルの「列」表に
  キー｜論理名｜物理名｜型｜備考 の形で出る。
  `fields[].label` を省いた列は ER 図に物理名（`name`）がそのまま出る（`validate.js` が警告）。
- `fields[].name`（物理名）は必須で、テーブル内で一意にする。辺の `fromField` / `toField`
  が参照するのはこの**物理名**で、論理名ではない。
- `fields[].key` は `PK | FK | UK | ""`（バッジ表示に使う。`""` または省略でバッジ無し）。
- `fromField` / `toField` を指定すると、その行の左右中央（`y = 56 + 30×行番号 + 15`）に
  ELK の固定位置ポートを作り、そこに辺を接続する（**必ず `fromField`/`toField` は対応する
  ノードの `fields[].name`（物理名）と一致させること**。一致しないと `validate.js` がエラーにする）。
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
{ "from": "…", "to": "…", "label": "…", "type": "user|system|nav|start|rel|weak|flow|ng",   // ng は jobflow のみ
  "fromField": "…", "toField": "…",     // er のみ。列の**物理名**（fields[].name）で書く
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

`icon` に指定できる名前は固定集合:
`chat bell team cal bot apps search inbox doc check tag user flow db spark shield gear plus back list send warn clock`

構成図（§6.5）向けに次のアイコンも使える（AWS 公式アイコンではなく、他と同じ線画で描いた汎用の記号）:
`cloud`（クラウド）`lb`（ロードバランサー）`srv`（サーバー・コンテナ）`func`（関数・イベント処理）
`bucket`（オブジェクトストレージ）`queue`（キュー・メッセージ）`cdn`（CDN・インターネット）`fw`（ファイアウォール・WAF）
`key`（鍵・シークレット）`monitor`（監視・メトリクス）`net`（ネットワーク・ルーティング）

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
      "label": "画面遷移図",
      "nodes": [ { "id": "START", "label": "起動", "group": "g1" } ],
      "edges": [
        { "from": "START", "to": "S01", "type": "start" },
        { "from": "S01", "to": "S02", "type": "user", "label": "行を選択" }
      ]
    },
    "gallery": { "label": "機能一覧" }
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
- jobflow も biz と同じ検査（`variant` は `start | end | job | jobnet | wait | decision`、辺の `type` は `flow | ng | weak`）。
  ノードの `batch` が `batches[].id` に存在しない（警告のみ）
- `batches` の id の欠落・重複、`screens` の id との重複、各モードのノード id との重複、`group` が `groups[].id` に存在しない（エラー）。
  `status` の未知の値、`schedule` の欠落、`arrange: "table"` で `status` の無いバッチ（警告）
- `phases` を定義したのにノードが 1 つも属さないフェーズがある（警告のみ。行は高さ 110px の空行として出る）
- ER の `fromField` / `toField` が対応ノードの `fields[].name`（物理名）に存在しない
- ER の `fields[].name`（物理名）が無い（エラー）、`fields[].label`（論理名）が無い（警告）
- dfd の `edges[].step` が `steps[].n` に存在しない
- `modes.gallery.arrange` の未知の値（エラー）、`screens[].status` の未知の値（警告）、`arrange: "table"` で `status` の無い画面がある（警告）
- `modes.dfd.arrange` の未知の値、`arrange: "steps"` なのに `steps` が無い（エラー）、`arrange: "steps"` で step の無い辺がある（警告）
- `screens[].group` / flow ノードの `group` が `groups[].id` に存在しない
- `modes.flow.layout` / `edgeStyle` / `arrange` / `attachSide` の未知の値、`nudge` / `attachGap` / `layoutOptions` の型違い、
  `attachTo` の未知 id・連鎖（`layout: "elk"` 以外で使うと警告）
- `modes.flow.hubGroup` が未知の group を参照している（エラー）、`arrange: "groups"` 以外で使っている（警告）
- arch の `containers` の id の欠落・重複、`parent` の未知参照・自分自身・循環、`nodes[].container` の未知参照、
  ノード id と枠 id の重複、枠を端点にした辺、`direction` の未知の値（エラー）。
  `kind` / `variant` / `icon` の未知の値、`label` の欠落（警告）
- `screens/<ID>.html` が無い（警告のみ）
- 必須項目（`meta.title`、`screens[].id/title`、`groups[].id/label`、各ノードの `id` など）の欠落

エラーは非 0 終了。警告は表示のみで終了コードに影響しない。
