#!/usr/bin/env node
/**
 * design-viewer / layout.js
 *
 * model（model.json または model/**\/*.json）から各モードの座標・辺ルートを ELK.js（vendor 同梱）で計算し、
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
 * - biz: ELK 不要。フェーズをレーン×列の自己完結ブロックにして、ブロックを 1480x700 に
 *   最も大きくフィットする列数で格子詰めする（layoutBiz。詳細は同関数のコメントを参照）。
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
const { readModel } = require('./lib/load-model');
const { validateModel } = require('./validate');
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

/** 点 p から矩形 r までの最短距離（内側なら 0）。biz の分岐ラベルのノード近接判定に使う。 */
function distToRect(p, r) {
  const dx = Math.max(r.x - p[0], 0, p[0] - (r.x + r.w));
  const dy = Math.max(r.y - p[1], 0, p[1] - (r.y + r.h));
  return Math.hypot(dx, dy);
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

/**
 * 直交ルート上のラベル中心。ルートの弧長中点は、複数の辺が合流する縦の通路（層間の曲がり角）に
 * 落ちやすく、そこではラベルが隣のノードに食い込む。そこで各線分の中点を候補にし、
 * 「ラベル矩形（11px 文字の見積もり）がどのノードにも重ならない」→「水平」→「線分が長い」の順で選ぶ。
 */
/**
 * opts.avoidRect / opts.minDist: 候補の線分中点がそのノード（例: biz の decision）の外周から
 * minDist 未満しか離れていない場合は減点する（分岐ラベルがノードに食い込むのを避ける）。
 */
function labelOnRoute(route, label, rects, opts) {
  if (!route || route.length < 2) return midpointAlongRoute(route);
  const lw = estimateTextWidth(label, 11) + 18, lh = 20;
  const avoidRect = opts && opts.avoidRect;
  const minDist = (opts && opts.minDist) || 0;
  // opts.placed: 既に置いたラベル矩形（重ねない）。opts.endClearance: 終点（矢じり）からラベル端までの最小距離。
  // どちらも省略時は従来どおり（線分の中点のみを候補にする）。
  const placed = opts && opts.placed;
  const endClear = (opts && opts.endClearance) || 0;
  const sampling = !!(placed || endClear);
  const hitsRect = (c, r, pad) => c[0] - lw / 2 - pad < r.x + r.w && c[0] + lw / 2 + pad > r.x && c[1] - lh / 2 - pad < r.y + r.h && c[1] + lh / 2 + pad > r.y;
  let best = null;
  for (let i = 0; i < route.length - 1; i++) {
    const [a, b] = [route[i], route[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const horizontal = Math.abs(b[1] - a[1]) < 1;
    const isLast = i === route.length - 2;
    const cands = [];
    if (!sampling) cands.push({ c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], fits: true });
    else {
      // 線分の方向に沿って、始点側 6px・終点側（最後の線分なら endClearance）を空けた範囲で中心を動かす
      const along = horizontal ? lw : lh;
      const s0 = 6 + along / 2, s1 = len - (isLast ? endClear : 6) - along / 2;
      const fits = s1 >= s0;
      [0.5, 0.3, 0.7, 0.15, 0.85].forEach(t => {
        const d = fits ? Math.min(s1, Math.max(s0, len * t)) : len / 2;
        const u = d / len;
        cands.push({ c: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], fits, t });
      });
    }
    for (const cand of cands) {
      const c = cand.c;
      const hits = rects.some(r => hitsRect(c, r, 0));
      const near = avoidRect ? distToRect(c, avoidRect) < minDist : false;
      const collide = placed ? placed.some(r => hitsRect(c, r, 4)) : false;
      const score = (hits ? 0 : 1e6) + (collide ? 0 : 5e5) + (near ? 0 : 3e5) + (horizontal ? 1e5 : 0) + (cand.fits ? 5e4 : 0)
        + Math.min(len, 4e4) - (cand.t != null ? Math.abs(cand.t - 0.5) * 10 : 0);
      if (!best || score > best.score) best = { c, score };
    }
  }
  const c = best ? best.c : midpointAlongRoute(route);
  if (placed && c) placed.push({ x: c[0] - lw / 2, y: c[1] - lh / 2, w: lw, h: lh });
  return c;
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

// これ以上のフィットズームは読みやすさに効かない（ノード 240px・文字 11〜15px が等倍付近で十分読める）
const FIT_READABLE = 0.85;
// concept/dfd の辺ラベルと矢じりの間に空ける距離（px。矢じり約 9px ＋ 余白）
const LABEL_ARROW_CLEARANCE = 18;

/** ELK の辺ルート（折れ線）の総延長。回り込む辺ほど長くなる。ルートが無ければ中心間距離 */
function totalRouteLength(result, posMap, edges) {
  if (!result || !Array.isArray(result.edges)) return totalEdgeLength(posMap, edges);
  let total = 0;
  result.edges.forEach(re => {
    const r = flattenSection(re.sections && re.sections[0]);
    if (!r) return;
    for (let i = 0; i < r.length - 1; i++) total += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]);
  });
  return total;
}

