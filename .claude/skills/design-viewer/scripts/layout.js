#!/usr/bin/env node
/**
 * design-viewer / layout.js
 *
 * model.json から各モードの座標・辺ルートを ELK.js（vendor 同梱）で計算し、
 * 中間 JSON <out>/.layout.json を書き出す（viewer-data.js の modes 部分の元データ）。
 *
 * 単体実行: node layout.js <viewer-src> <out>
 * モジュール利用: const { computeLayout } = require('./layout');
 *
 * レイアウト方針は ../schema/model.md と CONTRACT の §4 を参照。要点:
 * - flow: レーン（groups の順に上から積む横帯）ごとに、model 順の安定位相ソート + 単一行
 *   （6 件超で折り返し）で決定的に配置し（placeLaneRow）、レーンを縦に積んでからレーンを
 *   またぐ辺だけ手動で直交ルートを引く（下記「設計判断」参照）。
 * - flow（layout: "elk"）: レーンを作らず全ノードを 1 回の ELK layered(RIGHT) で配置し、
 *   画面はカード（見出し＋サムネイル）、辺は 3 次ベジェ曲線にする（layoutFlowElk）。
 * - gallery: ELK 不要。group 順・screens 順の格子。
 * - concept / dfd: ELK layered(RIGHT・wrapping) と stress を両方試し、フィットズーム最大
 *   （重なり 0 件必須）→ 交差最小 → 総エッジ長最小の複合スコアで採用する方を選ぶ。
 * - er: ELK layered(RIGHT)。FK 辺は行位置に固定した FIXED_POS ポートで接続。
 *
 * 設計判断（flow のレーン内・レーン間の辺）:
 * 当初はレーン内も ELK layered(RIGHT) の自動配置に任せていたが、辺の少ないノードを
 * ELK が縦に積んでしまい（同じ列に複数ノード）、レーンが不必要に縦長になる問題があった
 * （実データで S03/S06、S07/S08 が縦に積まれるなど）。model の記述順を尊重した読みやすさを
 * 優先し、レーン内は自前の安定位相ソート + 単一行配置に切り替えた。隣接ノード同士は直線、
 * それ以外（スキップ・逆行）はレーン下端のブリッジ帯を列間の空きチャンネル経由で通す
 * 直交ルートにすることで、他の画面ノードを横切らないことを保証している。
 * レーンをまたぐ辺も同様に手動の直交ルート（3 セグメント・同一 (始点レーン,終点レーン)
 * ペアごとにブリッジ Y をずらす）。全体を 1 回の ELK 階層レイアウトで解く方式（§4 が許容する
 * もう一方の案）より実装・検証の堅牢性を優先した。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readModel, validateModel } = require('./validate');
const ELK = require('./vendor/elk.bundled.js');

// ---------- 定数 ----------
const DEFAULT_SCREEN_W = 1440;
const DEFAULT_SCREEN_H = 900;
const PILL_W = 360, PILL_H = 110;
const CONCEPT_W = 240, CONCEPT_H = 88;
const DFD_W = 240, DFD_H = 92;
const ER_W = 420, ER_HEADER = 56, ER_ROW = 30;

const EDGE_COLORS_KNOWN = new Set(['user', 'system', 'nav', 'start', 'rel', 'weak', 'flow']);

// ---------- 小さな幾何ヘルパー ----------
function estimateLabelSize(text) {
  const t = text || '';
  return { width: t.length * 12 + 16, height: 22 };
}

function rectBoundary(rect, side) {
  // side: 'top'|'bottom'|'left'|'right' に対する既定（中心）アンカー点
  switch (side) {
    case 'top': return { x: rect.x + rect.w / 2, y: rect.y };
    case 'bottom': return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case 'left': return { x: rect.x, y: rect.y + rect.h / 2 };
    case 'right': return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    default: return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }
}

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 0.01 || Math.abs(last[1] - p[1]) > 0.01) out.push(p);
  }
  return out;
}

/** 2 つの矩形の間を単純な直交（L字/直線）ルートでつなぐ（pin 後の再ルート用） */
function simpleOrthogonalRoute(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let start, end;
  if (Math.abs(ac.y - bc.y) >= Math.abs(ac.x - bc.x)) {
    // 縦方向の距離が大きい → 上下の辺で接続
    start = rectBoundary(a, bc.y >= ac.y ? 'bottom' : 'top');
    end = rectBoundary(b, bc.y >= ac.y ? 'top' : 'bottom');
  } else {
    start = rectBoundary(a, bc.x >= ac.x ? 'right' : 'left');
    end = rectBoundary(b, bc.x >= ac.x ? 'left' : 'right');
  }
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const pts = Math.abs(start.x - end.x) > Math.abs(start.y - end.y)
    ? [[start.x, start.y], [midX, start.y], [midX, end.y], [end.x, end.y]]
    : [[start.x, start.y], [start.x, midY], [end.x, midY], [end.x, end.y]];
  return dedupePoints(pts);
}

// ---------- ELK 呼び出し ----------
const elk = new ELK();
async function runElk(graph) {
  return elk.layout(graph);
}

/** edge.sections[0] を [[x,y],...] のフラットな折れ線に変換する */
function flattenSection(section) {
  if (!section) return null;
  const pts = [[section.startPoint.x, section.startPoint.y]];
  (section.bendPoints || []).forEach(p => pts.push([p.x, p.y]));
  pts.push([section.endPoint.x, section.endPoint.y]);
  return dedupePoints(pts);
}

function labelCenterFromElk(elkEdge, fallbackRoute) {
  const lbl = elkEdge.labels && elkEdge.labels[0];
  if (lbl && Number.isFinite(lbl.x) && Number.isFinite(lbl.y)) {
    return [lbl.x + (lbl.width || 0) / 2, lbl.y + (lbl.height || 0) / 2];
  }
  if (fallbackRoute && fallbackRoute.length > 0) {
    return midpointAlongRoute(fallbackRoute);
  }
  return undefined;
}

// ---------- 交差カウント（concept / dfd の layered vs stress 比較用） ----------
function segmentsIntersect(p1, p2, p3, p4) {
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}
/** ノード矩形の重なり件数（stress レイアウトはノード重なりを回避しないことがあるため使う） */
function countOverlaps(posMap) {
  const rects = [...posMap.values()];
  let n = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) n++;
    }
  }
  return n;
}

function countCrossings(nodesById, edges) {
  const segs = [];
  for (const e of edges) {
    const a = nodesById.get(e.from), b = nodesById.get(e.to);
    if (!a || !b) continue;
    segs.push({ from: e.from, to: e.to, p1: [a.x + a.w / 2, a.y + a.h / 2], p2: [b.x + b.w / 2, b.y + b.h / 2] });
  }
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i], s2 = segs[j];
      if (s1.from === s2.from || s1.from === s2.to || s1.to === s2.from || s1.to === s2.to) continue;
      if (segmentsIntersect(s1.p1, s1.p2, s2.p1, s2.p2)) count++;
    }
  }
  return count;
}

