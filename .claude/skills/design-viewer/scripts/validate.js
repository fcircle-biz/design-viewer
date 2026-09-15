#!/usr/bin/env node
/**
 * design-viewer / validate.js
 *
 * <viewer-src>/model.json（または <viewer-src>/model/**\/*.json）の参照整合チェック。
 * 単体実行: node validate.js <viewer-src>
 * モジュール利用: const { readModel, validateModel } = require('./validate');
 *
 * エラー（参照が壊れている・必須項目欠落）は非 0 終了。警告（表示のみ影響）は表示のみで終了 0。
 * 詳細な入力モデルの仕様は ../schema/model.md を参照。model の読み込み（model.json / model/ の
 * 判定・分割ファイルのマージ）は lib/load-model.js が担う。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readModel } = require('./lib/load-model');

const KNOWN_EDGE_TYPES = new Set(['user', 'system', 'nav', 'start', 'rel', 'weak', 'flow']);
const KNOWN_CONCEPT_VARIANTS = new Set(['actor', 'entity', 'system', 'file']);
const KNOWN_BIZ_VARIANTS = new Set(['start', 'end', 'task', 'system', 'decision']);
const KNOWN_ER_TONES = new Set(['blue', 'amber', 'green', 'slate', 'purple', 'teal']);
const KNOWN_DFD_VARIANTS = new Set(['ext', 'proc', 'store']);
const KNOWN_FIELD_KEYS = new Set(['PK', 'FK', 'UK', '']);
const KNOWN_FLOW_LAYOUTS = new Set(['lanes', 'elk']);
const KNOWN_FLOW_EDGE_STYLES = new Set(['curve', 'orthogonal']);
const KNOWN_FLOW_ARRANGES = new Set(['elk', 'groups']);
const KNOWN_DFD_ARRANGES = new Set(['elk', 'steps']);

function pushErr(errors, msg) { errors.push(msg); }
function pushWarn(warnings, msg) { warnings.push(msg); }

/** id の重複を検出する。names: 表示用ラベル。戻り値: 重複した id の配列 */
function findDuplicates(items, idFn) {
  const seen = new Map();
  const dups = new Set();
  for (const it of items) {
    const id = idFn(it);
    if (id === undefined || id === null) continue;
    if (seen.has(id)) dups.add(id);
    seen.set(id, true);
  }
  return [...dups];
}

/**
 * model を検証する。{ errors: string[], warnings: string[] } を返す。
 * viewerSrcDir を渡すと screens/<ID>.html の存在確認も行う（省略時はスキップ）。
 */