/** 辺ルートのうち左向き（層の流れと逆）に進む水平線分の総延長。折り返しで図全体を回り込む辺ほど大きい */
function routeBacktrack(result) {
  if (!result || !Array.isArray(result.edges)) return 0;
  let total = 0;
  result.edges.forEach(re => {
    const r = flattenSection(re.sections && re.sections[0]);
    if (!r) return;
    for (let i = 0; i < r.length - 1; i++) { const dx = r[i + 1][0] - r[i][0]; if (dx < 0) total += -dx; }
  });
  return total;
}

/**
 * layered/stress の比較スコア（小さいほど良い）。優先順位:
 * 1) 重なり 0 件必須（重なりがあれば桁違いのペナルティ）
 * 2) フィットズームが大きい（1480x640 に収まる大きさ）。ただし FIT_READABLE を超える分は評価しない。
 *    上限なしだと、数ノードを次の段へ折り返して辺が図全体を回り込む配置が「小さいから」選ばれる
 * 3) 交差が少ない
 * 4) 辺の総延長（ルート長）が短い。平均的な辺の長さに対する超過分で、回り込みを減点する
 */
function scoreCandidate(posMap, edgesIn, result) {
  const overlaps = countOverlaps(posMap);
  const crossings = countCrossings(posMap, edgesIn);
  const length = totalRouteLength(result, posMap, edgesIn);
  const bounds = boundsOfPosMap(posMap);
  const fit = fitZoom(bounds);
  const perEdge = length / Math.max(1, edgesIn.length);
  const backtrack = routeBacktrack(result);
  const score = overlaps * 1e6 + (FIT_READABLE - Math.min(fit, FIT_READABLE)) * 2000 + crossings * 10 + perEdge / 10 + backtrack / 4;
  return { overlaps, crossings, length, fit, bounds, score, backtrack };
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
 * （model の記述順を最大限尊重しつつ、必ず全ノードを並べ切る）。
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
const candName = c => c.algorithm + (c.wrapped ? '(折り返し)' : '');
async function layoutFreeDiagram(modeName, mode, kind, size, warnings) {
  const nodesIn = Array.isArray(mode.nodes) ? mode.nodes : [];
  const edgesIn = Array.isArray(mode.edges) ? mode.edges : [];
  if (nodesIn.length === 0) {
    return { label: mode.label, desc: mode.desc, legend: mode.legend, steps: mode.steps, bounds: { x: 0, y: 0, w: 0, h: 0 }, nodes: [], edges: [] };
  }

  // 辺ラベル（エンジンは 11px 固定・左右余白 9px）が層間やノード間に収まる間隔。
  // ELK にラベル寸法は渡さない（下記コメント参照）が、間隔が 48px のままだと短い辺のラベルが
  // ノードに重なって読めないため、最長ラベルの幅だけ層間を空ける（上限 200px）。
  // 余白 60px = 曲がり角の通路（約 10px）＋ラベルと矢じりの間（LABEL_ARROW_CLEARANCE）＋始点側の余白。
  const maxLabelW = Math.max(0, ...edgesIn.map(e => e.label ? estimateTextWidth(e.label, 11) + 18 : 0));
  const betweenLayers = Math.round(Math.min(240, Math.max(48, maxLabelW + 60)));

  async function attempt(algorithm, wrap) {
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
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(betweenLayers),
      'elk.spacing.edgeNode': '12',
      'elk.spacing.edgeEdge': '10',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=20,left=20,bottom=20,right=20]',
      ...(wrap ? { 'elk.layered.wrapping.strategy': 'MULTI_EDGE', 'elk.aspectRatio': String(FIT_W / FIT_H) } : {}),
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

  // 候補: layered（折り返しなし）/ layered（MULTI_EDGE 折り返し）/ stress。
  // 折り返しは横長になりすぎる鎖状グラフには有効だが、少数ノードが次の段へ送られると
  // そこへ入る辺が図全体を右→左に回り込む。どちらが良いかはグラフ次第なので両方を採点する。
  const candidates = [];
  candidates.push({ algorithm: 'layered', ...(await attempt('layered', false)) });
  candidates.push({ algorithm: 'layered', wrapped: true, ...(await attempt('layered', true)) });
  try { candidates.push({ algorithm: 'stress', ...(await attempt('stress')) }); } catch (e) { warnings.push(`${modeName}: stress レイアウトを試行できませんでした（${e.message}）。layered を使用します`); }

  // 採否は複合スコアで決める（scoreCandidate）: 重なり 0 件必須 → フィットズーム（読める倍率まで）→
  // 交差・辺の回り込み → 総エッジ長、の優先順位。
  candidates.forEach(c => Object.assign(c, scoreCandidate(c.posMap, edgesIn, c.result)));
  const sorted = [...candidates].sort((a, b) => a.score - b.score);
  const chosen = { ...sorted[0], other: sorted[1] || null };

  const nodes = nodesIn.map(n => {
    const p = chosen.posMap.get(n.id);
    const node = { id: n.id, kind, x: p.x, y: p.y, w: p.w, h: p.h };
    Object.keys(n).forEach(k => { if (!['id', 'kind', 'pin'].includes(k)) node[k] = n[k]; });
    node.pin = n.pin;
    return node;
  });
  const nodeRects = [...chosen.posMap.values()];
  const placedLabels = [];
  const edges = (chosen.result.edges || []).map((re, i) => {
    const orig = edgesIn[i];
    const route = flattenSection(re.sections && re.sections[0]);
    const elkLabel = re.labels && re.labels[0];
    return {
      from: orig.from, to: orig.to, label: orig.label, type: orig.type, step: orig.step,
      fromLabel: orig.fromLabel, toLabel: orig.toLabel,
      route: route || [[chosen.posMap.get(orig.from).x, chosen.posMap.get(orig.from).y], [chosen.posMap.get(orig.to).x, chosen.posMap.get(orig.to).y]],
      labelAt: !orig.label ? undefined
        : (elkLabel || !route) ? labelCenterFromElk(re, route) : labelOnRoute(route, orig.label, nodeRects, { placed: placedLabels, endClearance: LABEL_ARROW_CLEARANCE }),
    };
  });

  const finalEdges = applyPins(nodes, edges, null, warnings, modeName);
  const finalNodes = nodes.map(({ pin, ...rest }) => rest);

  const bounds = computeBounds(finalNodes, [], finalEdges);
  return {
    label: mode.label, desc: mode.desc, legend: mode.legend, steps: mode.steps,
    bounds, nodes: finalNodes, edges: finalEdges,
    _algorithm: candName(chosen), _crossings: chosen.crossings, _overlaps: chosen.overlaps,
    _fitZoom: chosen.fit, _other: chosen.other && { algorithm: candName(chosen.other), crossings: chosen.other.crossings, overlaps: chosen.other.overlaps, fitZoom: chosen.other.fit },
  };
}

// ---------- biz（スイムレーン。ELK 不要・決定的） ----------
// レーン×フェーズの固定グリッドへ配置したい（ELK の自動配置だと列がフェーズ境界とずれる）ため、
// ELK は使わず自前で決定的に組む。列（フェーズ内での左右位置）はフェーズごとに独立して、
// type: "weak" を除いた辺で DFS 逆辺検出 → 残った DAG 上を Kahn 法で最長パスランク付けして求める。
// 同じセル（レーン×フェーズ×列）に複数ノードがあれば縦に積む。
const BIZ_HEADER_W = 190;
const BIZ_PHASE_H = 44;
const BIZ_LANE_PAD_Y = 20;
const BIZ_ROW_GAP = 28;
const BIZ_BLOCK_PAD_X = 32;
const BIZ_LANE_MIN_H = 110;
const BIZ_GAP_MIN = 64, BIZ_GAP_MAX = 220, BIZ_GAP_LABEL_PAD = 40;
const BIZ_BLOCK_GAP_X = 80, BIZ_BLOCK_GAP_Y = 64;
const BIZ_FIT_W = 1480, BIZ_FIT_H = 700;
const BIZ_DECISION_LABEL_MIN_DIST = 14;
const BIZ_NODE_SIZE = {
  task: { w: 220, h: 76 },
  system: { w: 220, h: 76 },
  decision: { w: 150, h: 96 },
  start: { w: 190, h: 52 },
  end: { w: 190, h: 52 },
};
function bizNodeSize(variant) { return BIZ_NODE_SIZE[variant] || BIZ_NODE_SIZE.task; }

/** DFS で逆辺（閉路の原因になる辺）を検出する。nodeIds の順（model 順）を探索順にして決定的にする。 */
function detectBizBackEdges(nodeIds, edgeList) {
  const adj = new Map(nodeIds.map(id => [id, []]));
  edgeList.forEach((e, i) => { if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push({ to: e.to, i }); });
  const state = new Map(nodeIds.map(id => [id, 0])); // 0=未訪問 1=探索中 2=完了
  const back = new Set();
  function dfs(u) {
    state.set(u, 1);
    for (const { to, i } of adj.get(u)) {
      const st = state.get(to);
      if (st === 1) back.add(i);
      else if (st === 0) dfs(to);
    }
    state.set(u, 2);
  }
  nodeIds.forEach(id => { if (state.get(id) === 0) dfs(id); });
  return back;
}

/** 後退辺を除いた DAG 上での最長パス順位（列番号。0 起点）を Kahn 法で求める。 */
function computeBizColumnRanks(nodeIds, forwardEdges) {
  const indeg = new Map(nodeIds.map(id => [id, 0]));
  const adj = new Map(nodeIds.map(id => [id, []]));
  forwardEdges.forEach(e => { adj.get(e.from).push(e.to); indeg.set(e.to, indeg.get(e.to) + 1); });
  const rank = new Map(nodeIds.map(id => [id, 0]));
  const q = nodeIds.filter(id => indeg.get(id) === 0);
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (const v of adj.get(u)) {
      if (rank.get(u) + 1 > rank.get(v)) rank.set(v, rank.get(u) + 1);
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  return rank;
}

/** rects から from/to を除いた矩形群を 1px ずつ縮めて返す（境界に乗るだけの接触を重なりとみなさないため）。 */
function shrinkRectsExcluding(rects, excludeIds) {
  const ex = new Set(excludeIds);
  return rects.filter(r => !ex.has(r.id)).map(r => ({ x: r.x + 1, y: r.y + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - 2) }));
}

/** 軸並行の線分 [p1,p2] が矩形 r と重なるか（辺に乗るだけの接触は含まない）。 */
function segmentHitsRect(p1, p2, r) {
  const x1 = Math.min(p1[0], p2[0]), x2 = Math.max(p1[0], p2[0]);
  const y1 = Math.min(p1[1], p2[1]), y2 = Math.max(p1[1], p2[1]);
  return x1 < r.x + r.w && x2 > r.x && y1 < r.y + r.h && y2 > r.y;
}

function countBizRouteHits(route, rects) {
  let n = 0;
  for (let i = 0; i < route.length - 1; i++) {
    for (const r of rects) if (segmentHitsRect(route[i], route[i + 1], r)) n++;
  }
  return n;
}

/**
 * ノード a→b 間の直交ルート候補（CONTRACT §2 の a〜d）を作る。channelUse / corridorUse は
 * 「同じチャンネル x（コリドー y）を使う辺が既に何本あるか」を数える共有カウンター。候補のうち
 * 実際に採用されたものだけが .apply() でカウンターを進める（並行するチャンネルを 10px ずつずらす）。
 */
function buildBizRouteCandidates(a, b, metaA, metaB, channelUse, corridorUse) {
  const aC = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bC = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const left = s => rectBoundary(s, 'left'), right = s => rectBoundary(s, 'right');
  const top = s => rectBoundary(s, 'top'), bottom = s => rectBoundary(s, 'bottom');
  const candidates = [];
  const rightward = bC.x >= aC.x;
  const dy = bC.y - aC.y;

  function takeChannel(xBase) {
    const key = Math.round(xBase / 6);
    const n = channelUse.get(key) || 0;
    return { value: xBase + n * 10, apply: () => channelUse.set(key, n + 1) };
  }
  function takeCorridor(yBase, dir) {
    const key = `${dir}:${Math.round(yBase / 6)}`;
    const n = corridorUse.get(key) || 0;
    return { value: yBase + dir * n * 10, apply: () => corridorUse.set(key, n + 1) };
  }

  if (rightward && Math.abs(dy) < 2) {
    // a) 同じ高さ・右方向: 直線
    const p1 = right(a), p2 = left(b);
    candidates.push({ route: dedupePoints([[p1.x, p1.y], [p2.x, p2.y]]), apply: () => {} });
  }
  if (rightward) {
    const p1 = right(a), p2 = left(b);
    // b) 右側面 → 縦チャンネル（自列の右端 / 相手列の左端の 2 通り） → 左側面
    // チャンネル位置は列の隙間ごとの幅（v2: metaA/metaB が持つ per-gap 幅）から決める
    const gapA = metaA.rightGapW != null ? metaA.rightGapW : BIZ_GAP_MIN;
    const gapB = metaB.leftGapW != null ? metaB.leftGapW : BIZ_GAP_MIN;
    [metaA.colRight + gapA / 2, metaB.colLeft - gapB / 2].forEach(chanXBase => {
      const ch = takeChannel(chanXBase);
      const chanX = ch.value;
      candidates.push({
        route: dedupePoints([[p1.x, p1.y], [chanX, p1.y], [chanX, p2.y], [p2.x, p2.y]]),
        apply: ch.apply,
      });
    });
    // c) 縦優先で出て、対象の高さまで進んでから左側面へ入る
    const exit = dy >= 0 ? bottom(a) : top(a);
    candidates.push({
      route: dedupePoints([[exit.x, exit.y], [exit.x, p2.y], [p2.x, p2.y]]),
      apply: () => {},
    });
  }
  // d) レーン外周のコリドー経由（後退・同列・左方向、および a〜c で重なりが残るときのフォールバック）。
  // レーン上下の余白（LANE_PAD_Y=28）はコリドーのオフセット（10px）より広いため、ノードは常に
  // 自分のレーン内でコリドーより内側にある（下コリドーより上・上コリドーより下）。
  {
    const bottomY = Math.max(metaA.laneY + metaA.laneH, metaB.laneY + metaB.laneH) - 10;
    const cor = takeCorridor(bottomY, 1);
    const p1 = bottom(a), p2 = bottom(b);
    candidates.push({
      route: dedupePoints([[p1.x, p1.y], [p1.x, cor.value], [p2.x, cor.value], [p2.x, p2.y]]),
      apply: cor.apply,
    });
  }
  {
    const topY = Math.min(metaA.laneY, metaB.laneY) + 10;
    const cor = takeCorridor(topY, -1);
    const p1 = top(a), p2 = top(b);
    candidates.push({
      route: dedupePoints([[p1.x, p1.y], [p1.x, cor.value], [p2.x, cor.value], [p2.x, p2.y]]),
      apply: cor.apply,
    });
  }
  return candidates;
}

/** 分岐の辺ラベルは分岐の出口に近い最初の線分の中点に置く（線分が短すぎれば null） */
function decisionLabelAt(route, label) {
  if (!route || route.length < 2) return null;
  const [a, b] = route;
  const horizontal = Math.abs(a[1] - b[1]) < 1;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const need = horizontal ? estimateTextWidth(label, 11) + 18 + 8 : 28;
  if (len < need) return null;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * 全辺のルートを決める。ノード矩形（1px 縮小・自分自身を除く）との交差が無い候補を優先する。
 * nodeVariantById: id -> variant。分岐（decision）から出る辺は、ラベルがノード外周から
 * BIZ_DECISION_LABEL_MIN_DIST(14px) 以上離れるよう labelOnRoute に避けたい矩形として渡す。
 */
function routeBizEdges(edgesIn, nodeRectById, nodeMetaById, nodeVariantById, warnings) {
  const rectsAll = [...nodeRectById.entries()].map(([id, r]) => ({ id, x: r.x, y: r.y, w: r.w, h: r.h }));
  const channelUse = new Map();
  const corridorUse = new Map();
  const out = [];
  // 分岐から出る 2 本目以降の辺は、1 本目（右へ出る）と出口を分けるため縦優先のルートを先に試す。
  // 同じ出口から分かれると、どちらが「はい」「いいえ」か読み取れないため。
  const outIndex = new Map();
  edgesIn.forEach(e => {
    const a = nodeRectById.get(e.from), b = nodeRectById.get(e.to);
    const metaA = nodeMetaById.get(e.from), metaB = nodeMetaById.get(e.to);
    if (!a || !b || !metaA || !metaB) return; // validate.js が既にエラー化する想定
    const decisionOpts = (nodeVariantById && nodeVariantById.get(e.from) === 'decision')
      ? { avoidRect: a, minDist: BIZ_DECISION_LABEL_MIN_DIST } : undefined;
    if (e.from === e.to) {
      const t = rectBoundary(a, 'top');
      const route = dedupePoints([[t.x - 20, t.y], [t.x - 20, t.y - 30], [t.x + 20, t.y - 30], [t.x + 20, t.y]]);
      out.push({ from: e.from, to: e.to, label: e.label, type: e.type, route, labelAt: e.label ? labelOnRoute(route, e.label, rectsAll, decisionOpts) : undefined });
      return;
    }
    const excl = shrinkRectsExcluding(rectsAll, [e.from, e.to]);
    let candidates = buildBizRouteCandidates(a, b, metaA, metaB, channelUse, corridorUse);
    const isDecision = nodeVariantById && nodeVariantById.get(e.from) === 'decision';
    const k = outIndex.get(e.from) || 0;
    outIndex.set(e.from, k + 1);
    if (isDecision && k >= 1) {
      const startsVertical = c => c.route.length >= 2 && Math.abs(c.route[0][0] - c.route[1][0]) < 1;
      candidates = [...candidates.filter(startsVertical), ...candidates.filter(c => !startsVertical(c))];
    }
    let best = null;
    for (const c of candidates) {
      const hits = countBizRouteHits(c.route, excl);
      if (!best || hits < best.hits) best = { ...c, hits };
      if (hits === 0) break;
    }
    best.apply();
    out.push({
      from: e.from, to: e.to, label: e.label, type: e.type,
      route: best.route,
      labelAt: !e.label ? undefined
        : (isDecision && decisionLabelAt(best.route, e.label)) || labelOnRoute(best.route, e.label, rectsAll, decisionOpts),
    });
  });
  return out;
}

/**
 * biz レイアウト v2: フェーズを「独立したスイムレーンのブロック」にして格子詰めする
 * （biz-contract-v2.md）。v1（フェーズを 1 行に横並び）は実データで幅 8453px・倍率 23% まで
 * 落ち込み文字が読めなくなったため、フェーズ単位のブロック（そのフェーズでノードを持つ
 * レーンだけを積んだ自己完結レイアウト）に分割し、ブロックを 1480x700 の想定領域に最も
 * 大きくフィットする列数で格子状に折り返す。フェーズが無い入力は全ノードを 1 ブロック
 * （id "_all"・見出し帯高さ 0）として同じパイプラインに通す（cols は自明に 1）。
 * 辺のルーティング候補（buildBizRouteCandidates）・ラベル配置（labelOnRoute）は v1 のまま
 * （ブロック内で完結する前提。フェーズをまたぐ辺は validate.js が警告する）。
 */
function layoutBiz(biz, warnings) {
  const lanes = Array.isArray(biz.lanes) ? biz.lanes : [];
  const phasesIn = Array.isArray(biz.phases) ? biz.phases : [];
  const nodesIn = Array.isArray(biz.nodes) ? biz.nodes : [];
  const edgesIn = Array.isArray(biz.edges) ? biz.edges : [];
  if (lanes.length === 0) {
    return { label: biz.label, desc: biz.desc, legend: biz.legend, bounds: { x: 0, y: 0, w: 0, h: 0 }, groups: [], phases: [], nodes: [], edges: [] };
  }
  const hasPhases = phasesIn.length > 0;
  const laneIds = lanes.map(l => l.id);
  const validLaneIds = new Set(laneIds);
  const validPhaseIds = new Set(hasPhases ? phasesIn.map(p => p.id) : []);

  const usableNodes = nodesIn.filter(n => n && n.id && validLaneIds.has(n.lane) && (!hasPhases || validPhaseIds.has(n.phase)));
  if (usableNodes.length < nodesIn.length) {
    warnings.push(`biz: lane / phase を解決できないノードが ${nodesIn.length - usableNodes.length} 件あります（表示から除外しました）`);
  }
  if (usableNodes.length === 0) {
    return { label: biz.label, desc: biz.desc, legend: biz.legend, bounds: { x: 0, y: 0, w: 0, h: 0 }, groups: [], phases: [], nodes: [], edges: [] };
  }
  const usableById = new Map(usableNodes.map(n => [n.id, n]));
  const blockOf = n => (hasPhases ? n.phase : '_all');
  const nodeVariantById = new Map(usableNodes.map(n => [n.id, n.variant]));
  const sizeById = new Map(usableNodes.map(n => [n.id, bizNodeSize(n.variant)]));

  // ---- ブロック（フェーズ 1 つ、または phases 無しなら全体で 1 つ）ごとに block-local 座標で組む ----
  const blockDefs = hasPhases ? phasesIn.map(p => ({ id: p.id, label: p.label })) : [{ id: '_all', label: '' }];
  const blocks = blockDefs.map(def => {
    const memberIds = usableNodes.filter(n => blockOf(n) === def.id).map(n => n.id);
    if (memberIds.length === 0) return null;
    const memberSet = new Set(memberIds);

    // 列（後退辺を除いた DAG 上の最長パス順位。type: "weak" は列決定に使わない）
    const relevantEdges = edgesIn.filter(e => e && e.type !== 'weak' && memberSet.has(e.from) && memberSet.has(e.to));
    const backIdx = detectBizBackEdges(memberIds, relevantEdges);
    const forward = relevantEdges.filter((e, i) => !backIdx.has(i));
    const columnOf = computeBizColumnRanks(memberIds, forward);
    const nCols = Math.max(1, ...memberIds.map(id => (columnOf.get(id) || 0) + 1));

    // 列幅（レーン横断で最大）
    const colWidth = new Map();
    memberIds.forEach(id => {
      const col = columnOf.get(id) || 0;
      colWidth.set(col, Math.max(colWidth.get(col) || 0, sizeById.get(id).w));
    });
    // 隙間ごとの幅: 列 c のノードから出る辺のラベル最大幅 + 40（64〜220 にクランプ。ラベルが
    // 無ければ 64 になる = clamp(0+40,64,220)）
    const gapWidths = [];
    for (let c = 0; c < nCols - 1; c++) {
      const fromSet = new Set(memberIds.filter(id => (columnOf.get(id) || 0) === c));
      const maxLabelW = Math.max(0, ...edgesIn.filter(e => e && e.label && fromSet.has(e.from)).map(e => estimateTextWidth(e.label, 11) + 18));
      gapWidths.push(Math.max(BIZ_GAP_MIN, Math.min(BIZ_GAP_MAX, maxLabelW + BIZ_GAP_LABEL_PAD)));
    }
    // 列の開始 x（ブロック左右の内側余白 32）
    const colStartX = new Map();
    // レーン見出し欄（BIZ_HEADER_W）の右から始める（見出しの上にノードを置かない）
    let x = BIZ_HEADER_W + BIZ_BLOCK_PAD_X;
    for (let c = 0; c < nCols; c++) {
      colStartX.set(c, x);
      x += (colWidth.get(c) || 0);
      if (c < nCols - 1) x += gapWidths[c];
    }
    const blockW = x + BIZ_BLOCK_PAD_X;

    // このブロックで使うレーン（lanes[] の順で、ノードを持つものだけ。空レーンは出さない）
    const usedLaneIds = laneIds.filter(lid => memberIds.some(id => usableById.get(id).lane === lid));

    // セル（レーン×列）ごとのノード（model 順で積む）
    const cellMembers = new Map(); // `${lane}|${col}` -> [id,...]
    memberIds.forEach(id => {
      const col = columnOf.get(id) || 0;
      const key = `${usableById.get(id).lane}|${col}`;
      if (!cellMembers.has(key)) cellMembers.set(key, []);
      cellMembers.get(key).push(id);
    });

    // レーン高さ = 2×LANE_PAD_Y(20) + セル内の積み高さの最大、最小 110
    const laneInnerH = new Map(usedLaneIds.map(id => [id, 0]));
    cellMembers.forEach((ids, key) => {
      const laneId = key.slice(0, key.indexOf('|'));
      let h = 0;
      ids.forEach((id, i) => { h += sizeById.get(id).h + (i > 0 ? BIZ_ROW_GAP : 0); });
      laneInnerH.set(laneId, Math.max(laneInnerH.get(laneId) || 0, h));
    });
    const laneHeight = new Map(usedLaneIds.map(id => [id, Math.max(BIZ_LANE_MIN_H, laneInnerH.get(id) + 2 * BIZ_LANE_PAD_Y)]));

    // レーンの y 位置（見出し帯: phases があれば 44、無ければ 0）
    const headerH = hasPhases ? BIZ_PHASE_H : 0;
    const laneY = new Map();
    let curY = headerH;
    usedLaneIds.forEach(id => { laneY.set(id, curY); curY += laneHeight.get(id); });
    const blockH = curY;

    // ノード座標の確定（block-local）
    const localNodes = [];
    const localMeta = new Map();
    cellMembers.forEach((ids, key) => {
      const sep = key.indexOf('|');
      const laneId = key.slice(0, sep);
      const col = Number(key.slice(sep + 1));
      const colX = colStartX.get(col);
      const colW = colWidth.get(col) || 0;
      let stackH = 0;
      ids.forEach((id, i) => { stackH += sizeById.get(id).h + (i > 0 ? BIZ_ROW_GAP : 0); });
      const ly = laneY.get(laneId), lh = laneHeight.get(laneId);
      let y = ly + BIZ_LANE_PAD_Y + Math.max(0, (lh - 2 * BIZ_LANE_PAD_Y - stackH) / 2);
      ids.forEach(id => {
        const n = usableById.get(id);
        const size = sizeById.get(id);
        const xPos = colX + (colW - size.w) / 2;
        localNodes.push({
          id, kind: 'biz', variant: n.variant, lane: n.lane, phase: hasPhases ? n.phase : undefined,
          label: n.label, sub: n.sub, screen: n.screen, spec: n.spec, info: n.info,
          rect: { x: xPos, y, w: size.w, h: size.h },
        });
        localMeta.set(id, {
          laneY: ly, laneH: lh, colLeft: colX, colRight: colX + colW,
          rightGapW: gapWidths[col] !== undefined ? gapWidths[col] : BIZ_GAP_MIN,
          leftGapW: col > 0 ? gapWidths[col - 1] : BIZ_GAP_MIN,
        });
        y += size.h + BIZ_ROW_GAP;
      });
    });

    const localGroups = usedLaneIds.map((lid, i) => {
      const l = lanes.find(x2 => x2.id === lid);
      return {
        id: `${def.id}:${lid}`, lane: lid, phase: hasPhases ? def.id : undefined,
        label: l.label, sub: l.sub, style: 'swimlane',
        rect: { x: 0, y: laneY.get(lid), w: blockW, h: laneHeight.get(lid) },
        headerW: BIZ_HEADER_W, index: i,
      };
    });

    return { id: def.id, label: def.label, w: blockW, h: blockH, headerH, nodes: localNodes, groups: localGroups, meta: localMeta };
  }).filter(Boolean);

  if (blocks.length === 0) {
    return { label: biz.label, desc: biz.desc, legend: biz.legend, bounds: { x: 0, y: 0, w: 0, h: 0 }, groups: [], phases: [], nodes: [], edges: [] };
  }

  // ---- ブロックの格子詰め: 記述順に left→right、cols 個で折り返す。行の高さは行内最大、
  // 列の幅は列内最大ではなく各ブロックの実幅で左詰め。ブロック間の隙間 横 80・縦 64。
  // cols は 1〜ブロック数を総当たりし、想定表示領域 1480x700 に対する倍率が最大のものを採用。
  function packWithCols(cols) {
    const origins = new Map();
    let y = 0, maxRowW = 0;
    for (let i = 0; i < blocks.length; i += cols) {
      const row = blocks.slice(i, i + cols);
      let x = 0, rowH = 0;
      row.forEach(b => {
        origins.set(b.id, { x, y });
        x += b.w + BIZ_BLOCK_GAP_X;
        rowH = Math.max(rowH, b.h);
      });
      maxRowW = Math.max(maxRowW, x - BIZ_BLOCK_GAP_X);
      y += rowH + BIZ_BLOCK_GAP_Y;
    }
    const totalH = Math.max(1, y - BIZ_BLOCK_GAP_Y);
    const totalW = Math.max(1, maxRowW);
    return { origins, w: totalW, h: totalH, fit: Math.min(BIZ_FIT_W / totalW, BIZ_FIT_H / totalH) };
  }
  let bestPack = null, bestCols = 1;
  for (let cols = 1; cols <= blocks.length; cols++) {
    const p = packWithCols(cols);
    if (!bestPack || p.fit > bestPack.fit + 1e-9) { bestPack = p; bestCols = cols; }
  }
  void bestCols;

  // ---- ブロックのグローバル座標へ変換 ----
  const nodes = [];
  const groups = [];
  const phasesOut = [];
  const nodeRectById = new Map();
  const nodeMetaById = new Map();
  blocks.forEach(b => {
    const origin = bestPack.origins.get(b.id);
    b.nodes.forEach(n => {
      const rect = { x: n.rect.x + origin.x, y: n.rect.y + origin.y, w: n.rect.w, h: n.rect.h };
      nodeRectById.set(n.id, rect);
      nodes.push({
        id: n.id, kind: n.kind, variant: n.variant, lane: n.lane, phase: n.phase,
        label: n.label, sub: n.sub, screen: n.screen, spec: n.spec, info: n.info,
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      });
    });
    b.meta.forEach((m, id) => {
      nodeMetaById.set(id, {
        laneY: m.laneY + origin.y, laneH: m.laneH,
        colLeft: m.colLeft + origin.x, colRight: m.colRight + origin.x,
        rightGapW: m.rightGapW, leftGapW: m.leftGapW,
      });
    });
    b.groups.forEach(g => {
      groups.push({
        id: g.id, lane: g.lane, phase: g.phase, label: g.label, sub: g.sub, style: g.style,
        x: g.rect.x + origin.x, y: g.rect.y + origin.y, w: g.rect.w, h: g.rect.h,
        headerW: g.headerW, index: g.index,
      });
    });
    phasesOut.push({
      id: b.id, label: b.label, x: origin.x, y: origin.y, w: b.w, h: b.headerH,
      block: { x: origin.x, y: origin.y, w: b.w, h: b.h },
    });
  });
  // 元の nodes（model 順）を保つ
  const nodeOrderIdx = new Map(nodesIn.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => nodeOrderIdx.get(a.id) - nodeOrderIdx.get(b.id));

  const validEdges = edgesIn.filter(e => e && nodeRectById.has(e.from) && nodeRectById.has(e.to));
  if (validEdges.length < edgesIn.length) {
    warnings.push(`biz: from/to を解決できない辺が ${edgesIn.length - validEdges.length} 件あります（描画から除外しました）`);
  }
  const edges = routeBizEdges(validEdges, nodeRectById, nodeMetaById, nodeVariantById, warnings);

  const phases = hasPhases ? phasesOut : [];
  const bounds = computeBounds(nodes, [...groups, ...phasesOut.map(p => p.block)], edges);
  return { label: biz.label, desc: biz.desc, legend: biz.legend, bounds, groups, phases, nodes, edges };
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
  if (modesIn.biz) {
    t = Date.now();
    modes.biz = layoutBiz(modesIn.biz, warnings);
    timings.biz = Date.now() - t;
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
      } else if (k === 'biz') {
        console.log(`[layout] biz: レーン ${v.groups.length}・フェーズ ${v.phases.length}・ノード ${v.nodes.length}・辺 ${v.edges.length}（bounds ${Math.round(v.bounds.w)}x${Math.round(v.bounds.h)}）`);
      }
    });
    console.log(`[layout] 書き出し: ${path.join(outDir, '.layout.json')}`);
  })().catch(e => { console.error('[layout] 失敗:', e); process.exit(1); });
}