function totalEdgeLength(posMap, edges) {
  let total = 0;
  edges.forEach(e => {
    const a = posMap.get(e.from), b = posMap.get(e.to);
    if (!a || !b) return;
    total += Math.hypot((a.x + a.w / 2) - (b.x + b.w / 2), (a.y + a.h / 2) - (b.y + b.h / 2));
  });
  return total;
}

function boundsOfPosMap(posMap) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  posMap.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); });
  if (!Number.isFinite(minX)) return { w: 1, h: 1 };
  return { w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

// concept/dfd の「読みやすさ」目標: 1480x640 のカード込みビューポートで、どれだけ大きく
// フィットできるか（ズーム倍率）。大きいほど良い。
const FIT_W = 1480, FIT_H = 640;
function fitZoom(bounds) { return Math.min(FIT_W / Math.max(bounds.w, 1), FIT_H / Math.max(bounds.h, 1)); }

/**
 * layered/stress の比較スコア（小さいほど良い）。優先順位:
 * 1) 重なり 0 件必須（重なりがあれば桁違いのペナルティ）
 * 2) フィットズームが大きい（1480x640 に収まる大きさで読みやすい）
 * 3) 交差が少ない
 * 4) 総エッジ長が短い（僅かなタイブレーク）
 */
function scoreCandidate(posMap, edgesIn) {
  const overlaps = countOverlaps(posMap);
  const crossings = countCrossings(posMap, edgesIn);
  const length = totalEdgeLength(posMap, edgesIn);
  const bounds = boundsOfPosMap(posMap);
  const fit = fitZoom(bounds);
  const score = overlaps * 1e6 + (2 - Math.min(fit, 2)) * 2000 + crossings * 10 + length / 500;
  return { overlaps, crossings, length, fit, bounds, score };
}

/** ルート（折れ線）の弧長中点。ラベル配置に使う（ELK のラベル位置が無い場合のフォールバック）。 */
function midpointAlongRoute(route) {
  if (!route || route.length === 0) return undefined;
  if (route.length === 1) return [route[0][0], route[0][1]];
  const segLens = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const d = Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
    segLens.push(d); total += d;
  }
  if (total === 0) return [route[0][0], route[0][1]];
  const target = total / 2;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const t = segLens[i] === 0 ? 0 : (target - acc) / segLens[i];
      return [route[i][0] + (route[i + 1][0] - route[i][0]) * t, route[i][1] + (route[i + 1][1] - route[i][1]) * t];
    }
    acc += segLens[i];
  }
  return [route[route.length - 1][0], route[route.length - 1][1]];
}

/**
 * レーン内ノードの安定位相ソート。入次数 0 のノードを元の順序（screens/nodes の出現順）
 * 優先で選び続ける。閉路が残った場合は残りの中で元の順序が最小のものを強制的に選ぶ
 * （model.json の記述順を最大限尊重しつつ、必ず全ノードを並べ切る）。
 */
function topoOrderStable(ids, edges) {
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const adj = new Map(ids.map(id => [id, []]));
  const indeg = new Map(ids.map(id => [id, 0]));
  edges.forEach(e => {
    if (adj.has(e.from) && indeg.has(e.to) && e.from !== e.to) {
      adj.get(e.from).push(e.to);
      indeg.set(e.to, indeg.get(e.to) + 1);
    }
  });
  const remaining = new Set(ids);
  const result = [];
  while (remaining.size > 0) {
    let pick = null, bestIdx = Infinity;
    for (const id of remaining) {
      if (indeg.get(id) === 0 && indexOf.get(id) < bestIdx) { pick = id; bestIdx = indexOf.get(id); }
    }
    if (pick === null) {
      for (const id of remaining) { if (indexOf.get(id) < bestIdx) { pick = id; bestIdx = indexOf.get(id); } }
    }
    result.push(pick);
    remaining.delete(pick);
    (adj.get(pick) || []).forEach(t => { if (remaining.has(t)) indeg.set(t, indeg.get(t) - 1); });
  }
  return result;
}

/**
 * flow のレーン内配置（fix #2/#3）: ELK には頼らず、model 順に基づく安定位相ソートで
 * 1 行（最大 6 件を超えたら折り返し）に並べる。隣接ノード同士は直線、それ以外（スキップ・
 * 逆行・行またぎ）はレーン下端より下の「ブリッジ帯」を通す直交ルートにする。ブリッジへの
 * 出入りは列と列の間の空きチャンネル（どの行にもノードが無い縦の隙間）を通るため、
 * 他のノード（画面）を絶対に横切らない。
 * ヘッダー帯（グループ見出し用の余白）は上 130px・左 0px起点（gap 自体が左余白を兼ねる）。
 */
function placeLaneRow(memberIds, nodeMeta, laneEdges) {
  const order = topoOrderStable(memberIds, laneEdges);
  const ROW_MAX = 6;
  const GAP_X = 260, GAP_Y = 200, HEADER_OFFSET = 130, HOP = 24, LOOP_MARGIN = 70, BOTTOM_PAD = 40;
  let cellW = 1, cellH = 1;
  order.forEach(id => { const m = nodeMeta.get(id); cellW = Math.max(cellW, m.w); cellH = Math.max(cellH, m.h); });
  const rows = Math.max(1, Math.ceil(order.length / ROW_MAX));

  const posMap = new Map();
  order.forEach((id, idx) => {
    const row = Math.floor(idx / ROW_MAX);
    const col = idx % ROW_MAX;
    const m = nodeMeta.get(id);
    posMap.set(id, { x: col * (cellW + GAP_X), y: HEADER_OFFSET + row * (cellH + GAP_Y), w: m.w, h: m.h, row, col });
  });

  const contentBottomY = HEADER_OFFSET + rows * cellH + (rows - 1) * GAP_Y;
  const isAdjacent = (a, b) => a.row === b.row && Math.abs(a.col - b.col) === 1;
  const hasLoopEdge = laneEdges.some(e => {
    const a = posMap.get(e.from), b = posMap.get(e.to);
    return a && b && !isAdjacent(a, b);
  });
  const bridgeY = contentBottomY + (hasLoopEdge ? LOOP_MARGIN : 0);
  const contentH = hasLoopEdge ? bridgeY + BOTTOM_PAD : contentBottomY;
  let maxX = 1;
  posMap.forEach(p => { maxX = Math.max(maxX, p.x + p.w); });

  // ループ側の辺を使うノードごとの本数（アンカー X をスプレッドするため）
  const loopCountByNode = new Map();
  laneEdges.forEach(e => {
    const a = posMap.get(e.from), b = posMap.get(e.to);
    if (!a || !b || isAdjacent(a, b)) return;
    loopCountByNode.set(e.from, (loopCountByNode.get(e.from) || 0) + 1);
    loopCountByNode.set(e.to, (loopCountByNode.get(e.to) || 0) + 1);
  });
  const anchorUse = new Map();
  function spreadAnchor(rect, key, total) {
    const n = anchorUse.get(key) || 0;
    anchorUse.set(key, n + 1);
    const frac = (n + 1) / (total + 1);
    return rect.x + rect.w * (0.2 + 0.6 * frac);
  }

  const edges = laneEdges.map(e => {
    const a = posMap.get(e.from), b = posMap.get(e.to);
    if (!a || !b) return null;
    let route;
    if (isAdjacent(a, b)) {
      const aFirst = a.col < b.col || (a.row < b.row);
      const left = aFirst ? a : b, right = aFirst ? b : a;
      const p1 = [left.x + left.w, left.y + left.h / 2];
      const p2 = [right.x, right.y + right.h / 2];
      const midX = (p1[0] + p2[0]) / 2;
      const straight = dedupePoints([p1, [midX, p1[1]], [midX, p2[1]], p2]);
      route = aFirst ? straight : [...straight].reverse();
    } else {
      const exitX = spreadAnchor(a, `${e.from}:loop`, loopCountByNode.get(e.from) || 1);
      const enterX = spreadAnchor(b, `${e.to}:loop`, loopCountByNode.get(e.to) || 1);
      const gapA = a.x + a.w + GAP_X / 2;
      const gapB = b.x + b.w + GAP_X / 2;
      const hopYa = a.y + a.h + HOP;
      const hopYb = b.y + b.h + HOP;
      route = dedupePoints([
        [exitX, a.y + a.h], [exitX, hopYa], [gapA, hopYa], [gapA, bridgeY],
        [gapB, bridgeY], [gapB, hopYb], [enterX, hopYb], [enterX, b.y + b.h],
      ]);
    }
    return {
      from: e.from, to: e.to, label: e.label, type: e.type, step: e.step,
      fromLabel: e.fromLabel, toLabel: e.toLabel,
      route, labelAt: e.label ? midpointAlongRoute(route) : undefined,
    };
  }).filter(Boolean);

  return { nodes: posMap, edges, w: maxX, h: Math.max(contentH, 1) };
}

