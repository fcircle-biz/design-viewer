#!/usr/bin/env node
/**
 * design-viewer / assemble.js
 *
 * engine/（index.html・viewer.css・viewer.js）と、layout.js が書いた <out>/.layout.json、
 * thumbs.js が書いた <out>/thumbs/.manifest.json、viewer-src/screens/* を <out> にまとめ、
 * <out>/viewer-data.js（window.VIEWER_DATA = {...}）を書き出す。
 *
 * <out> 内の既存ファイル（v1 の残骸を含む）は、このビルドが置くもの以外は削除しない
 * （削除するかどうかは人が判断する）。置いたファイルの一覧は最後に表示する。
 *
 * 単体実行: node assemble.js <viewer-src> <out>
 * モジュール利用: const { assemble } = require('./assemble');
 */
'use strict';
const fs = require('fs');
const path = require('path');

function copyRecursive(srcDir, destDir, placed) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d, placed);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      placed.push(d);
    }
  }
}

function assemble(viewerSrcDir, outDir, opts) {
  opts = opts || {};
  const placed = [];
  const warnings = [];
  fs.mkdirSync(outDir, { recursive: true });

  // 1. engine/ のコピー（index.html / viewer.css / viewer.js）
  const engineDir = opts.engineDir || path.join(__dirname, '..', 'engine');
  const engineFiles = ['index.html', 'viewer.css', 'viewer.js'];
  if (!fs.existsSync(engineDir)) {
    warnings.push(`engine/ が見つかりません（${engineDir}）。ビューア本体のコピーをスキップしました`);
  } else {
    for (const f of engineFiles) {
      const s = path.join(engineDir, f);
      if (!fs.existsSync(s)) { warnings.push(`engine/${f} が見つかりません。スキップしました`); continue; }
      const d = path.join(outDir, f);
      fs.copyFileSync(s, d);
      placed.push(d);
    }
  }

  // 2. .layout.json（layout.js の出力）を読む
  const layoutPath = path.join(outDir, '.layout.json');
  if (!fs.existsSync(layoutPath)) {
    throw new Error(`${layoutPath} がありません。先に layout.js を実行してください`);
  }
  const data = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));

  // 3. thumbs マニフェスト（thumbs.js の出力。無ければ {}）
  const manifestPath = path.join(outDir, 'thumbs', '.manifest.json');
  let thumbs = {};
  if (fs.existsSync(manifestPath)) {
    try { thumbs = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { warnings.push(`thumbs/.manifest.json の読み込みに失敗しました: ${e.message}`); }
  }
  data.thumbs = thumbs;

  // 4. viewer-data.js を書き出す
  const viewerDataPath = path.join(outDir, 'viewer-data.js');
  fs.writeFileSync(viewerDataPath, `window.VIEWER_DATA = ${JSON.stringify(data, null, 2)};\n`, 'utf8');
  placed.push(viewerDataPath);

  // 5. screens/ をコピー（等倍プレビュー用）
  const screensSrc = path.join(viewerSrcDir, 'screens');
  if (fs.existsSync(screensSrc)) {
    copyRecursive(screensSrc, path.join(outDir, 'screens'), placed);
  } else {
    warnings.push(`viewer-src/screens が見つかりません（${screensSrc}）。等倍プレビューは動作しません`);
  }

  // thumbs/*.jpg 自体はすでに <out>/thumbs に thumbs.js が書き出し済み（このスクリプトは動かさない）。
  const thumbsDir = path.join(outDir, 'thumbs');
  let thumbCount = 0;
  if (fs.existsSync(thumbsDir)) {
    thumbCount = fs.readdirSync(thumbsDir).filter(f => f.endsWith('.jpg')).length;
  }

  return { placed, warnings, thumbCount, screenCount: (data.screens || []).length };
}

module.exports = { assemble };

if (require.main === module) {
  const [viewerSrcArg, outArg] = process.argv.slice(2);
  if (!viewerSrcArg || !outArg) {
    console.error('使い方: node assemble.js <viewer-src> <out>');
    process.exit(2);
  }
  try {
    const result = assemble(path.resolve(viewerSrcArg), path.resolve(outArg));
    if (result.warnings.length > 0) {
      console.warn(`[assemble] 警告 ${result.warnings.length} 件:`);
      result.warnings.forEach(w => console.warn(`  - ${w}`));
    }
    console.log(`[assemble] 配置したファイル (${result.placed.length} 件):`);
    result.placed.forEach(p => console.log(`  - ${p}`));
    console.log(`[assemble] サムネイル ${result.thumbCount} 枚（画面 ${result.screenCount} 件中）`);
  } catch (e) {
    console.error('[assemble] 失敗:', e.message);
    process.exit(1);
  }
}
