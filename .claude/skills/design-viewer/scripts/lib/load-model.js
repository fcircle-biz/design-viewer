#!/usr/bin/env node
/**
 * design-viewer / lib/load-model.js
 *
 * <viewer-src>/model.json または <viewer-src>/model/**\/*.json を読み込み、
 * 単一の model オブジェクトを返す共通ローダー。model.json を読む全スクリプト
 * （validate.js / layout.js / thumbs.js）はここを経由する。
 *
 * 入力は次のどちらか一方（両方あればエラー）:
 *   - 従来どおりの <viewer-src>/model.json
 *   - <viewer-src>/model/ 配下の *.json（サブディレクトリも再帰的に対象。model.json 全体を
 *     いくつかに分割し、それぞれが「model.json の一部分」と同じ形（例:
 *     { "modes": { "biz": { … } } }）を持つ）
 *
 * model/ 方式のマージ規則（詳細は ../../schema/model.md §1.1）:
 *   1. ファイルはディレクトリ相対パスをそのまま文字列として '/' 区切りで比較した辞書順
 *      （プラットフォーム非依存。OS のパス区切りに関係なく '/' で比較する）で読む。
 *      ELK.js はノード・辺の記述順をある程度尊重するため、読み込み順を制御したい場合は
 *      ファイル名に `10-` のような数字接頭辞を付ける。
 *   2. 深いマージ。オブジェクト同士は再帰マージ、配列同士は連結（読み込み順で後ろに追加）。
 *      それ以外の組み合わせ（片方または両方がオブジェクト・配列でない、あるいは型が違う）で
 *      同じキーが複数ファイルに現れた場合はエラーにする（どちらの値も採用できないため）。
 *   3. JSON のパースエラーはファイル名付きで報告する。
 *
 * 単体実行: node load-model.js <viewer-src>（読み込んだ model を整形して表示するだけ）
 * モジュール利用: const { readModel } = require('./lib/load-model');
 */
'use strict';
const fs = require('fs');
const path = require('path');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** ディレクトリ相対パス（'/' 区切りの文字列）の辞書順比較。プラットフォーム非依存。 */
function comparePosixPath(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** dir 配下の *.json をサブディレクトリも含めて再帰的に集め、dir からの相対パス（'/' 区切り）の辞書順で返す。 */
function listJsonFilesSorted(dir) {
  const out = [];
  (function walk(current, relPrefix) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        out.push({ abs, rel });
      }
    }
  })(dir, '');
  out.sort((a, b) => comparePosixPath(a.rel, b.rel));
  return out;
}

function parseJsonFile(absPath, displayName) {
  const raw = fs.readFileSync(absPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${displayName} の JSON 解析に失敗しました: ${e.message}`);
  }
}

/**
 * value を keyPath に新規追加したときの由来ファイルを記録する。value がオブジェクトなら
 * その中身（キーごと）も同じファイル由来として再帰的に記録する（配列の要素までは辿らない。
 * 配列は連結の単位であり要素ごとにマージすることはないため）。
 */
function recordOrigin(originMap, keyPath, file, value) {
  originMap.set(keyPath, [file]);
  if (isPlainObject(value)) {
    Object.keys(value).forEach(k => recordOrigin(originMap, `${keyPath}.${k}`, file, value[k]));
  }
}

/**
 * incoming（1 ファイル分の内容）を target に深くマージする（target を破壊的に更新する）。
 * - 両方オブジェクト: キーごとに再帰
 * - 両方配列: target の後ろに incoming を連結
 * - それ以外で両方に値がある: エラー（キーのパスと関与した 2 つのファイル名を示す）
 */
function mergeInto(target, incoming, incomingFile, pathPrefix, originMap) {
  for (const key of Object.keys(incoming)) {
    const keyPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const incomingVal = incoming[key];
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = incomingVal;
      recordOrigin(originMap, keyPath, incomingFile, incomingVal);
      continue;
    }
    const existingVal = target[key];
    if (isPlainObject(existingVal) && isPlainObject(incomingVal)) {
      const files = originMap.get(keyPath) || [];
      originMap.set(keyPath, [...files, incomingFile]);
      mergeInto(existingVal, incomingVal, incomingFile, keyPath, originMap);
    } else if (Array.isArray(existingVal) && Array.isArray(incomingVal)) {
      target[key] = existingVal.concat(incomingVal);
      const files = originMap.get(keyPath) || [];
      originMap.set(keyPath, [...files, incomingFile]);
    } else {
      const existingFiles = originMap.get(keyPath) || [];
      throw new Error(
        `model の分割ファイルの統合に失敗しました: キー "${keyPath}" が複数のファイルに重複しています`
        + `（${[...existingFiles, incomingFile].join(' と ')}）。`
        + 'オブジェクト同士・配列同士以外の重複はマージできません（型が違う場合も同様です）。'
      );
    }
  }
}

/** <viewer-src>/model/ 配下の *.json をマージして 1 つの model を作る。 */
function loadModelDir(modelDirAbs, viewerSrcDir) {
  const files = listJsonFilesSorted(modelDirAbs);
  if (files.length === 0) {
    throw new Error(`model/ 配下に *.json ファイルが見つかりません: ${modelDirAbs}`);
  }
  const result = {};
  const originMap = new Map();
  for (const f of files) {
    const displayName = path.relative(viewerSrcDir, f.abs).split(path.sep).join('/');
    const data = parseJsonFile(f.abs, displayName);
    if (!isPlainObject(data)) {
      throw new Error(`${displayName} のトップレベルはオブジェクトである必要があります`);
    }
    mergeInto(result, data, displayName, '', originMap);
  }
  return result;
}

/**
 * <viewer-src>/model.json または <viewer-src>/model/ を読み込んでパースする。
 * どちらも無い/両方ある/JSON が壊れている場合は例外を投げる。
 */
function readModel(viewerSrcDir) {
  const modelJsonPath = path.join(viewerSrcDir, 'model.json');
  const modelDirPath = path.join(viewerSrcDir, 'model');
  const hasModelJson = fs.existsSync(modelJsonPath) && fs.statSync(modelJsonPath).isFile();
  const hasModelDir = fs.existsSync(modelDirPath) && fs.statSync(modelDirPath).isDirectory();

  if (hasModelJson && hasModelDir) {
    throw new Error(
      `model.json と model/ の両方が存在します（${viewerSrcDir}）。`
      + 'どちらを入力として使うか曖昧なため、どちらか一方だけにしてください。'
    );
  }
  if (!hasModelJson && !hasModelDir) {
    throw new Error(`model.json も model/ も見つかりません: ${viewerSrcDir}`);
  }
  if (hasModelJson) {
    return parseJsonFile(modelJsonPath, 'model.json');
  }
  return loadModelDir(modelDirPath, viewerSrcDir);
}

module.exports = { readModel };

if (require.main === module) {
  const viewerSrcDir = process.argv[2];
  if (!viewerSrcDir) {
    console.error('使い方: node load-model.js <viewer-src>');
    process.exit(2);
  }
  try {
    const model = readModel(path.resolve(viewerSrcDir));
    console.log(JSON.stringify(model, null, 2));
  } catch (e) {
    console.error(`[load-model] ${e.message}`);
    process.exit(1);
  }
}