// ---------- gallery（ELK 不要） ----------
// 画面名・グループ見出しはスクリーン座標で固定サイズ（12px 前後）なので、隙間をワールド px の定数に
// すると全体表示（縮小）で文字が隣の画面やグループに食い込む。そこで「全体表示の想定倍率 k で
// 画面上に必要な px」から隙間を決め、グループを横に並べるブロック（R 行 × 必要列）を棚詰めする。
// R と棚の幅の候補を総当たりし、想定倍率が最も大きくなる配置を採用する。
const GALLERY_VIEW = { w: 1500, h: 600 };   // 全体表示で使える領域の想定（タイトルカード・ツールバーを除く）
const GALLERY_PX = { title: 30, header: 76, gutterX: 28, groupGapX: 44, groupGapY: 40, pad: 20 };
const GALLERY_BASE = { title: 160, header: 130, gutterX: 140, groupGapX: 100, groupGapY: 100, pad: 140 };

function buildGalleryLayout(blocks, cellW, cellH, R, shelfCols, k) {
  const g = {};
  Object.keys(GALLERY_PX).forEach(key => { g[key] = Math.max(GALLERY_BASE[key], GALLERY_PX[key] / k); });
  const nodes = [], outGroups = [];
  let shelfX = 0, shelfY = 0, shelfH = 0, shelfUsedCols = 0;
  blocks.forEach(b => {
    const cols = Math.max(1, Math.ceil(b.items.length / R));
    const rows = Math.ceil(b.items.length / cols);
    if (shelfUsedCols > 0 && shelfUsedCols + cols > shelfCols) {
      shelfY += shelfH + g.groupGapY; shelfX = 0; shelfH = 0; shelfUsedCols = 0;
    }
    const bw = g.pad * 2 + cols * cellW + (cols - 1) * g.gutterX;
    const bh = g.header + rows * cellH + (rows - 1) * g.title + g.pad;
    b.items.forEach((s, idx) => {
      const r = Math.floor(idx / cols), c = idx % cols;
      nodes.push({
        id: s.id, kind: 'screen', group: b.id,
        x: shelfX + g.pad + c * (cellW + g.gutterX),
        y: shelfY + g.header + r * (cellH + g.title),
        w: s.w || DEFAULT_SCREEN_W, h: s.h || DEFAULT_SCREEN_H,
      });
    });
    outGroups.push({ id: b.id, label: b.label, x: shelfX, y: shelfY, w: bw, h: bh });
    shelfX += bw + g.groupGapX; shelfH = Math.max(shelfH, bh); shelfUsedCols += cols;
  });
  const bounds = computeBounds(nodes, outGroups, []);
  const fitK = Math.min(0.6, GALLERY_VIEW.w / bounds.w, GALLERY_VIEW.h / bounds.h);
  return { nodes, groups: outGroups, bounds, fitK };
}

function layoutGallery(model, warnings) {
  const screens = model.screens || [];
  const groups = model.groups || [];
  const byGroupOrder = new Map(groups.map(g => [g.id, g.order]));

  // 最大セルサイズ（全画面共通のグリッドセルにする。個々の画面は自サイズのまま左上寄せ）
  let cellW = DEFAULT_SCREEN_W, cellH = DEFAULT_SCREEN_H;
  screens.forEach(s => { cellW = Math.max(cellW, s.w || DEFAULT_SCREEN_W); cellH = Math.max(cellH, s.h || DEFAULT_SCREEN_H); });

  const sortedGroups = [...groups].sort((a, b) => (a.order || 0) - (b.order || 0));
  const groupOrderIds = sortedGroups.map(g => g.id);
  const unassigned = screens.some(s => !s.group || !byGroupOrder.has(s.group));
  if (unassigned) groupOrderIds.push('__unassigned__');
  const blocks = groupOrderIds.map(gid => {
    const g = sortedGroups.find(x => x.id === gid);
    return {
      id: gid, label: g ? g.label : '(未分類)',
      items: screens.filter(s => (s.group && byGroupOrder.has(s.group) ? s.group : '__unassigned__') === gid),
    };
  }).filter(b => b.items.length > 0);
  if (unassigned) warnings.push('gallery: group 未設定の画面を (未分類) レーンに配置しました');
  if (blocks.length === 0) return { nodes: [], groups: [], edges: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };

  const maxItems = Math.max(...blocks.map(b => b.items.length));
  let best = null;
  for (let R = 1; R <= Math.min(maxItems, 8); R++) {
    const colsOf = blocks.map(b => Math.ceil(b.items.length / R));
    const totalCols = colsOf.reduce((a, c) => a + c, 0);
    for (let shelfCols = Math.max(...colsOf); shelfCols <= totalCols; shelfCols++) {
      // 隙間は倍率に依存し、倍率は隙間に依存するので、小さい側へ寄せながら数回反復する
      let k = 0.2, lay = null;
      for (let it = 0; it < 6; it++) {
        lay = buildGalleryLayout(blocks, cellW, cellH, R, shelfCols, k);
        if (lay.fitK >= k * 0.98) break;
        k = lay.fitK;
      }
      if (!best || lay.fitK > best.fitK + 1e-6) best = lay;
    }
  }
  return { nodes: best.nodes, groups: best.groups, edges: [], bounds: best.bounds };
}

function computeBounds(nodes, groups, edges) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = r => { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); };
  nodes.forEach(consider);
  groups.forEach(consider);
  (edges || []).forEach(e => (e.route || []).forEach(([x, y]) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }));
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  const margin = 80;
  return { x: minX - margin, y: minY - margin, w: (maxX - minX) + margin * 2, h: (maxY - minY) + margin * 2 };
}

