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
 *   arrange: "groups" のときは ELK を使わず、hubGroup を左端の列、他のグループを 1 ブロック
 *   ずつ段（最長経路）で並べた格子に決定的に置く（arrangeFlowByGroups）。
 * - gallery: ELK 不要。group 順・screens 順の格子。arrange: "table" のときは 1 画面 1 行の表
 *   （サムネイル・ID・画面名・概要・利用者・実装状況。layoutGalleryTable）。
 * - biz: ELK 不要。アクター（lanes）を列、業務内容（phases）を行にした 1 枚の表に、行の中を
 *   上→下の段で並べる（layoutSwimlane。詳細は同関数のコメントを参照）。
 * - jobflow: biz と同じスイムレーン配置（layoutSwimlane）。ノードの kind が 'job' になり、関連画面の
 *   代わりに関連バッチ（batch）を持つ。
 * - gallery: batches[]（バッチ機能）は画面のグループの後ろに、バッチのセクション（ブロック）として並べる。
 * - dfd（arrange: "steps"）: steps ごとに辺と両端のノードだけの小さな図（外部実体 | プロセス |
 *   データストアの 3 列・曲線）を作り、ブロックを格子に詰める（layoutDfdBySteps / layoutDfdColumns）。
 * - concept / dfd: ELK layered(RIGHT・wrapping) と stress を両方試し、フィットズーム最大
 *   （重なり 0 件必須）→ 交差最小 → 総エッジ長最小の複合スコアで採用する方を選ぶ。
 * - er: ELK layered(RIGHT)。FK 辺は行位置に固定した FIXED_POS ポートで接続。
 * - arch: containers[] の入れ子の枠を ELK の複合ノードにし、hierarchyHandling: INCLUDE_CHILDREN で
 *   枠の中と外をまとめて 1 回で解く（layoutArch）。枠は groups[]（style: "arch"）として出力する。
 *   type: "weak" の辺は ELK に渡さず（層の決定に使わず）、配置後に直交ルートを引くだけにする。
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
  // opts.preferVertical: 縦の線分を優先する（上→下に流れる構成図。既定は横の線分を優先）。
  // ラベルは白い角丸の下地付きで描かれるので、縦線の上に置いても線と重ならない。
  // opts.offsetSteps: 線の上に置くとどうしてもノード・枠に重なるとき、線と直角の向きへ
  // この距離（px の配列。両向きに試す）だけずらした位置も候補にする（線の脇にラベルを置く）。
  // ずらすほど減点するので、線の上に置ける場所があればそちらが、無ければ近い方のずらし位置が選ばれる。
  const placed = opts && opts.placed;
  const endClear = (opts && opts.endClearance) || 0;
  const preferVertical = !!(opts && opts.preferVertical);
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
      // 線と直角の向きへずらす量（0 と、指定された各距離の両向き）
      const offs = [0];
      ((opts && opts.offsetSteps) || []).forEach(m => { offs.push(-m, m); });
      [0.5, 0.3, 0.7, 0.15, 0.85].forEach(t => {
        const d = fits ? Math.min(s1, Math.max(s0, len * t)) : len / 2;
        const u = d / len;
        const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        offs.forEach(off => {
          const c = horizontal ? [p[0], p[1] + off] : [p[0] + off, p[1]];
          cands.push({ c, fits, t, off });
        });
      });
    }
    for (const cand of cands) {
      const c = cand.c;
      const hits = rects.some(r => hitsRect(c, r, 0));
      const near = avoidRect ? distToRect(c, avoidRect) < minDist : false;
      const collide = placed ? placed.some(r => hitsRect(c, r, 4)) : false;
      const preferred = preferVertical ? !horizontal : horizontal;
      const score = (hits ? 0 : 1e6) + (collide ? 0 : 5e5) + (near ? 0 : 3e5) + (preferred ? 1e5 : 0)
        + Math.max(0, 2e4 - Math.abs(cand.off || 0) * 100) + (cand.fits ? 5e4 : 0)
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
const GALLERY_PX = { title: 26, header: 34, gutterX: 18, groupGapX: 40, groupGapY: 40, pad: 16 };
const GALLERY_BASE = { title: 160, header: 130, gutterX: 120, groupGapX: 100, groupGapY: 100, pad: 120 };
// 画面名はサムネイルが画面上でこの幅以上のときだけ描く（engine/js/08-draw-nodes.js の SCREEN_HEAD_MIN_W と揃える）。
// 画面数が多く全体表示の倍率が小さいとき、隙間を全体表示の倍率で決めると隙間が画面幅の半分を超え、
// サムネイルが小さく見えた。画面名が出る倍率より小さい倍率では隙間を広げない。
const GALLERY_HEAD_MIN_W = 90;

function buildGalleryLayout(blocks, cellW, cellH, R, shelfCols, k) {
  const g = {};
  const kGap = Math.max(k, GALLERY_HEAD_MIN_W / cellW);
  Object.keys(GALLERY_PX).forEach(key => { g[key] = Math.max(GALLERY_BASE[key], GALLERY_PX[key] / kGap); });
  const nodes = [], outGroups = [];
  let shelfX = 0, shelfY = 0, shelfH = 0, shelfUsedCols = 0;
  blocks.forEach(b => {
    const cols = Math.max(1, Math.ceil(b.items.length / R));
    const rows = Math.ceil(b.items.length / cols);
    if (shelfUsedCols > 0 && shelfUsedCols + cols > shelfCols) {
      shelfY += shelfH + g.groupGapY; shelfX = 0; shelfH = 0; shelfUsedCols = 0;
    }
    // 行の高さはその行で最も高い画面に合わせる（全画面共通の最大高にすると、縦長の画面が 1 枚あるだけで
    // 他の行の下が大きく空く）
    const rowH = [];
    b.items.forEach((s, idx) => { const r = Math.floor(idx / cols); rowH[r] = Math.max(rowH[r] || 0, s.h || DEFAULT_SCREEN_H); });
    const rowY = [];
    rowH.forEach((h, r) => { rowY[r] = r === 0 ? 0 : rowY[r - 1] + rowH[r - 1] + g.title; });
    const bw = g.pad * 2 + cols * cellW + (cols - 1) * g.gutterX;
    const bh = g.header + rowH.reduce((s, h) => s + h, 0) + (rows - 1) * g.title + g.pad;
    b.items.forEach((s, idx) => {
      const r = Math.floor(idx / cols), c = idx % cols;
      nodes.push({
        id: s.id, kind: b.kind || 'screen', group: b.id,
        x: shelfX + g.pad + c * (cellW + g.gutterX),
        y: shelfY + g.header + rowY[r],
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
  // バッチ機能は画面のグループの後ろに並べる（サムネイルが無いので画面と同じ大きさのカードで描く）
  batchSections(model).forEach(sec => {
    blocks.push({ id: sec.id, label: sec.label, kind: 'batch', items: sec.items.map(b => ({ id: b.id, w: DEFAULT_SCREEN_W, h: DEFAULT_SCREEN_H })) });
  });
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

// ---------- gallery（arrange: "table"。表形式の機能一覧） ----------
// 1 画面 1 行の表: サムネイル | ID | 画面名 | 概要（purpose） | 利用者（role） | 実装状況（status）。
// batches[] があれば画面のセクションの後ろにバッチのセクションを足す（サムネイルの代わりにカード、利用者の代わりに schedule）。
// groups[].order 順の見出し行（セクション）で区切る。文字はワールド座標の大きさで描き（ズームに比例）、
// 行の高さはサムネイルの高さと、各列の文字を列幅で折り返したときの行数の大きい方で決める。
// サムネイルは画面ノードそのもの（クリックで詳細パネル）で、縦横比を保ったまま最大 GT_THUMB_W×GT_THUMB_H に収める。
const SCREEN_STATUSES = {
  done: { label: '実装済', tone: 'green' },
  wip: { label: '実装中', tone: 'blue' },
  designed: { label: '設計済・未実装', tone: 'amber' },
  planned: { label: '未着手', tone: 'slate' },
};
const GT_THUMB_W = 220, GT_THUMB_H = 150;
const GT_PAD_X = 18, GT_PAD_Y = 14;
const GT_HEADER_H = 44, GT_SECTION_H = 48;
const GT_COLUMNS = [
  { key: 'thumb', label: '画面イメージ', w: GT_THUMB_W + GT_PAD_X * 2 },
  { key: 'id', label: 'ID', w: 110, px: 14, lineH: 21, weight: '700' },
  { key: 'title', label: '画面名', w: 210, px: 16, lineH: 24, weight: '700' },
  { key: 'purpose', label: '概要', w: 540, px: 15, lineH: 24, weight: '400' },
  { key: 'role', label: '利用者', w: 210, px: 14, lineH: 21, weight: '400' },
  { key: 'status', label: '実装状況', w: 160 },
];

// バッチ機能の行の画面イメージ列に置くカード（サムネイルの代わり）
const GT_BATCH_W = 220, GT_BATCH_H = 120;

/**
 * batches[] を機能一覧のセクションに分ける。group が groups[] にあればそのグループごとに
 * 「<グループ名>（バッチ）」、無ければまとめて「バッチ機能」。groups[].order 順で、画面のセクションの後ろに置く。
 */
function batchSections(model) {
  const batches = (model.batches || []).filter(b => b && b.id);
  const groups = [...(model.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const known = new Set(groups.map(g => g.id));
  const sections = groups.map(g => ({ id: `batch:${g.id}`, label: `${g.label}（バッチ）`, items: batches.filter(b => b.group === g.id) }));
  sections.push({ id: 'batch:__all__', label: 'バッチ機能', items: batches.filter(b => !b.group || !known.has(b.group)) });
  return sections.filter(s => s.items.length > 0);
}

/** 文字列を幅 w（ワールド px）・文字サイズ px で折り返したときの行数の見積もり */
function estimateWrapLines(text, px, w) {
  let lines = 1, cur = 0;
  for (const ch of String(text || '')) {
    const cw = (ch.charCodeAt(0) > 0xff ? 1 : 0.58) * px;
    if (cur + cw > w && cur > 0) { lines++; cur = cw; } else cur += cw;
  }
  return lines;
}

function layoutGalleryTable(model, warnings) {
  const screens = model.screens || [];
  const groups = [...(model.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const known = new Set(groups.map(g => g.id));
  const sectionDefs = groups.map(g => ({ id: g.id, label: g.label }));
  if (screens.some(s => !s.group || !known.has(s.group))) {
    sectionDefs.push({ id: '__unassigned__', label: '(未分類)' });
    warnings.push('gallery: group 未設定の画面を (未分類) セクションに配置しました');
  }
  // バッチ機能がある表は、列の名前を画面とバッチの両方に合う名前にする（利用者の列はバッチでは起動のタイミング）
  const bSections = batchSections(model);
  const columnLabels = bSections.length ? { thumb: 'イメージ', title: '名称', role: '利用者／起動' } : {};
  let x = 0;
  const columns = GT_COLUMNS.map(c => { const col = { ...c, x, label: columnLabels[c.key] || c.label }; x += c.w; return col; });
  const tableW = x;
  const nodes = [], rows = [], sections = [];
  let y = GT_HEADER_H;
  const pushSection = (def, items, opts) => {
    if (items.length === 0) return;
    const counts = {};
    items.forEach(s => { if (s.status) counts[s.status] = (counts[s.status] || 0) + 1; });
    sections.push({ id: def.id, label: def.label, y, h: GT_SECTION_H, count: items.length, unit: opts.unit, counts });
    y += GT_SECTION_H;
    items.forEach(s => {
      let tw, th;
      if (opts.kind === 'batch') {
        tw = GT_BATCH_W; th = GT_BATCH_H;
      } else {
        const sw = s.w || DEFAULT_SCREEN_W, sh = s.h || DEFAULT_SCREEN_H;
        const scale = Math.min(GT_THUMB_W / sw, GT_THUMB_H / sh);
        tw = sw * scale; th = sh * scale;
      }
      const role = opts.kind === 'batch' ? (s.schedule || '') : (s.role || '');
      let textH = 0;
      columns.forEach(c => {
        if (!c.px) return;
        const text = c.key === 'id' ? s.id : (c.key === 'role' ? role : s[c.key]);
        textH = Math.max(textH, estimateWrapLines(text, c.px, c.w - GT_PAD_X * 2) * c.lineH);
      });
      const rowH = Math.ceil(Math.max(th, textH, 28) + GT_PAD_Y * 2);
      nodes.push({
        id: s.id, kind: opts.kind, group: def.id, table: true,
        x: columns[0].x + (columns[0].w - tw) / 2, y: y + (rowH - th) / 2, w: tw, h: th,
      });
      if (s.status && !SCREEN_STATUSES[s.status]) warnings.push(`gallery: ${opts.kind === 'batch' ? 'batches' : 'screens'}.${s.id}.status が未知です: ${s.status}`);
      rows.push({ id: s.id, section: def.id, y, h: rowH, title: s.title || '', purpose: s.purpose || '', role, status: s.status || null });
      y += rowH;
    });
  };
  sectionDefs.forEach(def => {
    pushSection(def, screens.filter(s => (s.group && known.has(s.group) ? s.group : '__unassigned__') === def.id), { kind: 'screen', unit: '画面' });
  });
  bSections.forEach(sec => pushSection(sec, sec.items, { kind: 'batch', unit: 'バッチ' }));
  const table = { x: 0, y: 0, w: tableW, h: y, headerH: GT_HEADER_H, padX: GT_PAD_X, padY: GT_PAD_Y, columns, sections, rows, statuses: SCREEN_STATUSES };
  const bounds = computeBounds(nodes, [table], []);
  // 表は縦に長いので、全体表示は表の幅に合わせて上端から見せる（fit: "width"）。文字が読める等倍まで拡大してよい
  return { nodes, groups: [], edges: [], table, fit: 'width', maxK: 1, bounds };
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
function routeCurves(edgesIn, rectOf, opts) {
  const unit = (opts && opts.unit) || ELK_UNIT;
  const horizontalOnly = !!(opts && opts.horizontal);
  const plans = edgesIn.map((e, i) => {
    const a = rectOf.get(e.from), b = rectOf.get(e.to);
    if (!a || !b) return null;
    if (e.from === e.to) return { i, e, a, b, self: true, sides: ['top', 'right'] };
    // horizontal: 列に並べた図（dfd の arrange: "steps"）は縦に離れていても左右から出入りさせる
    const sides = horizontalOnly
      ? ((b.x + b.w / 2) >= (a.x + a.w / 2) ? ['right', 'left'] : ['left', 'right'])
      : curveSides(a, b);
    return { i, e, a, b, sides };
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
    const c = Math.max(90 * unit, dist * 0.42);
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

// arrange: "groups" の間隔（参照 px。ワールドでは ELK_UNIT 倍）
const ARRANGE_GAP = { col: 300, row: 200, cell: 90, hub: 420, framePad: 60, frameTop: 70 };
const ARRANGE_RANK_IGNORE = new Set(['weak', 'nav', 'rel']);

/**
 * arrange: "groups"（グループ行＋ハブ列の格子配置）。ELK を使わず決定的に置く。
 * 60 画面規模のハブ型（メニューから多機能へ分かれ、機能内に戻り・エラーの循環がある）を 1 回の
 * ELK layered で解くと、循環で層が入れ替わり縦長の塊になって読めないため。
 * - hubGroup の要素は左端に横 1 列（全体の高さの中央）、他のグループは order 順に 1 行ずつ
 * - 行内の列 = 同じグループ内の「前向きの辺」だけで測った最長経路の段数。前向きでない辺
 *   （weak / nav / rel、既定で非表示の type、記述順で後ろ → 前）は使わない
 * - 列の x は全行で揃える。同じ行・同じ段の要素は記述順に縦に積む
 * items は attachTo で後置きするものを除いた要素（記述順）。戻り値 { posOf, groups }
 */
function arrangeFlowByGroups(model, flow, items, edges) {
  const U = ELK_UNIT;
  const G = Object.fromEntries(Object.entries(ARRANGE_GAP).map(([k, v]) => [k, v * U]));
  const hidden = new Set((flow.toggles || []).filter(t => t && t.default === false).map(t => t.type));
  const groupsIn = [...(model.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const groupOf = new Map();
  (model.screens || []).forEach(s => groupOf.set(s.id, s.group));
  (flow.nodes || []).forEach(n => groupOf.set(n.id, n.group));
  const known = new Set(groupsIn.map(g => g.id));
  const gid = id => (known.has(groupOf.get(id)) ? groupOf.get(id) : '__unassigned__');
  const orderIdx = new Map(items.map((it, i) => [it.id, i]));

  // 段数（最長経路）。前向きの辺だけを使うので DAG になり、記述順に 1 回なめれば求まる
  const rank = new Map(items.map(it => [it.id, 0]));
  const forward = edges.filter(e => orderIdx.has(e.from) && orderIdx.has(e.to)
    && gid(e.from) === gid(e.to) && orderIdx.get(e.from) < orderIdx.get(e.to)
    && !ARRANGE_RANK_IGNORE.has(e.type) && !hidden.has(e.type));
  const outOf = new Map();
  forward.forEach(e => { if (!outOf.has(e.from)) outOf.set(e.from, []); outOf.get(e.from).push(e.to); });
  items.forEach(it => (outOf.get(it.id) || []).forEach(to => rank.set(to, Math.max(rank.get(to), rank.get(it.id) + 1))));

  const rowIds = groupsIn.map(g => g.id).filter(id => id !== flow.hubGroup);
  if (items.some(it => gid(it.id) === '__unassigned__')) rowIds.push('__unassigned__');
  const labelOf = new Map(groupsIn.map(g => [g.id, g.label]));
  labelOf.set('__unassigned__', '(未分類)');

  // セル（group × 段）ごとに記述順で積む
  const cells = new Map(); // gid -> Map(rank -> items[])
  items.forEach(it => {
    const g = gid(it.id);
    if (!cells.has(g)) cells.set(g, new Map());
    const row = cells.get(g), r = rank.get(it.id);
    if (!row.has(r)) row.set(r, []);
    row.get(r).push(it);
  });
  const stackH = list => list.reduce((s, it) => s + it.h, 0) + G.cell * (list.length - 1);
  const stackW = list => Math.max(...list.map(it => it.w));

  // 格子の列幅（全行で共通）
  const colW = [];
  rowIds.forEach(g => (cells.get(g) || new Map()).forEach((list, r) => { colW[r] = Math.max(colW[r] || 0, stackW(list)); }));
  const colX = [];
  let cx = 0;
  for (let r = 0; r < colW.length; r++) { colX[r] = cx; cx += (colW[r] || 0) + G.col; }

  // グループのブロック（枠の内側を原点とした寸法）
  const blocks = rowIds.filter(g => cells.has(g)).map(g => {
    const row = cells.get(g);
    let rowH = 0, maxX = 0;
    row.forEach((list, r) => { rowH = Math.max(rowH, stackH(list)); maxX = Math.max(maxX, colX[r] + colW[r]); });
    return { g, row, w: maxX + G.framePad * 2, h: G.frameTop + rowH + G.framePad };
  });

  // ハブ列の寸法
  const hub = flow.hubGroup && cells.get(flow.hubGroup);
  const hubRanks = hub ? [...hub.keys()].sort((a, b) => a - b) : [];
  const hubWidths = hubRanks.map(r => stackW(hub.get(r)));
  const hubW = hub ? hubWidths.reduce((s, w) => s + w, 0) + G.col * (hubRanks.length - 1) : 0;
  const hubH = hub ? Math.max(...hubRanks.map(r => stackH(hub.get(r)))) : 0;

  // ブロックを記述順のまま K 本の縦の段に分ける（各段の高さの最大を小さくする貪欲分割）。
  // K は全体表示の倍率が最大になるものを選ぶ（表示領域は横長なので縦 1 本では小さくなりすぎる）
  const colGapBlocks = G.row;
  const splitInto = K => {
    const total = blocks.reduce((s, b) => s + b.h + G.row, 0);
    const target = total / K;
    const cols = [[]];
    let acc = 0;
    blocks.forEach(b => {
      if (cols[cols.length - 1].length && acc + b.h / 2 > target && cols.length < K) { cols.push([]); acc = 0; }
      cols[cols.length - 1].push(b);
      acc += b.h + G.row;
    });
    return cols;
  };
  let best = null;
  for (let K = 1; K <= Math.max(blocks.length, 1); K++) {
    const cols = splitInto(K);
    const widths = cols.map(c => Math.max(0, ...c.map(b => b.w)));
    const gridW = widths.reduce((s, w) => s + w, 0) + (cols.length - 1) * colGapBlocks;
    const gridH = Math.max(0, ...cols.map(c => c.reduce((s, b) => s + b.h, 0) + G.row * (c.length - 1)));
    const w = gridW + (hub ? hubW + G.hub + G.framePad * 2 : 0), h = Math.max(gridH, hubH);
    const z = fitZoom({ w, h });
    if (!best || z > best.z * 1.0001) best = { z, cols, widths };
  }

  const posOf = new Map();
  const groups = [];
  let totalH = 0, ox = 0;
  (best ? best.cols : []).forEach((col, ci) => {
    if (ci > 0) ox += best.widths[ci - 1] + colGapBlocks;
    let y = 0;
    col.forEach(b => {
      const top = y + G.frameTop;
      b.row.forEach((list, r) => {
        let yy = top;
        list.forEach(it => {
          posOf.set(it.id, { id: it.id, x: ox + colX[r] + (colW[r] - it.w) / 2, y: yy });
          yy += it.h + G.cell;
        });
      });
      groups.push({ id: b.g, label: labelOf.get(b.g), x: ox - G.framePad, y, w: b.w, h: b.h });
      y += b.h + G.row;
    });
    totalH = Math.max(totalH, y - G.row);
  });

  // ハブ列: 段数順に左へ並べ、格子全体の高さの中央に置く
  if (hub) {
    const ranks = hubRanks, widths = hubWidths;
    let hx = -G.framePad - G.hub - hubW;
    let hubTop = Infinity, hubBottom = -Infinity;
    ranks.forEach((r, i) => {
      const list = hub.get(r);
      let yy = (totalH - stackH(list)) / 2;
      list.forEach(it => {
        posOf.set(it.id, { id: it.id, x: hx + (widths[i] - it.w) / 2, y: yy });
        hubTop = Math.min(hubTop, yy); hubBottom = Math.max(hubBottom, yy + it.h);
        yy += it.h + G.cell;
      });
      hx += widths[i] + G.col;
    });
    groups.push({
      id: flow.hubGroup, label: labelOf.get(flow.hubGroup),
      x: -G.framePad - G.hub - hubW - G.framePad, y: hubTop - G.frameTop,
      w: hubW + G.framePad * 2, h: hubBottom - hubTop + G.frameTop + G.framePad,
    });
  }
  return { posOf, groups };
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

  const byGroups = flow.arrange === 'groups';
  let result = { children: [], edges: [] }, posOf, outGroups = [];
  if (byGroups) {
    ({ posOf, groups: outGroups } = arrangeFlowByGroups(model, flow, elkItems, edges));
  } else {
    const graph = {
      id: 'root',
      layoutOptions: elkFlowOptions(edgeStyle, flow.layoutOptions),
      children: elkItems.map(it => ({ id: it.id, width: it.w, height: it.h })),
      edges: elkEdges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
    };
    result = await runElk(graph);
    posOf = new Map(result.children.map(c => [c.id, c]));
  }

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
    // （arrange: "groups" は ELK の経路が無いので全辺を単純ルートにする）
    const moved = new Set(items.filter(it => byGroups || it.nudge || attached.has(it.id)).map(it => it.id));
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

  const bounds = computeBounds(nodes, outGroups, outEdges);
  return {
    label: flow.label, desc: flow.desc, legend: flow.legend, toggles: flow.toggles, steps: flow.steps,
    layout: 'elk', edgeStyle, unit: U,
    bounds, groups: outGroups, nodes, edges: outEdges,
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

// ---------- dfd（arrange: "steps"。ステップごとのブロックに分けて描く） ----------
// 共有データストア（受注など）が多数のプロセスとつながる DFD を 1 枚で解くと、長い辺が図全体を
// 横切って交差が 50 を超え読めなかった。DFD の慣習（同じデータストア・外部実体を複数箇所に描く
// 重複記号）に倣い、ステップごとに「そのステップの辺と両端のノード」だけで小さな図を作る。
// 複数ステップに出るノードはブロックごとに複製し、id は `<元の id>@<ステップ番号>` にする
// （baseId に元の id を持つ）。ブロックは記述順に格子へ詰め、列数は全体表示の倍率が最大のものを選ぶ。
const DFD_STEP_GAP = { col: 120, row: 110, pad: 30, top: 56 };
const DFD_COL_NODE_GAP = 34;

/**
 * ステップ 1 つ分の小さな DFD を 3 列（外部実体 | プロセス | データストア）に置く。
 * 列の中の並びは隣の列の重心で数回並べ替えて交差を減らし、各ノードは隣接ノードの重心の高さを
 * 目標に、重ならないよう上から詰める。辺は左右から出入りする曲線、ラベルは曲線上で他のラベル・
 * ノードと重ならない位置（t = 0.5 付近から順に試す）に置く。
 */
function layoutDfdColumns(sub) {
  const colOf = n => (n.variant === 'ext' ? 0 : n.variant === 'store' ? 2 : 1);
  const present = [0, 1, 2].filter(c => sub.nodes.some(n => colOf(n) === c));
  const cols = present.map(c => sub.nodes.filter(n => colOf(n) === c));
  const colIdx = new Map();
  cols.forEach((list, ci) => list.forEach(n => colIdx.set(n.id, ci)));
  const adj = new Map(sub.nodes.map(n => [n.id, new Set()]));
  sub.edges.forEach(e => { if (adj.has(e.from) && adj.has(e.to) && e.from !== e.to) { adj.get(e.from).add(e.to); adj.get(e.to).add(e.from); } });

  // 列間は最長ラベルが収まる幅
  const maxLabelW = Math.max(0, ...sub.edges.map(e => (e.label ? estimateTextWidth(e.label, 11) + 18 : 0)));
  const gapX = Math.round(Math.min(360, Math.max(200, maxLabelW + 90)));

  // 並び順: 隣接ノードの位置（列内の順位）の重心で数回並べ替える
  const pos = new Map();
  const reindex = () => cols.forEach(list => list.forEach((n, i) => pos.set(n.id, i)));
  reindex();
  for (let iter = 0; iter < 6; iter++) {
    const order = iter % 2 === 0 ? cols.map((_, i) => i) : cols.map((_, i) => cols.length - 1 - i);
    order.forEach(ci => {
      const bary = n => {
        const ns = [...adj.get(n.id)].filter(id => colIdx.get(id) !== ci);
        return ns.length ? ns.reduce((s, id) => s + pos.get(id), 0) / ns.length : pos.get(n.id);
      };
      cols[ci] = cols[ci].map((n, i) => ({ n, k: bary(n), i })).sort((a, b) => (a.k - b.k) || (a.i - b.i)).map(x => x.n);
      reindex();
    });
  }

  // 高さ: 最も長い列を基準に等間隔で置き、他の列は隣接ノードの重心の高さを目標に詰める
  const pitch = DFD_H + DFD_COL_NODE_GAP;
  const y = new Map();
  const longest = cols.reduce((bi, list, i) => (list.length > cols[bi].length ? i : bi), 0);
  cols[longest].forEach((n, i) => y.set(n.id, i * pitch));
  const placeCol = ci => {
    const want = cols[ci].map(n => {
      const ns = [...adj.get(n.id)].filter(id => y.has(id) && colIdx.get(id) !== ci);
      return ns.length ? ns.reduce((s, id) => s + y.get(id), 0) / ns.length : 0;
    });
    // 目標の高さを保ちつつ重なりを解消（上から詰めてから、はみ出しを下から戻す）
    const ys = [];
    want.forEach((w, i) => { ys[i] = i === 0 ? w : Math.max(w, ys[i - 1] + pitch); });
    const shift = Math.max(0, (ys[ys.length - 1] - want[want.length - 1]) / 2);
    for (let i = ys.length - 1; i >= 0; i--) {
      ys[i] -= shift;
      if (i < ys.length - 1) ys[i] = Math.min(ys[i], ys[i + 1] - pitch);
    }
    cols[ci].forEach((n, i) => y.set(n.id, ys[i]));
  };
  const others = cols.map((_, i) => i).filter(i => i !== longest).sort((a, b) => Math.abs(a - longest) - Math.abs(b - longest));
  others.forEach(placeCol);

  const nodes = [];
  cols.forEach((list, ci) => list.forEach(n => {
    const node = { ...n, kind: 'dfd', x: ci * (DFD_W + gapX), y: y.get(n.id), w: DFD_W, h: DFD_H };
    delete node.pin;
    nodes.push(node);
  }));
  const rectOf = new Map(nodes.map(n => [n.id, n]));
  const curves = routeCurves(sub.edges, rectOf, { unit: 0.5, horizontal: true });

  // ラベル位置: 曲線上で他のラベル・ノードに重ならない t を選ぶ（ステップを選んで寄ったときの倍率を想定し、やや大きめに見積もる）
  const placed = [];
  const hit = (r, s) => r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y;
  curves.forEach(c => {
    if (!c.label) return;
    const w = (estimateTextWidth(c.label, 11) + 18) * 1.25, h = 20 * 1.25;
    const ts = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
    let chosen = null;
    for (const t of ts) {
      const p = bezierPoint(c.route, t);
      const r = { x: p[0] - w / 2, y: p[1] - h / 2, w, h };
      if (!placed.some(s => hit(r, s)) && !nodes.some(n => hit(r, n))) { chosen = r; c.labelAt = p; break; }
    }
    if (!chosen) { const p = bezierPoint(c.route, 0.5); chosen = { x: p[0] - w / 2, y: p[1] - h / 2, w, h }; c.labelAt = p; }
    placed.push(chosen);
  });
  // 枠はノードとラベルで決める（ベジェの制御点は曲線の外に出るので含めない）
  const boxes = nodes.concat(placed);
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { nodes, edges: curves, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
async function layoutDfdBySteps(mode, warnings) {
  const nodesIn = Array.isArray(mode.nodes) ? mode.nodes : [];
  const edgesIn = Array.isArray(mode.edges) ? mode.edges : [];
  const steps = Array.isArray(mode.steps) ? mode.steps : [];
  const nodeById = new Map(nodesIn.map(n => [n.id, n]));
  const stepNums = new Set(steps.map(s => s.n));

  const parts = steps.map(s => ({ key: s.n, label: `${s.n}. ${s.title || ''}`, edges: edgesIn.filter(e => e.step === s.n) }));
  const rest = edgesIn.filter(e => !stepNums.has(e.step));
  const used = new Set(edgesIn.flatMap(e => [e.from, e.to]));
  const isolated = nodesIn.filter(n => !used.has(n.id));
  if (rest.length || isolated.length) {
    if (rest.length) warnings.push(`dfd: step の無い辺が ${rest.length} 本あります（「ステップなし」のブロックに描きます）`);
    parts.push({ key: null, label: 'ステップなし', edges: rest, extraNodes: isolated });
  }

  const blocks = [];
  for (const part of parts) {
    const suffix = part.key == null ? '@-' : `@${part.key}`;
    const ids = [];
    part.edges.forEach(e => [e.from, e.to].forEach(id => { if (nodeById.has(id) && !ids.includes(id)) ids.push(id); }));
    (part.extraNodes || []).forEach(n => ids.push(n.id));
    if (ids.length === 0) continue;
    // 記述順（nodes[] の順）で ELK に渡す
    ids.sort((a, b) => nodesIn.indexOf(nodeById.get(a)) - nodesIn.indexOf(nodeById.get(b)));
    const sub = {
      nodes: ids.map(id => ({ ...nodeById.get(id), id: id + suffix, baseId: id })),
      edges: part.edges.filter(e => nodeById.has(e.from) && nodeById.has(e.to)).map(e => ({ ...e, from: e.from + suffix, to: e.to + suffix })),
    };
    const r = layoutDfdColumns(sub);
    const b = r.bounds;
    blocks.push({ part, r, w: b.w + DFD_STEP_GAP.pad * 2, h: b.h + DFD_STEP_GAP.top + DFD_STEP_GAP.pad });
  }

  // 列数を総当たりし、全体表示の倍率が最大になるものを選ぶ
  let best = null;
  for (let cols = 1; cols <= Math.max(1, blocks.length); cols++) {
    const colW = [], rowH = [];
    blocks.forEach((b, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      colW[c] = Math.max(colW[c] || 0, b.w); rowH[r] = Math.max(rowH[r] || 0, b.h);
    });
    const w = colW.reduce((s, v) => s + v, 0) + DFD_STEP_GAP.col * (colW.length - 1);
    const h = rowH.reduce((s, v) => s + v, 0) + DFD_STEP_GAP.row * (rowH.length - 1);
    const z = fitZoom({ w, h });
    if (!best || z > best.z * 1.0001) best = { z, cols, colW, rowH };
  }

  const nodes = [], edges = [], groups = [];
  blocks.forEach((b, i) => {
    const c = i % best.cols, r = Math.floor(i / best.cols);
    const gx = best.colW.slice(0, c).reduce((s, v) => s + v + DFD_STEP_GAP.col, 0);
    const gy = best.rowH.slice(0, r).reduce((s, v) => s + v + DFD_STEP_GAP.row, 0);
    const dx = gx + DFD_STEP_GAP.pad - b.r.bounds.x, dy = gy + DFD_STEP_GAP.top - b.r.bounds.y;
    b.r.nodes.forEach(n => nodes.push({ ...n, x: n.x + dx, y: n.y + dy }));
    b.r.edges.forEach(e => edges.push({
      ...e,
      route: e.route && e.route.map(([x, y]) => [x + dx, y + dy]),
      labelAt: e.labelAt && [e.labelAt[0] + dx, e.labelAt[1] + dy],
    }));
    groups.push({ id: `step:${b.part.key == null ? '-' : b.part.key}`, label: b.part.label, step: b.part.key, x: gx, y: gy, w: b.w, h: b.h });
  });

  return {
    label: mode.label, desc: mode.desc, legend: mode.legend, steps: mode.steps, arrange: 'steps',
    bounds: computeBounds(nodes, groups, []), groups, nodes, edges,
  };
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
// 横軸がアクター（lanes[] の列。左→右）、縦軸が業務内容（phases[] の行。上→下）の 1 枚の表に置く。
// ELK の自動配置だとノードが列・行の境界とずれるため、ELK は使わず自前で決定的に組む。
// 流れは上→下。行（フェーズ）の中の段は、type: "weak" を除いた辺で DFS 逆辺検出 → 残った DAG 上を
// Kahn 法で最長パスランク付けして求める。同じセル（列×フェーズ×段）に複数ノードがあれば横に並べる。
const BIZ_PHASE_HEADER_W = 170;   // 左端のフェーズ見出し欄
const BIZ_LANE_HEADER_H = 72;     // 上端のアクター見出し欄
const BIZ_LANE_PAD_X = 44;        // 列の左右の余白（列の端の縦通路をここに通す）
const BIZ_LANE_MIN_W = 280;
const BIZ_CELL_GAP_X = 48;        // 同じセルに横に並べるノードの間隔
const BIZ_PHASE_PAD_Y = 36;       // 行（フェーズ）の上下の余白
const BIZ_RANK_GAP_MIN = 56, BIZ_RANK_GAP_LABEL = 88; // 段の間隔（その段から出る辺にラベルがあれば広く取る）
const BIZ_EMPTY_PHASE_H = 110;
const BIZ_CORRIDOR_INSET = 12, BIZ_CHANNEL_STEP = 10;
const BIZ_ANCHOR_OFFSETS = [0, 14, -14];
const BIZ_OVERLAP_PENALTY = 100; // 既に引いた辺と同じ線上を 1px 重なるごとの減点（ルート長 100px 相当）
// 既に引いた辺と BIZ_NEAR_DIST 未満の間隔で 1px 並走するごとの減点。差し戻しの破線が順方向の実線に
// 沿って走ると、どちらの線・ラベルか見分けにくいため
const BIZ_NEAR_DIST = 24, BIZ_NEAR_PENALTY = 30;
const BIZ_DECISION_LABEL_MIN_DIST = 14;
const BIZ_NODE_SIZE = {
  task: { w: 220, h: 76 },
  system: { w: 220, h: 76 },
  decision: { w: 150, h: 96 },
  start: { w: 190, h: 52 },
  end: { w: 190, h: 52 },
  // jobflow
  job: { w: 220, h: 76 },
  jobnet: { w: 220, h: 88 },   // 右上に種別のタグを出すので、見出しをタグの下から始める分だけ高い
  wait: { w: 220, h: 88 },
};
// 辺を引く順（小さい方が先）。主な流れを先に引き、異常終了（ng）、差し戻し・再実行（weak）は空いている経路を後から使う
const BIZ_EDGE_ROUTE_ORDER = { ng: 1, weak: 2 };
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

/** 後退辺を除いた DAG 上での最長パス順位（段番号。0 起点）を Kahn 法で求める。 */
function computeBizRanks(nodeIds, forwardEdges) {
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

function routeLength(route) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) total += Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
  return total;
}

/**
 * route が既に引いた辺（drawn: [{to, route}]）と同じ線上で重なる長さ（overlap）と、
 * 重ならないが BIZ_NEAR_DIST 未満の間隔で並走する長さ（near）の合計。
 * 同じノードへ入る辺どうしの最後の線分（矢じりの手前で合流する部分）は数えない。
 */
function routeOverlapLength(route, to, drawn) {
  let overlap = 0, near = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [p, q] = [route[i], route[i + 1]];
    const horizontal = Math.abs(p[1] - q[1]) < 1;
    for (const d of drawn) {
      const r = d.route;
      for (let j = 0; j < r.length - 1; j++) {
        if (d.to === to && i === route.length - 2 && j === r.length - 2) continue;
        const [s, t] = [r[j], r[j + 1]];
        if (horizontal !== (Math.abs(s[1] - t[1]) < 1)) continue;
        const k = horizontal ? 1 : 0, m = horizontal ? 0 : 1;
        const dist = Math.abs(p[k] - s[k]);
        if (dist >= BIZ_NEAR_DIST) continue;
        const lo = Math.max(Math.min(p[m], q[m]), Math.min(s[m], t[m]));
        const hi = Math.min(Math.max(p[m], q[m]), Math.max(s[m], t[m]));
        if (hi - lo <= 2) continue;
        if (dist < 3) overlap += hi - lo; else near += hi - lo;
      }
    }
  }
  return { overlap, near };
}

/** ルートの最初の線分の向きから、始点ノードのどの辺から出たかを返す */
function exitSideOf(route) {
  const [a, b] = route;
  if (Math.abs(a[0] - b[0]) < 1) return b[1] > a[1] ? 'bottom' : 'top';
  return b[0] > a[0] ? 'right' : 'left';
}

/**
 * ノード a→b 間の直交ルート候補を作る。hUse / vUse は「同じ横通路 y（縦通路 x）を使う辺が
 * 既に何本あるか」を数える共有カウンター。採用された候補だけが .apply() でカウンターを進める
 * （並行する通路を 10px ずつずらす）。
 * - b が下の段: 真下へ直線 / 段の間の横通路経由 / 横に出て b の真上から下へ（L 字）
 * - b が上の段: 上端から出て b の段の下の横通路を通り b の下端へ（late: 同じ隙間を通る順方向の辺と
 *   並んで紛らわしいため、列の端の縦通路より後回し）
 * - 同じ段: 側面どうしを直線
 * - 常に: 列の左右端の縦通路経由（戻り・フォールバック）
 */
function buildBizRouteCandidates(a, b, metaA, metaB, hUse, vUse) {
  const aC = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bC = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const side = (r, s) => rectBoundary(r, s);
  const candidates = [];
  function take(map, kind, base, dir) {
    const key = `${kind}:${Math.round(base / 6)}`;
    const n = map.get(key) || 0;
    return { value: base + dir * n * BIZ_CHANNEL_STEP, apply: () => map.set(key, n + 1) };
  }
  const noop = () => {};

  if (b.y >= a.y + a.h - 1) {
    const pa = side(a, 'bottom'), pb = side(b, 'top');
    if (Math.abs(aC.x - bC.x) < 2) candidates.push({ route: [[pa.x, pa.y], [pb.x, pb.y]], apply: noop });
    [metaA.rankBottom + metaA.gapBelow / 2, metaB.rankTop - metaB.gapAbove / 2].forEach(yBase => {
      const ch = take(hUse, 'h', yBase, 1);
      candidates.push({ route: dedupePoints([[pa.x, pa.y], [pa.x, ch.value], [pb.x, ch.value], [pb.x, pb.y]]), apply: ch.apply });
    });
    if (Math.abs(aC.x - bC.x) >= 2) {
      const s = side(a, bC.x > aC.x ? 'right' : 'left');
      candidates.push({ route: dedupePoints([[s.x, s.y], [pb.x, s.y], [pb.x, pb.y]]), apply: noop });
    }
  } else if (b.y + b.h <= a.y + 1) {
    const pa = side(a, 'top'), pb = side(b, 'bottom');
    [0, 24, -24].forEach(dx => {
      const ch = take(hUse, 'h', metaB.rankBottom + metaB.gapBelow / 2, -1);
      candidates.push({ route: dedupePoints([[pa.x + dx, pa.y], [pa.x + dx, ch.value], [pb.x + dx, ch.value], [pb.x + dx, pb.y]]), apply: ch.apply, late: true });
    });
  } else if (Math.abs(aC.y - bC.y) < 2) {
    const right = bC.x > aC.x;
    const p1 = side(a, right ? 'right' : 'left'), p2 = side(b, right ? 'left' : 'right');
    candidates.push({ route: [[p1.x, p1.y], [p2.x, p2.y]], apply: noop });
  }
  // 側面の出入口は中央と上下にずらした位置の 3 通り（中央を他の辺が使っていると線が重なるため）
  BIZ_ANCHOR_OFFSETS.forEach(dy => {
    const co = take(vUse, 'r', Math.max(metaA.laneRight, metaB.laneRight) - BIZ_CORRIDOR_INSET, -1);
    const p1 = side(a, 'right'), p2 = side(b, 'right');
    candidates.push({ route: dedupePoints([[p1.x, p1.y + dy], [co.value, p1.y + dy], [co.value, p2.y + dy], [p2.x, p2.y + dy]]), apply: co.apply });
  });
  BIZ_ANCHOR_OFFSETS.forEach(dy => {
    const co = take(vUse, 'l', Math.min(metaA.laneLeft, metaB.laneLeft) + BIZ_CORRIDOR_INSET, 1);
    const p1 = side(a, 'left'), p2 = side(b, 'left');
    candidates.push({ route: dedupePoints([[p1.x, p1.y + dy], [co.value, p1.y + dy], [co.value, p2.y + dy], [p2.x, p2.y + dy]]), apply: co.apply });
  });
  return candidates.filter(c => c.route.length >= 2);
}

/** 分岐の辺ラベルは最初の線分の上、分岐の出口の近くに置く（線分が短すぎれば null） */
function decisionLabelAt(route, label) {
  if (!route || route.length < 2) return null;
  const [a, b] = route;
  const horizontal = Math.abs(a[1] - b[1]) < 1;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const need = horizontal ? estimateTextWidth(label, 11) + 18 + 8 : 28;
  if (len < need) return null;
  const d = Math.min(len / 2, need / 2 + 16);
  return [a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len];
}

/**
 * 全辺のルートを決める。候補は「ノード矩形（1px 縮小・自分自身を除く）との交差数」→「分岐で既に
 * 使った出口か」→「既に引いた辺と重なる・並走する長さ」→「後回しの候補か」→「ルート長」の順で比べる。分岐から出る辺が行き先ごとに違う辺
 * （上下左右）から出るようにするため、主な流れ（flow）の辺を先にルーティングし、差し戻し（weak）は
 * 後から空いている出口を使う。ラベルは既に置いたラベルと重ねない。
 */
function routeBizEdges(edgesIn, nodeRectById, nodeMetaById, nodeVariantById) {
  const rectsAll = [...nodeRectById.entries()].map(([id, r]) => ({ id, x: r.x, y: r.y, w: r.w, h: r.h }));
  const hUse = new Map();
  const vUse = new Map();
  const usedExits = new Map(); // decision id -> Set(side)
  const placed = [];
  const drawn = [];
  const out = new Array(edgesIn.length);
  const order = edgesIn.map((e, i) => i).sort((i, j) => (BIZ_EDGE_ROUTE_ORDER[edgesIn[i].type] || 0) - (BIZ_EDGE_ROUTE_ORDER[edgesIn[j].type] || 0) || i - j);
  order.forEach(idx => {
    const e = edgesIn[idx];
    const a = nodeRectById.get(e.from), b = nodeRectById.get(e.to);
    const metaA = nodeMetaById.get(e.from), metaB = nodeMetaById.get(e.to);
    const isDecision = nodeVariantById.get(e.from) === 'decision';
    const labelOpts = { placed, endClearance: LABEL_ARROW_CLEARANCE, ...(isDecision ? { avoidRect: a, minDist: BIZ_DECISION_LABEL_MIN_DIST } : {}) };
    if (e.from === e.to) {
      const t = rectBoundary(a, 'right');
      const route = dedupePoints([[t.x, t.y - 20], [t.x + 30, t.y - 20], [t.x + 30, t.y + 20], [t.x, t.y + 20]]);
      out[idx] = { from: e.from, to: e.to, label: e.label, type: e.type, route, labelAt: e.label ? labelOnRoute(route, e.label, rectsAll, labelOpts) : undefined };
      return;
    }
    const excl = shrinkRectsExcluding(rectsAll, [e.from, e.to]);
    const exits = usedExits.get(e.from) || new Set();
    let best = null;
    buildBizRouteCandidates(a, b, metaA, metaB, hUse, vUse).forEach((c, ci) => {
      const hits = countBizRouteHits(c.route, excl);
      const reused = isDecision && exits.has(exitSideOf(c.route));
      const { overlap, near } = routeOverlapLength(c.route, e.to, drawn);
      const score = hits * 1e6 + (reused ? 1e5 : 0) + overlap * BIZ_OVERLAP_PENALTY + near * BIZ_NEAR_PENALTY
        + (c.late ? 2000 : 0) + routeLength(c.route) + ci;
      if (!best || score < best.score) best = { ...c, score };
    });
    best.apply();
    drawn.push({ to: e.to, route: best.route });
    if (isDecision) { exits.add(exitSideOf(best.route)); usedExits.set(e.from, exits); }
    let labelAt;
    if (e.label) {
      const d = isDecision ? decisionLabelAt(best.route, e.label) : null;
      const lw = estimateTextWidth(e.label, 11) + 18, lh = 20;
      const collides = d && placed.some(r => d[0] - lw / 2 - 4 < r.x + r.w && d[0] + lw / 2 + 4 > r.x && d[1] - lh / 2 - 4 < r.y + r.h && d[1] + lh / 2 + 4 > r.y);
      if (d && !collides) {
        labelAt = d;
        placed.push({ x: d[0] - lw / 2, y: d[1] - lh / 2, w: lw, h: lh });
      } else {
        labelAt = labelOnRoute(best.route, e.label, rectsAll, labelOpts);
      }
    }
    out[idx] = { from: e.from, to: e.to, label: e.label, type: e.type, route: best.route, labelAt };
  });
  return out;
}

/**
 * biz レイアウト v3: アクター（lanes）を列、業務内容（phases）を行にした 1 枚のスイムレーン表。
 * v2（フェーズごとに独立したブロックを格子詰め）は同じアクターのレーンがブロックごとに分かれ、
 * 誰の作業かを縦に追えなかったため、列を全フェーズで共通にした。
 * - 列幅: そのアクターのセル（フェーズ×段）のうち最も幅の広いもの＋左右の余白（最小 280）。
 *   ノードの無いアクターも列として出す（表の見出しを揃えるため）。
 * - 行の高さ: そのフェーズの段の高さと段の間隔の合計＋上下の余白。ノードの無いフェーズは 110。
 * - phases が無い入力は、全ノードを見出しの無い 1 行（id "_all"）として同じ手順で並べる。
 * modeName: 'biz' | 'jobflow'（警告の接頭辞とノードの kind。jobflow のノードは kind 'job'）。
 */
function layoutSwimlane(biz, warnings, modeName) {
  const nodeKind = modeName === 'jobflow' ? 'job' : 'biz';
  const lanes = Array.isArray(biz.lanes) ? biz.lanes : [];
  const phasesIn = Array.isArray(biz.phases) ? biz.phases : [];
  const nodesIn = Array.isArray(biz.nodes) ? biz.nodes : [];
  const edgesIn = Array.isArray(biz.edges) ? biz.edges : [];
  const empty = { label: biz.label, desc: biz.desc, legend: biz.legend, bounds: { x: 0, y: 0, w: 0, h: 0 }, groups: [], phases: [], nodes: [], edges: [] };
  if (lanes.length === 0) return empty;
  const hasPhases = phasesIn.length > 0;
  const laneIds = lanes.map(l => l.id);
  const validLaneIds = new Set(laneIds);
  const validPhaseIds = new Set(hasPhases ? phasesIn.map(p => p.id) : []);

  const usableNodes = nodesIn.filter(n => n && n.id && validLaneIds.has(n.lane) && (!hasPhases || validPhaseIds.has(n.phase)));
  if (usableNodes.length < nodesIn.length) {
    warnings.push(`${modeName}: lane / phase を解決できないノードが ${nodesIn.length - usableNodes.length} 件あります（表示から除外しました）`);
  }
  if (usableNodes.length === 0) return empty;
  const usableById = new Map(usableNodes.map(n => [n.id, n]));
  const nodeVariantById = new Map(usableNodes.map(n => [n.id, n.variant]));
  const sizeById = new Map(usableNodes.map(n => [n.id, bizNodeSize(n.variant)]));
  const cellWidth = ids => ids.reduce((s, id, i) => s + sizeById.get(id).w + (i > 0 ? BIZ_CELL_GAP_X : 0), 0);

  // ---- フェーズ（行）ごとに段とセル（アクター×段）を求める ----
  const phaseDefs = hasPhases ? phasesIn.map(p => ({ id: p.id, label: p.label })) : [{ id: '_all', label: '' }];
  const phaseData = phaseDefs.map(def => {
    const memberIds = usableNodes.filter(n => (hasPhases ? n.phase : '_all') === def.id).map(n => n.id);
    const memberSet = new Set(memberIds);
    const relevantEdges = edgesIn.filter(e => e && e.type !== 'weak' && memberSet.has(e.from) && memberSet.has(e.to));
    const backIdx = detectBizBackEdges(memberIds, relevantEdges);
    const rankOf = computeBizRanks(memberIds, relevantEdges.filter((e, i) => !backIdx.has(i)));
    const nRanks = memberIds.length ? Math.max(...memberIds.map(id => rankOf.get(id) + 1)) : 0;
    const cells = new Map(); // `${lane}|${rank}` -> [id,...]（model 順に左から）
    memberIds.forEach(id => {
      const key = `${usableById.get(id).lane}|${rankOf.get(id)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(id);
    });
    return { def, memberIds, rankOf, nRanks, cells };
  });

  // ---- 列（アクター）の幅と x ----
  const laneW = new Map(laneIds.map(id => [id, BIZ_LANE_MIN_W]));
  phaseData.forEach(pd => pd.cells.forEach((ids, key) => {
    const lid = key.slice(0, key.indexOf('|'));
    laneW.set(lid, Math.max(laneW.get(lid), cellWidth(ids) + 2 * BIZ_LANE_PAD_X));
  }));
  const phaseHeaderW = hasPhases ? BIZ_PHASE_HEADER_W : 0;
  const laneX = new Map();
  let totalW = phaseHeaderW;
  laneIds.forEach(id => { laneX.set(id, totalW); totalW += laneW.get(id); });

  // ---- 行（フェーズ）の y と、段ごとのノード座標 ----
  const nodes = [];
  const nodeRectById = new Map();
  const nodeMetaById = new Map();
  const phasesOut = [];
  let curY = BIZ_LANE_HEADER_H;
  phaseData.forEach((pd, pi) => {
    const top = curY;
    if (pd.nRanks === 0) {
      phasesOut.push({ id: pd.def.id, label: pd.def.label, x: 0, y: top, w: totalW, h: BIZ_EMPTY_PHASE_H, headerW: phaseHeaderW, index: pi });
      curY += BIZ_EMPTY_PHASE_H;
      return;
    }
    const rankH = [], gapAfter = [], rankTop = [];
    for (let r = 0; r < pd.nRanks; r++) {
      const ids = pd.memberIds.filter(id => pd.rankOf.get(id) === r);
      rankH[r] = Math.max(0, ...ids.map(id => sizeById.get(id).h));
      if (r < pd.nRanks - 1) {
        const fromSet = new Set(ids);
        gapAfter[r] = edgesIn.some(e => e && e.label && fromSet.has(e.from)) ? BIZ_RANK_GAP_LABEL : BIZ_RANK_GAP_MIN;
      }
    }
    let y = top + BIZ_PHASE_PAD_Y;
    for (let r = 0; r < pd.nRanks; r++) { rankTop[r] = y; y += rankH[r] + (r < pd.nRanks - 1 ? gapAfter[r] : 0); }
    const h = y + BIZ_PHASE_PAD_Y - top;

    pd.cells.forEach((ids, key) => {
      const sep = key.indexOf('|');
      const lane = key.slice(0, sep), r = Number(key.slice(sep + 1));
      const lx = laneX.get(lane), lw = laneW.get(lane);
      let nx = lx + (lw - cellWidth(ids)) / 2;
      ids.forEach(id => {
        const n = usableById.get(id);
        const size = sizeById.get(id);
        const rect = { x: nx, y: rankTop[r] + (rankH[r] - size.h) / 2, w: size.w, h: size.h };
        nodeRectById.set(id, rect);
        nodeMetaById.set(id, {
          laneLeft: lx, laneRight: lx + lw,
          rankTop: rankTop[r], rankBottom: rankTop[r] + rankH[r],
          gapAbove: r > 0 ? gapAfter[r - 1] : BIZ_PHASE_PAD_Y,
          gapBelow: r < pd.nRanks - 1 ? gapAfter[r] : BIZ_PHASE_PAD_Y,
        });
        nodes.push({
          id, kind: nodeKind, variant: n.variant, lane: n.lane, phase: hasPhases ? n.phase : undefined,
          label: n.label, sub: n.sub, screen: n.screen, batch: n.batch, spec: n.spec, info: n.info,
          x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        });
        nx += size.w + BIZ_CELL_GAP_X;
      });
    });
    phasesOut.push({ id: pd.def.id, label: pd.def.label, x: 0, y: top, w: totalW, h, headerW: phaseHeaderW, index: pi });
    curY += h;
  });
  const totalH = curY;

  // アクターの列（見出しは上端 BIZ_LANE_HEADER_H。表の全高にわたる）
  const groups = lanes.map((l, i) => ({
    id: l.id, lane: l.id, label: l.label, sub: l.sub, style: 'swimlane',
    x: laneX.get(l.id), y: 0, w: laneW.get(l.id), h: totalH, headerH: BIZ_LANE_HEADER_H, index: i,
  }));

  // 元の nodes（model 順）を保つ
  const nodeOrderIdx = new Map(nodesIn.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => nodeOrderIdx.get(a.id) - nodeOrderIdx.get(b.id));

  const validEdges = edgesIn.filter(e => e && nodeRectById.has(e.from) && nodeRectById.has(e.to));
  if (validEdges.length < edgesIn.length) {
    warnings.push(`${modeName}: from/to を解決できない辺が ${edgesIn.length - validEdges.length} 件あります（描画から除外しました）`);
  }
  const edges = routeBizEdges(validEdges, nodeRectById, nodeMetaById, nodeVariantById);

  // phases が無い入力は行の見出し・帯を描かない（列だけの表にする）
  const phases = hasPhases ? phasesOut : [];
  const bounds = computeBounds(nodes, [...groups, ...phasesOut], edges);
  return { label: biz.label, desc: biz.desc, legend: biz.legend, bounds, groups, phases, nodes, edges };
}

// ---------- arch（構成図。入れ子のコンテナ + ELK 階層レイアウト） ----------
// AWS のような「クラウド › VPC › AZ › サブネット」の入れ子の枠にサービスを置く図。
// 枠（containers[]）を ELK の複合ノード（children を持つノード）にして、
// hierarchyHandling: INCLUDE_CHILDREN で枠の中も外もまとめて 1 回で解く
// （枠ごとに別々に解くと、枠をまたぐ辺が枠を横切る位置を制御できない）。
// ELK の座標は親からの相対なので、結果の木をたどって絶対座標へ直す。
// 枠は groups[]（style: "arch"）として出力し、ビューアは depth の小さい順（外側から）に描く。
const ARCH_W = 240, ARCH_H = 96;
// 枠の内側の余白。top は見出しの札（ラベル・補足）の分だけ広くとる
const ARCH_PAD = { top: 56, side: 28, bottom: 28 };
const ARCH_MAX_DEPTH = 8;
// 辺ラベルが置けないときに線の脇へずらす距離。18px は線をよける程度、
// ARCH_H/2+26 はカード 1 枚を越えて空いた場所へ出すため（構成図は枠が詰まっていて、
// 線の上にラベルを置けないことがある）
const ARCH_LABEL_OFFSETS = [18, ARCH_H / 2 + 26];

/**
 * containers[] を親子の木にする。parent が未知・自分自身・循環になっているものは
 * 根（枠の外）に付け替えて警告する（validate.js でもエラーにしているが、ここでも落ちないようにする）。
 * 戻り値: { byId, rootContainers, childContainers, depthOf }
 */
function buildArchTree(containersIn, warnings) {
  const byId = new Map();
  containersIn.forEach((c) => { if (c && c.id && !byId.has(c.id)) byId.set(c.id, c); });
  const parentOf = new Map();
  byId.forEach((c, id) => {
    let p = c.parent;
    if (p === id) { warnings.push(`arch: containers.${id}.parent が自分自身を指しています。枠の外に置きます`); p = null; }
    if (p && !byId.has(p)) { warnings.push(`arch: containers.${id}.parent が未知の枠を参照しています: ${p}。枠の外に置きます`); p = null; }
    parentOf.set(id, p || null);
  });
  // 循環（A→B→A）は根に付け替える
  byId.forEach((c, id) => {
    const seen = new Set([id]);
    let p = parentOf.get(id);
    while (p) {
      if (seen.has(p)) { warnings.push(`arch: containers の parent が循環しています（${id}）。枠の外に置きます`); parentOf.set(id, null); break; }
      seen.add(p);
      p = parentOf.get(p);
    }
  });
  const childContainers = new Map();   // parentId（根は null）-> [id]（記述順）
  containersIn.forEach((c) => {
    if (!c || !c.id || byId.get(c.id) !== c) return;
    const p = parentOf.get(c.id);
    const key = p || '';
    if (!childContainers.has(key)) childContainers.set(key, []);
    childContainers.get(key).push(c.id);
  });
  const depthOf = new Map();
  byId.forEach((c, id) => {
    let d = 0, p = parentOf.get(id);
    while (p && d < ARCH_MAX_DEPTH) { d += 1; p = parentOf.get(p); }
    depthOf.set(id, d);
  });
  return { byId, parentOf, childContainers, depthOf };
}

async function layoutArch(mode, warnings) {
  const nodesIn = Array.isArray(mode.nodes) ? mode.nodes : [];
  const containersIn = Array.isArray(mode.containers) ? mode.containers : [];
  if (nodesIn.length === 0) {
    return { label: mode.label, desc: mode.desc, legend: mode.legend, bounds: { x: 0, y: 0, w: 0, h: 0 }, nodes: [], groups: [], edges: [] };
  }
  const edgesIn = Array.isArray(mode.edges) ? mode.edges : [];
  // type: "weak" の辺は層（左→右の段）の決定に使わない。ELK のグラフから外し、配置のあとに
  // 直交ルートを引くだけにする。NAT ゲートウェイの経由・ログの送信のような「流れではないつながり」を
  // weak にしておくと、その辺のせいで枠の並びが実際の構成と逆になるのを防げる（biz の weak と同じ考え方）。
  const elkEdgesIn = edgesIn.filter(e => e && e.type !== 'weak');
  const { byId, parentOf, childContainers, depthOf } = buildArchTree(containersIn, warnings);

  // ノードを所属する枠ごとに分ける（container が無い・未知なら枠の外）
  const childNodes = new Map();
  nodesIn.forEach((n) => {
    let c = n.container || null;
    if (c && !byId.has(c)) { warnings.push(`arch: nodes.${n.id}.container が未知の枠を参照しています: ${c}。枠の外に置きます`); c = null; }
    const key = c || '';
    if (!childNodes.has(key)) childNodes.set(key, []);
    childNodes.get(key).push(n);
  });

  // 層の間隔は辺ラベルが収まる幅（layoutFreeDiagram と同じ考え方）
  const maxLabelW = Math.max(0, ...elkEdgesIn.map(e => (e.label ? estimateTextWidth(e.label, 11) + 18 : 0)));
  const betweenLayers = Math.round(Math.min(220, Math.max(56, maxLabelW + 48)));

  function elkNodeOf(n) { return { id: n.id, width: ARCH_W, height: ARCH_H }; }
  function elkContainerOf(id) {
    const kids = [
      ...(childContainers.get(id) || []).map(elkContainerOf),
      ...(childNodes.get(id) || []).map(elkNodeOf),
    ];
    return {
      id,
      layoutOptions: {
        'elk.padding': `[top=${ARCH_PAD.top},left=${ARCH_PAD.side},bottom=${ARCH_PAD.bottom},right=${ARCH_PAD.side}]`,
        'elk.spacing.nodeNode': '36',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(betweenLayers),
      },
      // 空の枠でも見出しの札ぶんの大きさは残す
      ...(kids.length ? { children: kids } : { width: 260, height: ARCH_PAD.top + 40 }),
    };
  }

  function buildGraph(direction) {
    return {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        // 枠の中と外をまとめて 1 回で解く（枠をまたぐ辺のルートもここで決まる）
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '48',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(betweenLayers),
        'elk.spacing.edgeNode': '18',
        'elk.spacing.edgeEdge': '12',
        'elk.padding': '[top=24,left=24,bottom=24,right=24]',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      },
      children: [
        ...(childContainers.get('') || []).map(elkContainerOf),
        ...(childNodes.get('') || []).map(elkNodeOf),
      ],
      edges: elkEdgesIn.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
    };
  }

  async function attempt(direction) {
    const result = await runElk(buildGraph(direction));
    // ELK の座標は親からの相対。木をたどって絶対座標にする
    const nodePos = new Map();
    const containerPos = new Map();
    const elkEdges = new Map();
    (function walk(elkNode, offX, offY) {
      (elkNode.edges || []).forEach((re) => { elkEdges.set(re.id, re); });
      (elkNode.children || []).forEach((ch) => {
        const x = offX + (ch.x || 0), y = offY + (ch.y || 0);
        const rect = { x, y, w: ch.width || 0, h: ch.height || 0 };
        if (byId.has(ch.id)) { containerPos.set(ch.id, rect); walk(ch, x, y); }
        else nodePos.set(ch.id, rect);
      });
    })(result, 0, 0);
    // 枠を含めた大きさで、どれだけ大きくフィットできるか（読みやすさの目安）
    const allRects = new Map();
    nodePos.forEach((r, id) => allRects.set(id, r));
    containerPos.forEach((r, id) => allRects.set('g:' + id, r));
    const bounds = boundsOfPosMap(allRects);
    const fit = fitZoom(bounds);
    const crossings = countCrossings(nodePos, elkEdgesIn);
    const length = totalRouteLength(result, nodePos, elkEdgesIn);
    const perEdge = length / Math.max(1, elkEdgesIn.length);
    const score = (FIT_READABLE - Math.min(fit, FIT_READABLE)) * 2000 + crossings * 10 + perEdge / 10;
    return { direction, result, nodePos, containerPos, elkEdges, bounds, fit, crossings, score };
  }

  // 向き（層の進む方向）は上→下が既定。AWS の構成図の慣習（利用者を上に置き、
  // ロードバランサー → アプリケーション → データベース と下へ降りる）に合わせる。
  // 横に並べたいときだけ model で direction: "right" を指定する。
  const chosen = await attempt(mode.direction === 'right' ? 'RIGHT' : 'DOWN');
  if (process.env.DV_DEBUG_ARCH) console.log(`[layout] arch ${chosen.direction}: ${Math.round(chosen.bounds.w)}x${Math.round(chosen.bounds.h)} fit ${(chosen.fit*100).toFixed(0)}% 交差 ${chosen.crossings}`);
  const { nodePos, containerPos, elkEdges } = chosen;

  // 辺のルートの座標は「両端の最小共通の枠」からの相対（ELK の階層レイアウトの仕様。
  // 辺オブジェクト自体は宣言どおり root の edges に入ったまま返ってくるので、原点は自分で求める）。
  const containerOfNode = new Map();
  nodesIn.forEach((n) => { const c = n.container; containerOfNode.set(n.id, c && byId.has(c) ? c : null); });
  function ancestorsOf(nodeId) {          // 外側の枠から順（root は含めない）
    const chain = [];
    let c = containerOfNode.get(nodeId) || null;
    while (c) { chain.unshift(c); c = parentOf.get(c) || null; }
    return chain;
  }
  function edgeOrigin(fromId, toId) {
    const a = ancestorsOf(fromId), b = ancestorsOf(toId);
    let lca = null;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) break;
      lca = a[i];
    }
    return (lca && containerPos.get(lca)) || { x: 0, y: 0 };
  }

  const nodes = nodesIn.map((n) => {
    const p = nodePos.get(n.id) || { x: 0, y: 0, w: ARCH_W, h: ARCH_H };
    const node = { id: n.id, kind: 'arch', x: p.x, y: p.y, w: p.w, h: p.h };
    Object.keys(n).forEach((k) => { if (!['id', 'kind', 'pin', 'x', 'y', 'w', 'h'].includes(k)) node[k] = n[k]; });
    node.pin = n.pin;
    return node;
  });

  // 辺ラベルを置くときに避ける矩形: ノードと、枠の上端の見出しの帯（札を描く場所）
  const nodeRects = [...nodePos.values()];
  const labelAvoidRects = nodeRects.concat(
    [...containerPos.values()].map(r => ({ x: r.x, y: r.y, w: r.w, h: Math.min(ARCH_PAD.top, r.h) }))
  );
  const placedLabels = [];
  const elkEdgeIdOf = new Map(elkEdgesIn.map((e, i) => [e, `e${i}`]));
  const edges = edgesIn.map((e) => {
    const re = elkEdges.get(elkEdgeIdOf.get(e));
    const route = re ? flattenSection(re.sections && re.sections[0]) : null;
    const org = edgeOrigin(e.from, e.to);
    const abs = route ? route.map(([x, y]) => [x + org.x, y + org.y]) : null;
    const a = nodePos.get(e.from), b = nodePos.get(e.to);
    const fallback = a && b ? simpleOrthogonalRoute(a, b) : [[0, 0], [1, 1]];
    const finalRoute = abs && abs.length >= 2 ? abs : fallback;
    return {
      from: e.from, to: e.to, label: e.label, type: e.type,
      fromLabel: e.fromLabel, toLabel: e.toLabel,
      route: finalRoute,
      labelAt: !e.label ? undefined
        : labelOnRoute(finalRoute, e.label, labelAvoidRects, {
          placed: placedLabels, endClearance: LABEL_ARROW_CLEARANCE,
          preferVertical: chosen.direction === 'DOWN', offsetSteps: ARCH_LABEL_OFFSETS,
        }),
    };
  });

  const finalEdges = applyPins(nodes, edges, null, warnings, 'arch');
  const finalNodes = nodes.map(({ pin, ...rest }) => rest);

  // 枠は外側から描く（入れ子の内側があとに来るように depth の昇順）
  const groups = containersIn
    .filter(c => c && c.id && containerPos.has(c.id))
    .map((c) => {
      const p = containerPos.get(c.id);
      return {
        id: c.id, style: 'arch', kind: c.kind || 'group', label: c.label || c.id, sub: c.sub,
        parent: parentOf.get(c.id) || undefined, depth: depthOf.get(c.id) || 0,
        headerH: ARCH_PAD.top, info: c.info,
        x: p.x, y: p.y, w: p.w, h: p.h,
      };
    })
    .sort((a, b) => a.depth - b.depth);

  const bounds = computeBounds(finalNodes, groups, finalEdges);
  return {
    label: mode.label, desc: mode.desc, legend: mode.legend,
    bounds, nodes: finalNodes, groups, edges: finalEdges,
    _direction: chosen.direction, _fitZoom: chosen.fit, _crossings: chosen.crossings,
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

  if (modesIn.gallery !== undefined || (model.screens || []).length > 0 || (model.batches || []).length > 0) {
    t = Date.now();
    modes.gallery = modesIn.gallery && modesIn.gallery.arrange === 'table'
      ? layoutGalleryTable(model, warnings)
      : layoutGallery(model, warnings);
    modes.gallery.label = (modesIn.gallery && modesIn.gallery.label) || '機能一覧';
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
    modes.biz = layoutSwimlane(modesIn.biz, warnings, 'biz');
    timings.biz = Date.now() - t;
  }
  if (modesIn.jobflow) {
    t = Date.now();
    modes.jobflow = layoutSwimlane(modesIn.jobflow, warnings, 'jobflow');
    timings.jobflow = Date.now() - t;
  }
  if (modesIn.er) {
    t = Date.now();
    modes.er = await layoutEr(modesIn.er, warnings);
    timings.er = Date.now() - t;
  }
  if (modesIn.dfd) {
    t = Date.now();
    modes.dfd = modesIn.dfd.arrange === 'steps'
      ? await layoutDfdBySteps(modesIn.dfd, warnings)
      : await layoutFreeDiagram('dfd', modesIn.dfd, 'dfd', { w: DFD_W, h: DFD_H }, warnings);
    if (modesIn.dfd.steps) modes.dfd.steps = modesIn.dfd.steps;
    timings.dfd = Date.now() - t;
  }
  if (modesIn.arch) {
    t = Date.now();
    modes.arch = await layoutArch(modesIn.arch, warnings);
    timings.arch = Date.now() - t;
  }

  const data = {
    version: 2,
    generatedAt: new Date().toISOString(),
    meta: model.meta,
    screens: model.screens || [],
    batches: model.batches || [],
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
      } else if (k === 'arch') {
        console.log(`[layout] arch: 枠 ${v.groups.length}・ノード ${v.nodes.length}・辺 ${v.edges.length}（bounds ${Math.round(v.bounds.w)}x${Math.round(v.bounds.h)}）`);
      } else if (k === 'biz' || k === 'jobflow') {
        console.log(`[layout] ${k}: アクター ${v.groups.length}・フェーズ ${v.phases.length}・ノード ${v.nodes.length}・辺 ${v.edges.length}（bounds ${Math.round(v.bounds.w)}x${Math.round(v.bounds.h)}）`);
      }
    });
    console.log(`[layout] 書き出し: ${path.join(outDir, '.layout.json')}`);
  })().catch(e => { console.error('[layout] 失敗:', e); process.exit(1); });
}