function validateModel(model, viewerSrcDir) {
  const errors = [];
  const warnings = [];

  if (!model || typeof model !== 'object') {
    pushErr(errors, 'model のトップレベルはオブジェクトである必要があります（model.json / model/*.json）');
    return { errors, warnings };
  }

  // --- meta ---
  if (!model.meta || typeof model.meta !== 'object') {
    pushErr(errors, 'meta が必須です（{ title, subtitle?, statusNote? }）');
  } else if (!model.meta.title) {
    pushErr(errors, 'meta.title が必須です');
  }
  if (model.meta && model.meta.modeOrder !== undefined) {
    const known = ['flow', 'gallery', 'concept', 'biz', 'er', 'dfd'];
    if (!Array.isArray(model.meta.modeOrder)) {
      pushWarn(warnings, 'meta.modeOrder は配列で指定してください（例: ["concept","biz","gallery","flow","er","dfd"]）');
    } else {
      model.meta.modeOrder.filter(k => !known.includes(k)).forEach(k => pushWarn(warnings, `meta.modeOrder の未知のモード: ${k}`));
    }
  }

  // --- groups ---
  const groups = Array.isArray(model.groups) ? model.groups : [];
  if (!Array.isArray(model.groups)) pushWarn(warnings, 'groups が配列ではありません（空として扱います）');
  const groupIds = new Set();
  groups.forEach((g, i) => {
    if (!g || !g.id) { pushErr(errors, `groups[${i}] に id がありません`); return; }
    if (!g.label) pushWarn(warnings, `groups[${i}] (${g.id}) に label がありません`);
    groupIds.add(g.id);
  });
  findDuplicates(groups, g => g && g.id).forEach(id => pushErr(errors, `groups の id が重複しています: ${id}`));

  // --- screens ---
  const screens = Array.isArray(model.screens) ? model.screens : [];
  if (!Array.isArray(model.screens)) pushErr(errors, 'screens が配列ではありません');
  const screenIds = new Set();
  screens.forEach((s, i) => {
    if (!s || !s.id) { pushErr(errors, `screens[${i}] に id がありません`); return; }
    if (!s.title) pushWarn(warnings, `screens[${i}] (${s.id}) に title がありません`);
    if (s.group && !groupIds.has(s.group)) {
      pushErr(errors, `screens.${s.id}.group が未知の group を参照しています: ${s.group}`);
    } else if (!s.group) {
      pushWarn(warnings, `screens.${s.id} に group がありません（flow/gallery で未分類レーンに入ります）`);
    }
    if (s.w !== undefined && (typeof s.w !== 'number' || s.w <= 0)) pushWarn(warnings, `screens.${s.id}.w が不正です（正の数値を指定してください）`);
    if (s.h !== undefined && (typeof s.h !== 'number' || s.h <= 0)) pushWarn(warnings, `screens.${s.id}.h が不正です（正の数値を指定してください）`);
    if (s.status !== undefined && !['done', 'wip', 'designed', 'planned'].includes(s.status)) {
      pushWarn(warnings, `screens.${s.id}.status が未知です: ${s.status}（done | wip | designed | planned）`);
    }
    screenIds.add(s.id);
  });
  findDuplicates(screens, s => s && s.id).forEach(id => pushErr(errors, `screens の id が重複しています: ${id}`));

  // screens/<ID>.html の存在確認（警告のみ）
  if (viewerSrcDir) {
    const screensDir = path.join(viewerSrcDir, 'screens');
    if (!fs.existsSync(screensDir)) {
      if (screens.length > 0) pushWarn(warnings, `screens/ フォルダーがありません（${screensDir}）。全 ${screens.length} 画面のサムネイルはプレースホルダーになります`);
    } else {
      const missing = screens.filter(s => s && s.id && !fs.existsSync(path.join(screensDir, `${s.id}.html`)));
      if (missing.length > 0) {
        const shown = missing.slice(0, 10).map(s => s.id).join(', ');
        const more = missing.length > 10 ? ` 他 ${missing.length - 10} 件` : '';
        pushWarn(warnings, `screens/<ID>.html が無い画面が ${missing.length} 件あります: ${shown}${more}`);
      }
    }
  }

  const modes = model.modes && typeof model.modes === 'object' ? model.modes : {};

  // --- modes.flow ---
  if (modes.flow) {
    const flow = modes.flow;
    const isElk = flow.layout === 'elk';
    if (flow.layout !== undefined && !KNOWN_FLOW_LAYOUTS.has(flow.layout)) pushErr(errors, `modes.flow.layout が未知です: ${flow.layout}（lanes | elk）`);
    if (flow.edgeStyle !== undefined) {
      if (!isElk) pushWarn(warnings, 'modes.flow.edgeStyle は layout: "elk" のときだけ有効です');
      else if (!KNOWN_FLOW_EDGE_STYLES.has(flow.edgeStyle)) pushErr(errors, `modes.flow.edgeStyle が未知です: ${flow.edgeStyle}（curve | orthogonal）`);
    }
    if (flow.layoutOptions !== undefined) {
      if (!isElk) pushWarn(warnings, 'modes.flow.layoutOptions は layout: "elk" のときだけ有効です');
      else if (!flow.layoutOptions || typeof flow.layoutOptions !== 'object' || Array.isArray(flow.layoutOptions)) pushErr(errors, 'modes.flow.layoutOptions はオブジェクトである必要があります');
    }
    if (flow.arrange !== undefined) {
      if (!isElk) pushWarn(warnings, 'modes.flow.arrange は layout: "elk" のときだけ有効です');
      else if (!KNOWN_FLOW_ARRANGES.has(flow.arrange)) pushErr(errors, `modes.flow.arrange が未知です: ${flow.arrange}（elk | groups）`);
    }
    const isGroupsArrange = isElk && flow.arrange === 'groups';
    if (flow.hubGroup !== undefined) {
      if (!isGroupsArrange) pushWarn(warnings, 'modes.flow.hubGroup は modes.flow.arrange: "groups" のときだけ有効です');
      else if (!groupIds.has(flow.hubGroup)) pushErr(errors, `modes.flow.hubGroup が未知の group を参照しています: ${flow.hubGroup}`);
    }
    const checkNudge = (owner, n) => {
      if (n.nudge === undefined) return;
      if (!isElk) { pushWarn(warnings, `${owner}.nudge は modes.flow.layout: "elk" のときだけ有効です`); return; }
      const ok = n.nudge && typeof n.nudge === 'object'
        && ['dx', 'dy'].every(k => n.nudge[k] === undefined || typeof n.nudge[k] === 'number');
      if (!ok) pushErr(errors, `${owner}.nudge は { dx?: number, dy?: number } で指定してください`);
    };
    screens.forEach(s => { if (s && s.id) checkNudge(`screens.${s.id}`, s); });
    const explicitNodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const flowNodeIds = new Set(screenIds);
    explicitNodes.forEach((n, i) => {
      if (!n || !n.id) { pushErr(errors, `modes.flow.nodes[${i}] に id がありません`); return; }
      if (screenIds.has(n.id)) pushErr(errors, `modes.flow.nodes の id が screens の id と重複しています: ${n.id}`);
      if (flowNodeIds.has(n.id) && !screenIds.has(n.id)) pushErr(errors, `modes.flow.nodes の id が重複しています: ${n.id}`);
      flowNodeIds.add(n.id);
      if (!n.label) pushWarn(warnings, `modes.flow.nodes.${n.id} に label がありません`);
      if (n.group && !groupIds.has(n.group)) pushErr(errors, `modes.flow.nodes.${n.id}.group が未知の group を参照しています: ${n.group}`);
      else if (!n.group && !isElk) pushWarn(warnings, `modes.flow.nodes.${n.id} に group がありません（未分類レーンに入ります）`);
      checkNudge(`modes.flow.nodes.${n.id}`, n);
    });
    const attachedIds = new Set(explicitNodes.filter(n => n && n.attachTo).map(n => n.id));
    explicitNodes.forEach(n => {
      if (!n || !n.id || (n.attachTo === undefined && n.attachSide === undefined && n.attachGap === undefined)) return;
      const owner = `modes.flow.nodes.${n.id}`;
      if (!isElk) { pushWarn(warnings, `${owner}.attachTo は modes.flow.layout: "elk" のときだけ有効です`); return; }
      if (!n.attachTo) { pushErr(errors, `${owner}: attachSide / attachGap には attachTo が必要です`); return; }
      if (!flowNodeIds.has(n.attachTo) || n.attachTo === n.id) pushErr(errors, `${owner}.attachTo が未知の id を参照しています: ${n.attachTo}`);
      else if (attachedIds.has(n.attachTo)) pushErr(errors, `${owner}.attachTo の相手 ${n.attachTo} 自身も attachTo を持っています（連鎖は不可）`);
      if (n.attachSide !== undefined && !['left', 'right', 'top', 'bottom'].includes(n.attachSide)) pushErr(errors, `${owner}.attachSide が未知です: ${n.attachSide}（left | right | top | bottom）`);
      if (n.attachGap !== undefined && typeof n.attachGap !== 'number') pushErr(errors, `${owner}.attachGap は数値で指定してください`);
    });
    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    edges.forEach((e, i) => {
      if (!e || !e.from || !e.to) { pushErr(errors, `modes.flow.edges[${i}] に from/to がありません`); return; }
      if (!flowNodeIds.has(e.from)) pushErr(errors, `modes.flow.edges[${i}] の from が未知の id を参照しています: ${e.from}`);
      if (!flowNodeIds.has(e.to)) pushErr(errors, `modes.flow.edges[${i}] の to が未知の id を参照しています: ${e.to}`);
      if (e.type && !KNOWN_EDGE_TYPES.has(e.type)) pushWarn(warnings, `modes.flow.edges[${i}] の type が未知です: ${e.type}`);
    });
  }

  // --- modes.gallery ---
  if (modes.gallery) {
    if (modes.gallery.arrange !== undefined && !['grid', 'table'].includes(modes.gallery.arrange)) {
      pushErr(errors, `modes.gallery.arrange が未知です: ${modes.gallery.arrange}（grid | table）`);
    }
    if (modes.gallery.arrange === 'table') {
      const noStatus = screens.filter(s => s && s.id && !s.status).map(s => s.id);
      if (noStatus.length) pushWarn(warnings, `modes.gallery.arrange: "table" ですが status の無い画面があります（実装状況が空欄になります）: ${noStatus.slice(0, 5).join(', ')}${noStatus.length > 5 ? ` ほか ${noStatus.length - 5} 件` : ''}`);
    }
    if (Array.isArray(modes.gallery.nodes) && modes.gallery.nodes.length > 0) {
      pushWarn(warnings, 'modes.gallery.nodes は無視されます（gallery はビルドが screens から自動生成します）');
    }
    if (Array.isArray(modes.gallery.edges) && modes.gallery.edges.length > 0) {
      pushWarn(warnings, 'modes.gallery.edges は無視されます（gallery に辺はありません）');
    }
  }

  // --- modes.concept ---
  if (modes.concept) {
    validateGenericDiagram('concept', modes.concept, errors, warnings, {
      variantSet: KNOWN_CONCEPT_VARIANTS,
      variantField: 'variant',
    });
  }

  // --- modes.biz ---
  if (modes.biz) {
    const biz = modes.biz;
    const lanes = Array.isArray(biz.lanes) ? biz.lanes : [];
    if (!Array.isArray(biz.lanes) || lanes.length === 0) pushErr(errors, 'modes.biz.lanes が必須です（1 件以上）');
    const laneIds = new Set();
    lanes.forEach((l, i) => {
      if (!l || !l.id) { pushErr(errors, `modes.biz.lanes[${i}] に id がありません`); return; }
      if (!l.label) pushErr(errors, `modes.biz.lanes[${i}] (${l.id}) に label がありません`);
      laneIds.add(l.id);
    });
    findDuplicates(lanes, l => l && l.id).forEach(id => pushErr(errors, `modes.biz.lanes の id が重複しています: ${id}`));

    const phasesArr = Array.isArray(biz.phases) ? biz.phases : [];
    const hasPhases = phasesArr.length > 0;
    const phaseIds = new Set();
    phasesArr.forEach((p, i) => {
      if (!p || !p.id) { pushErr(errors, `modes.biz.phases[${i}] に id がありません`); return; }
      if (!p.label) pushErr(errors, `modes.biz.phases[${i}] (${p.id}) に label がありません`);
      phaseIds.add(p.id);
    });
    findDuplicates(phasesArr, p => p && p.id).forEach(id => pushErr(errors, `modes.biz.phases の id が重複しています: ${id}`));

    const nodesArr = Array.isArray(biz.nodes) ? biz.nodes : [];
    const nodeIds = new Set();
    const phaseNodeCount = new Map([...phaseIds].map(id => [id, 0]));
    const nodeEdgeCount = new Map();
    nodesArr.forEach((n, i) => {
      if (!n || !n.id) { pushErr(errors, `modes.biz.nodes[${i}] に id がありません`); return; }
      if (nodeIds.has(n.id)) pushErr(errors, `modes.biz.nodes の id が重複しています: ${n.id}`);
      nodeIds.add(n.id);
      nodeEdgeCount.set(n.id, 0);
      if (!n.label) pushWarn(warnings, `modes.biz.nodes.${n.id} に label がありません`);
      if (n.variant && !KNOWN_BIZ_VARIANTS.has(n.variant)) pushErr(errors, `modes.biz.nodes.${n.id}.variant が未知です: ${n.variant}（start | end | task | system | decision）`);
      else if (!n.variant) pushErr(errors, `modes.biz.nodes.${n.id}.variant が必須です`);
      if (!n.lane) pushErr(errors, `modes.biz.nodes.${n.id}.lane が必須です`);
      else if (!laneIds.has(n.lane)) pushErr(errors, `modes.biz.nodes.${n.id}.lane が未知の lane を参照しています: ${n.lane}`);
      if (hasPhases) {
        if (!n.phase) pushErr(errors, `modes.biz.nodes.${n.id}.phase が必須です（phases が定義されているため）`);
        else if (!phaseIds.has(n.phase)) pushErr(errors, `modes.biz.nodes.${n.id}.phase が未知の phase を参照しています: ${n.phase}`);
        else phaseNodeCount.set(n.phase, (phaseNodeCount.get(n.phase) || 0) + 1);
      } else if (n.phase) {
        pushWarn(warnings, `modes.biz.nodes.${n.id}.phase は phases が未定義のため無視されます`);
      }
      if (n.screen && !screenIds.has(n.screen)) pushWarn(warnings, `modes.biz.nodes.${n.id}.screen が未知の screen を参照しています: ${n.screen}`);
    });
    if (hasPhases) {
      phasesArr.forEach(p => {
        if (p && p.id && (phaseNodeCount.get(p.id) || 0) === 0) pushWarn(warnings, `modes.biz.phases.${p.id} に属するノードがありません`);
      });
    }

    const edgesArr = Array.isArray(biz.edges) ? biz.edges : [];
    edgesArr.forEach((e, i) => {
      if (!e || !e.from || !e.to) { pushErr(errors, `modes.biz.edges[${i}] に from/to がありません`); return; }
      if (!nodeIds.has(e.from)) pushErr(errors, `modes.biz.edges[${i}] の from が未知の id を参照しています: ${e.from}`);
      else nodeEdgeCount.set(e.from, (nodeEdgeCount.get(e.from) || 0) + 1);
      if (!nodeIds.has(e.to)) pushErr(errors, `modes.biz.edges[${i}] の to が未知の id を参照しています: ${e.to}`);
      else nodeEdgeCount.set(e.to, (nodeEdgeCount.get(e.to) || 0) + 1);
      if (e.type && !['flow', 'weak'].includes(e.type)) pushWarn(warnings, `modes.biz.edges[${i}] の type が未知です: ${e.type}（flow | weak）`);
    });
    nodeEdgeCount.forEach((count, id) => {
      if (count === 0) pushWarn(warnings, `modes.biz.nodes.${id} に接続する辺がありません`);
    });
  }

  // --- modes.er ---
  if (modes.er) {
    const er = modes.er;
    const nodes = Array.isArray(er.nodes) ? er.nodes : [];
    const nodeIds = new Set();
    const nodeById = new Map();
    nodes.forEach((n, i) => {
      if (!n || !n.id) { pushErr(errors, `modes.er.nodes[${i}] に id がありません`); return; }
      if (nodeIds.has(n.id)) pushErr(errors, `modes.er.nodes の id が重複しています: ${n.id}`);
      nodeIds.add(n.id);
      nodeById.set(n.id, n);
      if (!n.label) pushWarn(warnings, `modes.er.nodes.${n.id} に label がありません`);
      if (n.tone && !KNOWN_ER_TONES.has(n.tone)) pushWarn(warnings, `modes.er.nodes.${n.id}.tone が未知です: ${n.tone}`);
      const fields = Array.isArray(n.fields) ? n.fields : [];
      const fieldNames = new Set();
      fields.forEach((f, fi) => {
        if (!f || !f.name) { pushErr(errors, `modes.er.nodes.${n.id}.fields[${fi}] に name がありません`); return; }
        if (fieldNames.has(f.name)) pushWarn(warnings, `modes.er.nodes.${n.id}.fields に重複した name があります: ${f.name}`);
        fieldNames.add(f.name);
        if (f.key && !KNOWN_FIELD_KEYS.has(f.key)) pushWarn(warnings, `modes.er.nodes.${n.id}.fields.${f.name}.key が未知です: ${f.key}`);
      });
    });
    const edges = Array.isArray(er.edges) ? er.edges : [];
    edges.forEach((e, i) => {
      if (!e || !e.from || !e.to) { pushErr(errors, `modes.er.edges[${i}] に from/to がありません`); return; }
      if (!nodeIds.has(e.from)) { pushErr(errors, `modes.er.edges[${i}] の from が未知の id を参照しています: ${e.from}`); return; }
      if (!nodeIds.has(e.to)) { pushErr(errors, `modes.er.edges[${i}] の to が未知の id を参照しています: ${e.to}`); return; }
      if (e.fromField) {
        const fromNode = nodeById.get(e.from);
        const fields = (fromNode && Array.isArray(fromNode.fields)) ? fromNode.fields : [];
        if (!fields.some(f => f && f.name === e.fromField)) {
          pushErr(errors, `modes.er.edges[${i}] の fromField が ${e.from} のフィールドに存在しません: ${e.fromField}`);
        }
      }
      if (e.toField) {
        const toNode = nodeById.get(e.to);
        const fields = (toNode && Array.isArray(toNode.fields)) ? toNode.fields : [];
        if (!fields.some(f => f && f.name === e.toField)) {
          pushErr(errors, `modes.er.edges[${i}] の toField が ${e.to} のフィールドに存在しません: ${e.toField}`);
        }
      }
    });
  }

  // --- modes.dfd ---
  if (modes.dfd) {
    const dfd = modes.dfd;
    const nodeIds = validateGenericDiagram('dfd', dfd, errors, warnings, {
      variantSet: KNOWN_DFD_VARIANTS,
      variantField: 'variant',
    });
    const steps = Array.isArray(dfd.steps) ? dfd.steps : [];
    const stepNs = new Set();
    steps.forEach((s, i) => {
      if (!s || s.n === undefined || s.n === null) { pushErr(errors, `modes.dfd.steps[${i}] に n がありません`); return; }
      if (stepNs.has(s.n)) pushErr(errors, `modes.dfd.steps の n が重複しています: ${s.n}`);
      stepNs.add(s.n);
    });
    const edges = Array.isArray(dfd.edges) ? dfd.edges : [];
    edges.forEach((e, i) => {
      if (e && e.step !== undefined && e.step !== null && !stepNs.has(e.step)) {
        pushErr(errors, `modes.dfd.edges[${i}] の step が modes.dfd.steps に存在しません: ${e.step}`);
      }
    });
    if (dfd.arrange !== undefined && !KNOWN_DFD_ARRANGES.has(dfd.arrange)) {
      pushErr(errors, `modes.dfd.arrange が未知です: ${dfd.arrange}（elk | steps）`);
    }
    if (dfd.arrange === 'steps') {
      if (steps.length === 0) pushErr(errors, 'modes.dfd.arrange: "steps" には modes.dfd.steps が必要です');
      const noStep = edges.filter(e => e && (e.step === undefined || e.step === null)).length;
      if (noStep > 0) pushWarn(warnings, `modes.dfd.arrange: "steps" で step の無い辺が ${noStep} 本あります（「ステップなし」のブロックに入ります）`);
    }
    void nodeIds;
  }

  return { errors, warnings };
}