// ---------- flow（レーン別 ELK + 手動レーン間ルーティング） ----------
async function layoutFlow(model, warnings) {
  const screens = model.screens || [];
  const groups = model.groups || [];
  const flow = model.modes.flow;
  const explicitNodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edgesIn = Array.isArray(flow.edges) ? flow.edges : [];

  const byGroupOrder = new Map(groups.map(g => [g.id, g.order]));
  const nodeMeta = new Map(); // id -> { kind, group, w, h, label, sub, pin }

  screens.forEach(s => {
    nodeMeta.set(s.id, {
      kind: 'screen',
      group: s.group && byGroupOrder.has(s.group) ? s.group : '__unassigned__',
      w: s.w || DEFAULT_SCREEN_W, h: s.h || DEFAULT_SCREEN_H,
      pin: s.pin,
    });
  });
  explicitNodes.forEach(n => {
    nodeMeta.set(n.id, {
      kind: n.kind || 'pill',
      group: n.group && byGroupOrder.has(n.group) ? n.group : '__unassigned__',
      w: PILL_W, h: PILL_H,
      label: n.label, sub: n.sub, pin: n.pin,
    });
  });

  const sortedGroups = [...groups].sort((a, b) => (a.order || 0) - (b.order || 0));
  const laneIds = sortedGroups.map(g => g.id);
  const hasUnassigned = [...nodeMeta.values()].some(m => m.group === '__unassigned__');
  if (hasUnassigned) { laneIds.push('__unassigned__'); warnings.push('flow: group 未設定のノードを (未分類) レーンに配置しました'); }

  const laneIndexOf = new Map(laneIds.map((id, i) => [id, i]));
  const laneOf = id => (nodeMeta.get(id) || {}).group;

  const intraEdgesByLane = new Map(laneIds.map(id => [id, []]));
  const interEdges = [];
  edgesIn.forEach((e, i) => {
    const lf = laneOf(e.from), lt = laneOf(e.to);
    if (lf === undefined || lt === undefined) return; // validate.js が既にエラー化する想定
    if (lf === lt) intraEdgesByLane.get(lf).push({ ...e, _i: i });
    else interEdges.push({ ...e, _i: i });
  });

  // レーン内配置は ELK に任せず、model 順の安定位相ソート + 単一行（6 件超で折り返し）で
  // 決定的に並べる（fix #3。placeLaneRow を参照。ELK の自動配置は縦積み・折り返しを予測
  // しづらく、レーンが縦に伸びて読みにくくなっていたための変更）。
  const laneResults = new Map(); // laneId -> { nodes: Map(id->{x,y,w,h}), edges: [...], w, h }
  for (const laneId of laneIds) {
    const memberIds = [...nodeMeta.entries()].filter(([, m]) => m.group === laneId).map(([id]) => id);
    if (memberIds.length === 0) { laneResults.set(laneId, { nodes: new Map(), edges: [], w: 0, h: 0 }); continue; }
    const laneEdges = intraEdgesByLane.get(laneId);
    laneResults.set(laneId, placeLaneRow(memberIds, nodeMeta, laneEdges));
  }

  const laneWidth = Math.max(1, ...laneIds.map(id => laneResults.get(id).w));
  const laneGap = 100;
  const outGroups = [];
  const globalNodes = [];
  const globalNodePos = new Map(); // id -> rect (global)
  let curY = 0;
  for (const laneId of laneIds) {
    const lr = laneResults.get(laneId);
    if (lr.nodes.size === 0) continue;
    const g = sortedGroups.find(g => g.id === laneId);
    outGroups.push({ id: laneId, label: g ? g.label : '(未分類)', x: 0, y: curY, w: laneWidth, h: Math.max(lr.h, 1) });
    lr.nodes.forEach((p, id) => {
      const meta = nodeMeta.get(id);
      const rect = { x: p.x, y: curY + p.y, w: p.w, h: p.h };
      globalNodePos.set(id, rect);
      const node = { id, kind: meta.kind, x: rect.x, y: rect.y, w: rect.w, h: rect.h, group: laneId };
      if (meta.kind !== 'screen') { node.label = meta.label; node.sub = meta.sub; }
      if (meta.pin) node.pin = meta.pin;
      globalNodes.push(node);
    });
    curY += Math.max(lr.h, 1) + laneGap;
  }

  const intraEdgesGlobal = [];
  laneIds.forEach(laneId => {
    const lr = laneResults.get(laneId);
    const laneY = outGroups.find(g => g.id === laneId);
    if (!laneY) return;
    lr.edges.forEach(e => {
      intraEdgesGlobal.push({
        ...e,
        route: e.route.map(([x, y]) => [x, y + laneY.y]),
        labelAt: e.labelAt ? [e.labelAt[0], e.labelAt[1] + laneY.y] : undefined,
      });
    });
  });

  // レーンをまたぐ辺: 手動で直交ルートを引く。同じ (始点レーン,終点レーン) ペアで
  // ブリッジ Y をずらして重なりを減らす。ノード側のアンカー X もサイド単位でスプレッドする。
  const anchorUse = new Map(); // `${nodeId}:${side}` -> count
  function anchorX(nodeId, side) {
    const rect = globalNodePos.get(nodeId);
    const key = `${nodeId}:${side}`;
    const n = anchorUse.get(key) || 0;
    anchorUse.set(key, n + 1);
    const total = interEdges.filter(e => {
      const from = e.from === nodeId, to = e.to === nodeId;
      if (!from && !to) return false;
      const laneA = laneIndexOf.get(laneOf(e.from)), laneB = laneIndexOf.get(laneOf(e.to));
      const wantSide = from ? (laneB > laneA ? 'bottom' : 'top') : (laneA > laneB ? 'bottom' : 'top');
      return wantSide === side;
    }).length;
    const frac = (n + 1) / (total + 1);
    return rect.x + rect.w * (0.15 + 0.7 * frac);
  }
  const bridgeOffset = new Map(); // `${laneA}-${laneB}` -> count
  const interEdgesGlobal = interEdges.map(e => {
    const la = laneIndexOf.get(laneOf(e.from)), lb = laneIndexOf.get(laneOf(e.to));
    const rectA = globalNodePos.get(e.from), rectB = globalNodePos.get(e.to);
    if (!rectA || !rectB) return null;
    const down = lb > la;
    const sideA = down ? 'bottom' : 'top';
    const sideB = down ? 'top' : 'bottom';
    const start = { x: anchorX(e.from, sideA), y: down ? rectA.y + rectA.h : rectA.y };
    const end = { x: anchorX(e.to, sideB), y: down ? rectB.y : rectB.y + rectB.h };
    const bridgeKey = `${Math.min(la, lb)}-${Math.max(la, lb)}`;
    const bi = bridgeOffset.get(bridgeKey) || 0;
    bridgeOffset.set(bridgeKey, bi + 1);
    let midY = (start.y + end.y) / 2 + (bi % 5 - 2) * 14;
    if (down) midY = Math.max(start.y + 20, Math.min(end.y - 20, midY));
    else midY = Math.min(start.y - 20, Math.max(end.y + 20, midY));
    const route = dedupePoints([[start.x, start.y], [start.x, midY], [end.x, midY], [end.x, end.y]]);
    return {
      from: e.from, to: e.to, label: e.label, type: e.type, step: e.step,
      fromLabel: e.fromLabel, toLabel: e.toLabel,
      route, labelAt: e.label ? midpointAlongRoute(route) : undefined,
    };
  }).filter(Boolean);

  let edges = [...intraEdgesGlobal, ...interEdgesGlobal];

  // pin の適用（あれば最終座標を上書きし、関係する辺を単純ルートで引き直す）
  edges = applyPins(globalNodes, edges, globalNodePos, warnings, 'flow');

  const bounds = computeBounds(globalNodes, outGroups, edges);
  return {
    label: flow.label, desc: flow.desc, legend: flow.legend, toggles: flow.toggles, steps: flow.steps,
    bounds, groups: outGroups, nodes: globalNodes, edges,
  };
}

