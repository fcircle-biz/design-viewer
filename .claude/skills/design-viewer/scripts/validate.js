#!/usr/bin/env node
/**
 * design-viewer / validate.js
 *
 * <viewer-src>/model.json の参照整合チェック。
 * 単体実行: node validate.js <viewer-src>
 * モジュール利用: const { readModel, validateModel } = require('./validate');
 *
 * エラー（参照が壊れている・必須項目欠落）は非 0 終了。警告（表示のみ影響）は表示のみで終了 0。
 * 詳細な入力モデルの仕様は ../schema/model.md を参照。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KNOWN_EDGE_TYPES = new Set(['user', 'system', 'nav', 'start', 'rel', 'weak', 'flow']);
const KNOWN_CONCEPT_VARIANTS = new Set(['actor', 'entity', 'system']);
const KNOWN_ER_TONES = new Set(['blue', 'amber', 'green', 'slate', 'purple', 'teal']);
const KNOWN_DFD_VARIANTS = new Set(['ext', 'proc', 'store']);
const KNOWN_FIELD_KEYS = new Set(['PK', 'FK', 'UK', '']);

/** <viewer-src>/model.json を読み込んでパースする。ファイルが無い/壊れていれば例外を投げる。 */
function readModel(viewerSrcDir) {
  const modelPath = path.join(viewerSrcDir, 'model.json');
  if (!fs.existsSync(modelPath)) {
    throw new Error(`model.json が見つかりません: ${modelPath}`);
  }
  const raw = fs.readFileSync(modelPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`model.json の JSON 解析に失敗しました: ${e.message}`);
  }
}

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
    pushErr(errors, 'model.json のトップレベルはオブジェクトである必要があります');
    return { errors, warnings };
  }

  // --- meta ---
  if (!model.meta || typeof model.meta !== 'object') {
    pushErr(errors, 'meta が必須です（{ title, subtitle?, statusNote? }）');
  } else if (!model.meta.title) {
    pushErr(errors, 'meta.title が必須です');
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
    const explicitNodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const flowNodeIds = new Set(screenIds);
    explicitNodes.forEach((n, i) => {
      if (!n || !n.id) { pushErr(errors, `modes.flow.nodes[${i}] に id がありません`); return; }
      if (screenIds.has(n.id)) pushErr(errors, `modes.flow.nodes の id が screens の id と重複しています: ${n.id}`);
      if (flowNodeIds.has(n.id) && !screenIds.has(n.id)) pushErr(errors, `modes.flow.nodes の id が重複しています: ${n.id}`);
      flowNodeIds.add(n.id);
      if (!n.label) pushWarn(warnings, `modes.flow.nodes.${n.id} に label がありません`);
      if (n.group && !groupIds.has(n.group)) pushErr(errors, `modes.flow.nodes.${n.id}.group が未知の group を参照しています: ${n.group}`);
      else if (!n.group) pushWarn(warnings, `modes.flow.nodes.${n.id} に group がありません（未分類レーンに入ります）`);
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