/** concept / dfd 共通の nodes/edges 検証。使用済みの node id セットを返す。 */
function validateGenericDiagram(modeName, mode, errors, warnings, opts) {
  const nodes = Array.isArray(mode.nodes) ? mode.nodes : [];
  const nodeIds = new Set();
  nodes.forEach((n, i) => {
    if (!n || !n.id) { pushErr(errors, `modes.${modeName}.nodes[${i}] に id がありません`); return; }
    if (nodeIds.has(n.id)) pushErr(errors, `modes.${modeName}.nodes の id が重複しています: ${n.id}`);
    nodeIds.add(n.id);
    if (!n.label) pushWarn(warnings, `modes.${modeName}.nodes.${n.id} に label がありません`);
    const v = n[opts.variantField];
    if (v && !opts.variantSet.has(v)) pushWarn(warnings, `modes.${modeName}.nodes.${n.id}.${opts.variantField} が未知です: ${v}`);
  });
  const edges = Array.isArray(mode.edges) ? mode.edges : [];
  edges.forEach((e, i) => {
    if (!e || !e.from || !e.to) { pushErr(errors, `modes.${modeName}.edges[${i}] に from/to がありません`); return; }
    if (!nodeIds.has(e.from)) pushErr(errors, `modes.${modeName}.edges[${i}] の from が未知の id を参照しています: ${e.from}`);
    if (!nodeIds.has(e.to)) pushErr(errors, `modes.${modeName}.edges[${i}] の to が未知の id を参照しています: ${e.to}`);
    if (e.type && modeName === 'flow' && !KNOWN_EDGE_TYPES.has(e.type)) pushWarn(warnings, `modes.${modeName}.edges[${i}] の type が未知です: ${e.type}`);
  });
  return nodeIds;
}

module.exports = { readModel, validateModel };

if (require.main === module) {
  const viewerSrcDir = process.argv[2];
  if (!viewerSrcDir) {
    console.error('使い方: node validate.js <viewer-src>');
    process.exit(2);
  }
  let model;
  try {
    model = readModel(path.resolve(viewerSrcDir));
  } catch (e) {
    console.error(`[validate] ${e.message}`);
    process.exit(1);
  }
  const { errors, warnings } = validateModel(model, path.resolve(viewerSrcDir));
  if (warnings.length > 0) {
    console.warn(`[validate] 警告 ${warnings.length} 件:`);
    warnings.forEach(w => console.warn(`  - ${w}`));
  }
  if (errors.length > 0) {
    console.error(`[validate] エラー ${errors.length} 件:`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`[validate] OK（画面 ${((model.screens) || []).length} 件、警告 ${warnings.length} 件）`);
  process.exit(0);
}