// ---------- flow（layout: "elk"。全体を 1 回の ELK layered で解くカード＋曲線スタイル） ----------
// docs/design-viewer-elk.html のレイアウトを再現するモード。寸法・間隔はすべて「幅 360px の
// 画面カード」を基準にした参照 px で定義し、ワールド座標では ELK_UNIT 倍する（画面サムネイルを
// 実寸 1440px のまま置くため。1 ワールド px = モックアップの 1px の関係を lanes と揃える）。
const ELK_UNIT = DEFAULT_SCREEN_W / 360;
const ELK_CARD = { pad: 10, header: 44, radius: 18 };
const ELK_PILL = { minW: 148, padX: 18, h: 42, hSub: 54, font: 13, subFont: 9 };
const ELK_FLOW_DEFAULT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': 130,
  'elk.layered.spacing.nodeNodeBetweenLayers': 230,
  'elk.spacing.edgeNode': 80,
  'elk.spacing.edgeEdge': 40,
  'elk.spacing.componentComponent': 220,
  'elk.padding': 100,
};

/** 文字幅のおおよその見積もり（全角 1em・半角 0.58em） */
function estimateTextWidth(text, px) {
  let em = 0;
  for (const ch of String(text || '')) em += ch.charCodeAt(0) > 0xff ? 1 : 0.58;
  return em * px;
}

/** 参照 px 単位の既定オプションをワールド単位へ換算し、model の layoutOptions で上書きする */
function elkFlowOptions(edgeStyle, overrides) {
  const opts = {};
  Object.entries(ELK_FLOW_DEFAULT_OPTIONS).forEach(([k, v]) => {
    if (k === 'elk.padding') { const p = v * ELK_UNIT; opts[k] = `[top=${p},left=${p},bottom=${p},right=${p}]`; }
    else opts[k] = typeof v === 'number' ? String(v * ELK_UNIT) : v;
  });
  opts['elk.edgeRouting'] = edgeStyle === 'orthogonal' ? 'ORTHOGONAL' : 'SPLINES';
  Object.entries(overrides || {}).forEach(([k, v]) => { opts[k.startsWith('elk.') ? k : `elk.${k}`] = String(v); });
  return opts;
}

const SIDE_NORMAL = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

