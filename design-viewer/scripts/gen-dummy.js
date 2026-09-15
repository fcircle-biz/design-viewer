#!/usr/bin/env node
/**
 * design-viewer / gen-dummy.js
 *
 * 負荷試験用のダミー viewer-src（model.json + screens/*.html）をシード固定で生成する。
 * 規模: 画面 100（group 5）・concept 60・ER 50 テーブル（各 8〜20 列・FK 辺 70 本程度）・
 *       dfd 80・辺（flow 180 本・concept 120 本・dfd 200 本）
 *
 * 単体実行: node gen-dummy.js <出力先 viewer-src フォルダー>
 * モジュール利用: const { genDummy } = require('./gen-dummy');
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- 決定的な擬似乱数（mulberry32） ----------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function randInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }

function hslFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 62% 55%)`;
}

function genDummy(outDir) {
  const rng = makeRng(20260915);
  const screensDir = path.join(outDir, 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  // ---------- groups ----------
  const GROUP_COUNT = 5;
  const groups = Array.from({ length: GROUP_COUNT }, (_, i) => ({
    id: `G${i + 1}`, label: `ダミーグループ ${i + 1} — 負荷試験用`, order: i + 1,
  }));

  // ---------- screens ----------
  const SCREEN_COUNT = 100;
  const platforms = ['app', 'teams'];
  const roles = ['担当者', '管理者', '利用者'];
  const screens = [];
  for (let i = 1; i <= SCREEN_COUNT; i++) {
    const id = `S${String(i).padStart(3, '0')}`;
    const group = groups[(i - 1) % GROUP_COUNT].id;
    screens.push({
      id, title: `ダミー画面 ${String(i).padStart(3, '0')}`,
      platform: pick(rng, platforms), role: pick(rng, roles), group,
      w: 1440, h: 900,
      tasks: [`TASK-${i}`], spec: [`§dummy.${i}`],
      purpose: `負荷試験用のダミー画面 ${id} の目的説明。`,
      ops: ['操作 A を行う', '操作 B を行う'],
      reads: [`Table${(i % 7) + 1}`],
      writes: i % 3 === 0 ? [`Table${(i % 7) + 1}`] : [],
      notes: [],
    });
  }

  // ---------- screens/*.html ----------
  fs.writeFileSync(path.join(screensDir, '_shared.css'), `
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI","Yu Gothic UI","Hiragino Sans","Meiryo",system-ui,sans-serif; }
.dummy-shell { display: flex; align-items: center; justify-content: center; flex-direction: column; height: 100vh; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.35); }
.dummy-shell h1 { font-size: 28px; margin: 0 0 8px; }
.dummy-shell p { font-size: 14px; opacity: .85; margin: 0; }
`.trim() + '\n');
  screens.forEach(s => {
    const color = hslFor(s.id);
    const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>${s.title}</title>
<link rel="stylesheet" href="_shared.css">
</head>
<body style="background:${color}">
<div class="dummy-shell">
  <h1>${s.id}</h1>
  <p>${s.title}</p>
</div>
</body></html>
`;
    fs.writeFileSync(path.join(screensDir, `${s.id}.html`), html);
  });

  // ---------- modes.flow ----------
  const flowNodes = [{ id: 'START', kind: 'pill', label: 'アプリ起動', sub: 'ダミーの起点ノード', group: groups[0].id }];
  const flowEdges = [];
  flowEdges.push({ from: 'START', to: 'S001', type: 'start', label: '起動' });
  // 同一グループ内の連鎖（到達性の保証）
  for (let g = 0; g < GROUP_COUNT; g++) {
    const members = screens.filter(s => s.group === groups[g].id);
    for (let i = 0; i < members.length - 1; i++) {
      flowEdges.push({ from: members[i].id, to: members[i + 1].id, type: 'user', label: `${i % 4 === 0 ? '次へ' : ''}` });
    }
  }
  // 残りはランダム（レーンをまたぐ辺を意図的に多めに混ぜる）
  const edgeTypes = ['user', 'system', 'nav', 'weak'];
  while (flowEdges.length < 180) {
    const a = pick(rng, screens), b = pick(rng, screens);
    if (a.id === b.id) continue;
    flowEdges.push({ from: a.id, to: b.id, type: pick(rng, edgeTypes), label: rng() < 0.5 ? '遷移' : '' });
  }

  // ---------- modes.concept ----------
  const CONCEPT_COUNT = 60;
  const variants = ['actor', 'entity', 'system'];
  const icons = ['user', 'team', 'db', 'apps', 'gear', 'flow'];
  const conceptNodes = Array.from({ length: CONCEPT_COUNT }, (_, i) => ({
    id: `C${String(i + 1).padStart(2, '0')}`, kind: 'concept', variant: variants[i % variants.length],
    icon: pick(rng, icons), label: `概念 ${i + 1}`, sub: `ダミー概念ノード ${i + 1}`,
    info: [`補足情報 ${i + 1}`],
  }));
  const conceptEdges = [];
  for (let i = 0; i < CONCEPT_COUNT - 1; i++) conceptEdges.push({ from: conceptNodes[i].id, to: conceptNodes[i + 1].id, type: 'rel', label: '' });
  while (conceptEdges.length < 120) {
    const a = pick(rng, conceptNodes), b = pick(rng, conceptNodes);
    if (a.id === b.id) continue;
    conceptEdges.push({ from: a.id, to: b.id, type: pick(rng, ['rel', 'weak']), label: rng() < 0.3 ? '関連' : '' });
  }

  // ---------- modes.er ----------
  const TABLE_COUNT = 50;
  const tones = ['blue', 'amber', 'green', 'slate', 'purple', 'teal'];
  const fieldTypes = ['string', 'int', 'decimal', 'datetime', 'boolean'];
  const erNodesById = new Map();
  const erNodes = Array.from({ length: TABLE_COUNT }, (_, i) => {
    const id = `T${String(i + 1).padStart(2, '0')}`;
    const n = { id, kind: 'er', tone: tones[i % tones.length], label: `テーブル${i + 1}`, sub: `dummy_table_${i + 1}`, info: [], fields: [{ name: 'id', type: 'int', key: 'PK', note: '主キー' }] };
    erNodesById.set(id, n);
    return n;
  });
  const erEdges = [];
  const FK_COUNT = 70;
  for (let i = 0; i < FK_COUNT; i++) {
    const fromNode = pick(rng, erNodes);
    let toNode = pick(rng, erNodes);
    if (toNode.id === fromNode.id) toNode = erNodes[(erNodes.indexOf(fromNode) + 1) % erNodes.length];
    const fieldName = `${toNode.sub}_ref${i}_id`;
    fromNode.fields.push({ name: fieldName, type: 'int', key: 'FK', note: `${toNode.label} への参照` });
    erEdges.push({ from: fromNode.id, to: toNode.id, type: 'rel', label: '', fromField: fieldName, toField: 'id' });
  }
  // 8〜20 列になるよう一般列で埋める
  erNodes.forEach((n, i) => {
    const target = 8 + ((i * 7) % 13); // 8..20 の決定的な分布
    let k = 1;
    while (n.fields.length < target) {
      n.fields.push({ name: `col_${k}`, type: fieldTypes[k % fieldTypes.length], key: '', note: '' });
      k++;
    }
  });

  // ---------- modes.dfd ----------
  const DFD_COUNT = 80;
  const dfdVariants = ['ext', 'proc', 'store'];
  const dfdNodes = Array.from({ length: DFD_COUNT }, (_, i) => ({
    id: `D${String(i + 1).padStart(2, '0')}`, kind: 'dfd', variant: dfdVariants[i % dfdVariants.length],
    code: `D-${i + 1}`, icon: pick(rng, icons), label: `DFD ${i + 1}`, sub: 'ダミー DFD ノード', info: [],
  }));
  const steps = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, title: `手順 ${i + 1}`, desc: `ダミー手順 ${i + 1} の説明。` }));
  const dfdEdges = [];
  for (let i = 0; i < DFD_COUNT - 1; i++) dfdEdges.push({ from: dfdNodes[i].id, to: dfdNodes[i + 1].id, type: 'flow', label: '', step: (i % 8) + 1 });
  while (dfdEdges.length < 200) {
    const a = pick(rng, dfdNodes), b = pick(rng, dfdNodes);
    if (a.id === b.id) continue;
    dfdEdges.push({ from: a.id, to: b.id, type: 'flow', label: rng() < 0.2 ? 'データ' : '', step: rng() < 0.5 ? randInt(rng, 1, 8) : undefined });
  }

  const model = {
    meta: { title: 'design-viewer ダミー負荷試験モデル', subtitle: 'gen-dummy.js が生成（シード固定）', statusNote: 'これはテスト用の自動生成データです。' },
    screens,
    groups,
    modes: {
      flow: { label: '画面遷移', desc: 'ダミー画面遷移。', nodes: flowNodes, edges: flowEdges, legend: edgeTypes.map(t => ({ type: t, label: t })).concat([{ type: 'start', label: 'start' }]), toggles: [{ type: 'nav', label: '左ナビの移動を表示', default: false }] },
      gallery: { label: '画面イメージ', desc: 'ダミー画面のギャラリー。' },
      concept: { label: '概念図', desc: 'ダミー概念図。', nodes: conceptNodes, edges: conceptEdges, legend: [{ type: 'rel', label: '関連' }, { type: 'weak', label: '弱い関連' }] },
      er: { label: 'ER 図', desc: 'ダミー ER 図。', nodes: erNodes, edges: erEdges, legend: [{ type: 'rel', label: 'FK 参照' }] },
      dfd: { label: 'データフロー', desc: 'ダミー DFD。', nodes: dfdNodes, edges: dfdEdges, legend: [{ type: 'flow', label: 'データフロー' }], steps },
    },
  };

  fs.writeFileSync(path.join(outDir, 'model.json'), JSON.stringify(model, null, 2), 'utf8');
  return {
    screens: screens.length, flowEdges: flowEdges.length, conceptNodes: conceptNodes.length, conceptEdges: conceptEdges.length,
    erNodes: erNodes.length, erEdges: erEdges.length, dfdNodes: dfdNodes.length, dfdEdges: dfdEdges.length,
  };
}

module.exports = { genDummy };

if (require.main === module) {
  const outArg = process.argv[2];
  if (!outArg) {
    console.error('使い方: node gen-dummy.js <出力先 viewer-src フォルダー>');
    process.exit(2);
  }
  const outDir = path.resolve(outArg);
  const stats = genDummy(outDir);
  console.log('[gen-dummy] 生成完了:', outDir);
  console.log('[gen-dummy]', stats);
}