/** 辺の向き（中心間の dx/dy の大きい方）で出る側・入る側を決める */
function curveSides(a, b) {
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
  const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

/**
 * 参照 HTML と同じ 3 次ベジェの辺を作る。制御点の張り出しは max(90, 距離×0.42)（参照 px）。
 * 同じノードの同じ側に複数の辺が付くときは、相手ノードの位置順に側面の中央 50% へ散らす
 * （往復の辺 S01⇄S02 が重ならず平行に並ぶ）。route は [始点, 制御点1, 制御点2, 終点]。
 */
function routeCurves(edgesIn, rectOf) {
  const plans = edgesIn.map((e, i) => {
    const a = rectOf.get(e.from), b = rectOf.get(e.to);
    if (!a || !b) return null;
    if (e.from === e.to) return { i, e, a, b, self: true, sides: ['top', 'right'] };
    return { i, e, a, b, sides: curveSides(a, b) };
  });
  const attach = new Map(); // `${id}:${side}` -> [{plan, end, key}]
  plans.forEach(p => {
    if (!p) return;
    [[p.e.from, p.sides[0], p.b, 0], [p.e.to, p.sides[1], p.a, 1]].forEach(([id, side, other, end]) => {
      const k = `${id}:${side}`;
      if (!attach.has(k)) attach.set(k, []);
      const vertical = side === 'left' || side === 'right';
      attach.get(k).push({ p, end, key: vertical ? other.y + other.h / 2 : other.x + other.w / 2 });
    });
  });
  const anchors = new Map(); // `${edgeIdx}:${end}` -> [x,y]
  attach.forEach((list, k) => {
    const side = k.slice(k.lastIndexOf(':') + 1);
    list.sort((u, v) => (u.key - v.key) || (u.p.i - v.p.i) || (u.end - v.end));
    list.forEach((it, idx) => {
      const r = it.end === 0 ? it.p.a : it.p.b;
      const t = it.p.self ? (it.end === 0 ? 0.75 : 0.25) : (list.length === 1 ? 0.5 : 0.25 + 0.5 * idx / (list.length - 1));
      let pt;
      if (side === 'left') pt = [r.x, r.y + r.h * t];
      else if (side === 'right') pt = [r.x + r.w, r.y + r.h * t];
      else if (side === 'top') pt = [r.x + r.w * t, r.y];
      else pt = [r.x + r.w * t, r.y + r.h];
      anchors.set(`${it.p.i}:${it.end}`, pt);
    });
  });
  return plans.map(p => {
    if (!p) return null;
    const s = anchors.get(`${p.i}:0`), t = anchors.get(`${p.i}:1`);
    const [na, nb] = [SIDE_NORMAL[p.sides[0]], SIDE_NORMAL[p.sides[1]]];
    const horizontal = p.sides[0] === 'left' || p.sides[0] === 'right';
    const dist = p.self ? 0 : (horizontal ? Math.abs(t[0] - s[0]) : Math.abs(t[1] - s[1]));
    const c = Math.max(90 * ELK_UNIT, dist * 0.42);
    const route = [s, [s[0] + na[0] * c, s[1] + na[1] * c], [t[0] + nb[0] * c, t[1] + nb[1] * c], t];
    const e = p.e;
    return {
      from: e.from, to: e.to, label: e.label, type: e.type, step: e.step,
      fromLabel: e.fromLabel, toLabel: e.toLabel,
      shape: 'bezier', route, labelAt: e.label ? bezierPoint(route, 0.5) : undefined,
    };
  }).filter(Boolean);
}

function bezierPoint(r, t) {
  const u = 1 - t;
  const f = (i) => u * u * u * r[0][i] + 3 * u * u * t * r[1][i] + 3 * u * t * t * r[2][i] + t * t * t * r[3][i];
  return [f(0), f(1)];
}

async function layoutFlowElk(model, warnings) {
  const flow = model.modes.flow;
  const edgeStyle = flow.edgeStyle === 'orthogonal' ? 'orthogonal' : 'curve';
  const U = ELK_UNIT;
  const explicitNodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edgesIn = (Array.isArray(flow.edges) ? flow.edges : []);

  // screens → modes.flow.nodes の記述順で ELK に渡す（ELK は記述順をある程度尊重する）
  const items = [];
  (model.screens || []).forEach(s => {
    const tw = s.w || DEFAULT_SCREEN_W, th = s.h || DEFAULT_SCREEN_H;
    const pad = ELK_CARD.pad * U, header = ELK_CARD.header * U;
    items.push({
      id: s.id, kind: 'screen', w: tw + pad * 2, h: header + th + pad,
      extra: { card: { unit: U, pad, header, radius: ELK_CARD.radius * U, thumbW: tw, thumbH: th } },
      pin: s.pin, nudge: s.nudge,
    });
  });
  explicitNodes.forEach(n => {
    const label = n.label || n.id;
    const w = Math.max(ELK_PILL.minW, estimateTextWidth(label, ELK_PILL.font) + ELK_PILL.padX * 2,
      estimateTextWidth(n.sub, ELK_PILL.subFont) + ELK_PILL.padX * 2);
    items.push({
      id: n.id, kind: n.kind || 'pill', w: Math.ceil(w) * U, h: (n.sub ? ELK_PILL.hSub : ELK_PILL.h) * U,
      extra: { label: n.label, sub: n.sub, unit: U }, pin: n.pin, nudge: n.nudge,
      attachTo: n.attachTo, attachSide: n.attachSide, attachGap: n.attachGap,
    });
  });
  const ids = new Set(items.map(it => it.id));
  const edges = edgesIn.filter(e => ids.has(e.from) && ids.has(e.to));
  // attachTo を持つノード（起点など）は ELK に渡さず、配置後に相手ノードの横へ置く。
  // 起点を ELK に含めると層が 1 つ増えて全体の並びが変わるため（参照 HTML も起点は手置き）。
  const attached = new Set(items.filter(it => it.attachTo && ids.has(it.attachTo) && it.attachTo !== it.id).map(it => it.id));
  const elkItems = items.filter(it => !attached.has(it.id));
  // weak（保存後に戻る等の逆向きの遷移）は層の決定に使わない。往復の辺が ELK の層順を
  // 入れ替え、主な流れ（左→右）が読めなくなるため。配置後に他の辺と同様に描く。
  const elkEdges = edges.filter(e => !attached.has(e.from) && !attached.has(e.to) && e.type !== 'weak');

  const graph = {
    id: 'root',
    layoutOptions: elkFlowOptions(edgeStyle, flow.layoutOptions),
    children: elkItems.map(it => ({ id: it.id, width: it.w, height: it.h })),
    edges: elkEdges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
  const result = await runElk(graph);
  const posOf = new Map(result.children.map(c => [c.id, c]));

  const nodes = items.map(it => {
    const p = posOf.get(it.id) || { x: 0, y: 0 };
    const node = { id: it.id, kind: it.kind, x: p.x, y: p.y, w: it.w, h: it.h, ...it.extra };
    if (it.nudge && !attached.has(it.id)) { node.x += Number(it.nudge.dx) || 0; node.y += Number(it.nudge.dy) || 0; }
    if (it.pin) node.pin = it.pin;
    return node;
  });
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  items.filter(it => attached.has(it.id)).forEach(it => {
    const n = nodeById.get(it.id), t0 = nodeById.get(it.attachTo);
    // 相手が pin 済みなら固定後の座標を基準にする（pin は後段で適用されるため）
    const t = t0.pin ? { ...t0, x: t0.pin.x, y: t0.pin.y } : t0;
    const gap = (typeof it.attachGap === 'number' ? it.attachGap : 130) * U;
    const side = it.attachSide || 'left';
    if (side === 'right') { n.x = t.x + t.w + gap; n.y = t.y + (t.h - n.h) / 2; }
    else if (side === 'top') { n.x = t.x + (t.w - n.w) / 2; n.y = t.y - gap - n.h; }
    else if (side === 'bottom') { n.x = t.x + (t.w - n.w) / 2; n.y = t.y + t.h + gap; }
    else { n.x = t.x - gap - n.w; n.y = t.y + (t.h - n.h) / 2; }
    if (it.nudge) { n.x += Number(it.nudge.dx) || 0; n.y += Number(it.nudge.dy) || 0; }
  });

  let outEdges;
  if (edgeStyle === 'curve') {
    applyPins(nodes, [], null, warnings, 'flow');
    outEdges = routeCurves(edges, new Map(nodes.map(n => [n.id, n])));
  } else {
    const rectOf = nodeById;
    const elkRoutes = new Map((result.edges || []).map((re, i) => [elkEdges[i], re]));
    outEdges = edges.map(orig => {
      const re = elkRoutes.get(orig) || {};
      const route = flattenSection(re.sections && re.sections[0]) || simpleOrthogonalRoute(rectOf.get(orig.from), rectOf.get(orig.to));
      return {
        from: orig.from, to: orig.to, label: orig.label, type: orig.type, step: orig.step,
        fromLabel: orig.fromLabel, toLabel: orig.toLabel,
        route, labelAt: orig.label ? midpointAlongRoute(route) : undefined,
      };
    });
    // nudge したノードの辺は ELK の経路が合わなくなるため、pin と同様に単純ルートへ引き直す
    const moved = new Set(items.filter(it => it.nudge || attached.has(it.id)).map(it => it.id));
    outEdges = outEdges.map(e => {
      if (!moved.has(e.from) && !moved.has(e.to)) return e;
      const route = simpleOrthogonalRoute(rectOf.get(e.from), rectOf.get(e.to));
      return { ...e, route, labelAt: e.label ? midpointAlongRoute(route) : undefined };
    });
    outEdges = applyPins(nodes, outEdges, null, warnings, 'flow');
  }
  nodes.forEach(n => { delete n.pin; });
  const overlaps = countOverlaps(new Map(nodes.map(n => [n.id, n])));
  if (overlaps > 0) warnings.push(`flow: ノードの重なりが ${overlaps} 件あります（nudge / attachTo / pin の値を見直してください）`);

  const bounds = computeBounds(nodes, [], outEdges);
  return {
    label: flow.label, desc: flow.desc, legend: flow.legend, toggles: flow.toggles, steps: flow.steps,
    layout: 'elk', edgeStyle, unit: U,
    bounds, groups: [], nodes, edges: outEdges,
  };
}

/** pin: {x,y} を持つノードを最終座標で上書きし、接続辺を単純ルートに引き直す */
function applyPins(nodes, edges, posMap, warnings, modeName) {
  const pinned = nodes.filter(n => n.pin);
  if (pinned.length === 0) return edges;
  const rectOf = new Map(nodes.map(n => [n.id, n]));
  pinned.forEach(n => {
    n.x = n.pin.x; n.y = n.pin.y;
    if (posMap) posMap.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
    delete n.pin;
    warnings.push(`${modeName}: ${n.id} を pin 座標で固定しました（他ノードとの重なり回避は対象外）`);
  });
  const pinnedIds = new Set(pinned.map(n => n.id));
  return edges.map(e => {
    if (!pinnedIds.has(e.from) && !pinnedIds.has(e.to)) return e;
    const a = rectOf.get(e.from), b = rectOf.get(e.to);
    if (!a || !b) return e;
    const route = simpleOrthogonalRoute(a, b);
    return { ...e, route, labelAt: e.label ? midpointAlongRoute(route) : undefined };
  });
}

// ---------- concept / dfd（layered vs stress を比較） ----------
async function layoutFreeDiagram(modeName, mode, kind, size, warnings) {
  const nodesIn = Array.isArray(mode.nodes) ? mode.nodes : [];
  const edgesIn = Array.isArray(mode.edges) ? mode.edges : [];
  if (nodesIn.length === 0) {
    return { label: mode.label, desc: mode.desc, legend: mode.legend, steps: mode.steps, bounds: { x: 0, y: 0, w: 0, h: 0 }, nodes: [], edges: [] };
  }

  async function attempt(algorithm) {
    // layered には elk.layered.wrapping.strategy を使う（fix #1）。少数ノードの鎖状グラフを
    // layered/RIGHT だけで解くと極端に横長（アスペクト比 15〜20:1）になり、1480x640 の
    // カード込みビューポートでのフィットズームが 25〜40% まで落ちてラベルが読めなくなる。
    // MULTI_EDGE ラッピングは長い層の連なりを目標アスペクト比に合わせて複数段へ折り返す
    // （実測: 検証用データで比率 17.9:1 → 1.4〜2.0:1 に改善、ノード重なりは増えない）。
    // 辺にラベルサイズを渡すと ELK がレイヤー間にラベル分の幅を確保してしまい、日本語の
    // 長いラベル（20 文字超）がある実データでは幅が約 2 倍に膨らみフィットズームが大きく
    // 下がることが実測でわかった（例: dfd 55%→45%）。エンジンは低倍率時にラベルを描かず、
    // 重なるラベルは貪欲法で間引く設計（CONTRACT §5 LOD）なので、レイアウト計算では
    // ラベル分の余白を確保せず、間隔を詰めてフィットズームを優先する。
    const layoutOptions = algorithm === 'layered' ? {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '24',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.spacing.edgeNode': '8',
      'elk.spacing.edgeEdge': '6',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=20,left=20,bottom=20,right=20]',
      'elk.layered.wrapping.strategy': 'MULTI_EDGE',
      'elk.aspectRatio': String(FIT_W / FIT_H),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    } : {
      'elk.algorithm': 'stress',
      'elk.spacing.nodeNode': '70',
      'elk.stress.desiredEdgeLength': '220',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=20,left=20,bottom=20,right=20]',
    };
    const graph = {
      id: 'root', layoutOptions,
      children: nodesIn.map(n => ({ id: n.id, width: size.w, height: size.h })),
      edges: edgesIn.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
    };
    const result = await runElk(graph);
    const posMap = new Map(result.children.map(c => [c.id, { x: c.x, y: c.y, w: c.width, h: c.height }]));
    return { result, posMap };
  }

  let chosen;
  const layeredR = await attempt('layered');
  let stressR = null;
  try { stressR = await attempt('stress'); } catch (e) { warnings.push(`${modeName}: stress レイアウトを試行できませんでした（${e.message}）。layered を使用します`); }

  // 採否は複合スコアで決める（scoreCandidate）: 重なり 0 件必須 → フィットズーム最大 →
  // 交差最小 → 総エッジ長最小、の優先順位。fit を最優先級に置くことで、stress が交差ゼロを
  // 達成しても極端に細長い/大きい配置になるケースを選ばないようにする。
  const sLayered = scoreCandidate(layeredR.posMap, edgesIn);
  if (stressR) {
    const sStress = scoreCandidate(stressR.posMap, edgesIn);
    chosen = sStress.score < sLayered.score
      ? { ...stressR, algorithm: 'stress', ...sStress, other: sLayered }
      : { ...layeredR, algorithm: 'layered', ...sLayered, other: sStress };
  } else {
    chosen = { ...layeredR, algorithm: 'layered', ...sLayered, other: null };
  }

  const nodes = nodesIn.map(n => {
    const p = chosen.posMap.get(n.id);
    const node = { id: n.id, kind, x: p.x, y: p.y, w: p.w, h: p.h };
    Object.keys(n).forEach(k => { if (!['id', 'kind', 'pin'].includes(k)) node[k] = n[k]; });
    node.pin = n.pin;
    return node;
  });
  const edges = (chosen.result.edges || []).map((re, i) => {
    const orig = edgesIn[i];
    const route = flattenSection(re.sections && re.sections[0]);
    return {
      from: orig.from, to: orig.to, label: orig.label, type: orig.type, step: orig.step,
      fromLabel: orig.fromLabel, toLabel: orig.toLabel,
      route: route || [[chosen.posMap.get(orig.from).x, chosen.posMap.get(orig.from).y], [chosen.posMap.get(orig.to).x, chosen.posMap.get(orig.to).y]],
      labelAt: orig.label ? labelCenterFromElk(re, route) : undefined,
    };
  });

  const finalEdges = applyPins(nodes, edges, null, warnings, modeName);
  const finalNodes = nodes.map(({ pin, ...rest }) => rest);

  const bounds = computeBounds(finalNodes, [], finalEdges);
  return {
    label: mode.label, desc: mode.desc, legend: mode.legend, steps: mode.steps,
    bounds, nodes: finalNodes, edges: finalEdges,
    _algorithm: chosen.algorithm, _crossings: chosen.crossings, _overlaps: chosen.overlaps,
    _fitZoom: chosen.fit, _other: chosen.other && { algorithm: chosen.algorithm === 'stress' ? 'layered' : 'stress', crossings: chosen.other.crossings, overlaps: chosen.other.overlaps, fitZoom: chosen.other.fit },
  };
}

// ---------- er（layered、FIXED_POS ポート） ----------
async function layoutEr(mode, warnings) {
  const nodesIn = Array.isArray(mode.nodes) ? mode.nodes : [];
  const edgesIn = Array.isArray(mode.edges) ? mode.edges : [];
  if (nodesIn.length === 0) {
    return { label: mode.label, desc: mode.desc, legend: mode.legend, bounds: { x: 0, y: 0, w: 0, h: 0 }, nodes: [], edges: [] };
  }
  const sizeOf = n => ({ w: ER_W, h: ER_HEADER + ER_ROW * ((n.fields || []).length) });
  const rowY = (n, fieldName) => {
    const idx = (n.fields || []).findIndex(f => f.name === fieldName);
    return idx < 0 ? sizeOf(n).h / 2 : ER_HEADER + ER_ROW * idx + ER_ROW / 2;
  };

  const portRegistry = new Map(); // nodeId -> Map(portKey -> {id,x,y,side})
  function getPort(nodeId, side, y) {
    const key = `${side}:${Math.round(y)}`;
    if (!portRegistry.has(nodeId)) portRegistry.set(nodeId, new Map());
    const m = portRegistry.get(nodeId);
    if (!m.has(key)) {
      const size = sizeOf(nodesIn.find(n => n.id === nodeId));
      m.set(key, { id: `${nodeId}#${side}#${m.size}`, x: side === 'EAST' ? size.w : 0, y, side });
    }
    return m.get(key).id;
  }

  const edgeDefs = edgesIn.map((e, i) => {
    const fromNode = nodesIn.find(n => n.id === e.from);
    const toNode = nodesIn.find(n => n.id === e.to);
    const sourcePort = e.fromField && fromNode ? getPort(e.from, 'EAST', rowY(fromNode, e.fromField)) : undefined;
    const targetPort = e.toField && toNode ? getPort(e.to, 'WEST', rowY(toNode, e.toField)) : undefined;
    return { id: `e${i}`, sources: [sourcePort || e.from], targets: [targetPort || e.to], orig: e };
  });

  const children = nodesIn.map(n => {
    const size = sizeOf(n);
    const ports = [...(portRegistry.get(n.id) || new Map()).values()].map(p => ({
      id: p.id, x: p.x, y: p.y, width: 1, height: 1,
      layoutOptions: { 'elk.port.side': p.side },
    }));
    return {
      id: n.id, width: size.w, height: size.h,
      ports,
      layoutOptions: ports.length > 0 ? { 'elk.portConstraints': 'FIXED_POS' } : {},
    };
  });

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '90',
      'elk.layered.spacing.nodeNodeBetweenLayers': '160',
      'elk.spacing.edgeNode': '40',
      'elk.spacing.edgeEdge': '24',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children,
    edges: edgeDefs.map(e => ({
      id: e.id, sources: e.sources, targets: e.targets,
      labels: e.orig.label ? [{ text: e.orig.label, ...estimateLabelSize(e.orig.label) }] : [],
    })),
  };
  const result = await runElk(graph);
  const posMap = new Map(result.children.map(c => [c.id, { x: c.x, y: c.y, w: c.width, h: c.height }]));

  const nodes = nodesIn.map(n => {
    const p = posMap.get(n.id);
    return { id: n.id, kind: 'er', x: p.x, y: p.y, w: p.w, h: p.h, tone: n.tone, label: n.label, sub: n.sub, info: n.info, fields: n.fields, pin: n.pin };
  });
  const edges = (result.edges || []).map((re, i) => {
    const orig = edgeDefs[i].orig;
    const route = flattenSection(re.sections && re.sections[0]);
    const fallback = [[posMap.get(orig.from).x, posMap.get(orig.from).y], [posMap.get(orig.to).x, posMap.get(orig.to).y]];
    return {
      from: orig.from, to: orig.to, label: orig.label, type: orig.type,
      fromField: orig.fromField, toField: orig.toField, fromLabel: orig.fromLabel, toLabel: orig.toLabel,
      route: route || fallback,
      labelAt: orig.label ? labelCenterFromElk(re, route || fallback) : undefined,
    };
  });

  let finalEdges = applyPins(nodes, edges, null, warnings, 'er');
  const finalNodes = nodes.map(n => { const { pin, ...rest } = n; return rest; });
  const bounds = computeBounds(finalNodes, [], finalEdges);
  return { label: mode.label, desc: mode.desc, legend: mode.legend, bounds, nodes: finalNodes, edges: finalEdges };
}

// ---------- メイン ----------
async function computeLayout(model) {
  const warnings = [];
  const timings = {};
  const modes = {};
  const modesIn = model.modes || {};
  let t;

  if (modesIn.gallery !== undefined || (model.screens || []).length > 0) {
    t = Date.now();
    modes.gallery = layoutGallery(model, warnings);
    modes.gallery.label = (modesIn.gallery && modesIn.gallery.label) || '画面イメージ';
    modes.gallery.desc = modesIn.gallery && modesIn.gallery.desc;
    timings.gallery = Date.now() - t;
  }
  if (modesIn.flow) {
    t = Date.now();
    modes.flow = modesIn.flow.layout === 'elk'
      ? await layoutFlowElk(model, warnings)
      : await layoutFlow(model, warnings);
    timings.flow = Date.now() - t;
  }
  if (modesIn.concept) {
    t = Date.now();
    modes.concept = await layoutFreeDiagram('concept', modesIn.concept, 'concept', { w: CONCEPT_W, h: CONCEPT_H }, warnings);
    timings.concept = Date.now() - t;
  }
  if (modesIn.er) {
    t = Date.now();
    modes.er = await layoutEr(modesIn.er, warnings);
    timings.er = Date.now() - t;
  }
  if (modesIn.dfd) {
    t = Date.now();
    modes.dfd = await layoutFreeDiagram('dfd', modesIn.dfd, 'dfd', { w: DFD_W, h: DFD_H }, warnings);
    if (modesIn.dfd.steps) modes.dfd.steps = modesIn.dfd.steps;
    timings.dfd = Date.now() - t;
  }

  const data = {
    version: 2,
    generatedAt: new Date().toISOString(),
    meta: model.meta,
    screens: model.screens || [],
    thumbs: {},
    modes,
  };
  return { data, warnings, timings };
}

module.exports = { computeLayout };

if (require.main === module) {
  (async () => {
    const [viewerSrcArg, outArg] = process.argv.slice(2);
    if (!viewerSrcArg || !outArg) {
      console.error('使い方: node layout.js <viewer-src> <out>');
      process.exit(2);
    }
    const viewerSrcDir = path.resolve(viewerSrcArg);
    const outDir = path.resolve(outArg);
    let model;
    try {
      model = readModel(viewerSrcDir);
    } catch (e) {
      console.error(`[layout] ${e.message}`);
      process.exit(1);
    }
    const { errors } = validateModel(model, viewerSrcDir);
    if (errors.length > 0) {
      console.error(`[layout] validate でエラーが ${errors.length} 件見つかりました。先に validate.js を実行してください`);
      errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
    const startAll = Date.now();
    const { data, warnings, timings } = await computeLayout(model);
    const totalMs = Date.now() - startAll;

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, '.layout.json'), JSON.stringify(data, null, 2), 'utf8');

    if (warnings.length > 0) {
      console.warn(`[layout] 警告 ${warnings.length} 件:`);
      warnings.forEach(w => console.warn(`  - ${w}`));
    }
    console.log('[layout] 所要時間(ms):', timings, '合計:', totalMs);
    Object.entries(data.modes).forEach(([k, v]) => {
      if (v._algorithm) {
        const o = v._other;
        console.log(`[layout] ${k}: ${v._algorithm} を採用（fitZoom ${(v._fitZoom * 100).toFixed(0)}%・交差 ${v._crossings}・重なり ${v._overlaps}`
          + (o ? `、比較対象 ${o.algorithm}: fitZoom ${(o.fitZoom * 100).toFixed(0)}%・交差 ${o.crossings}・重なり ${o.overlaps}）` : '）'));
      }
    });
    console.log(`[layout] 書き出し: ${path.join(outDir, '.layout.json')}`);
  })().catch(e => { console.error('[layout] 失敗:', e); process.exit(1); });
}
