#!/usr/bin/env node
/**
 * design-viewer / thumbs.js
 *
 * <viewer-src>/screens/<ID>.html を Playwright で screens[].w × h のビューポートで開き、
 * <out>/thumbs/<ID>.jpg（幅 1080px）と <out>/thumbs/<ID>.s.jpg（幅 270px）を書き出す。
 * ソース HTML のハッシュが変わっていなければ再生成をスキップする（<out>/thumbs/.hash.json）。
 * Playwright が見つからない場合は警告して終了 0（既存のサムネイルがあれば温存する）。
 *
 * 単体実行: node thumbs.js <viewer-src> <out>
 * モジュール利用: const { buildThumbs } = require('./thumbs');
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { readModel } = require('./validate');

const LARGE_W = 1080;
const SMALL_W = 270;
const JPEG_QUALITY = 82;

function loadPlaywright() {
  // リポジトリルートの node_modules/playwright を優先して探す（このスキルはプロジェクト非依存で
  // 他リポジトリへ流用されうるため、まずグローバルな require 解決に任せ、
  // 見つからなければスキル自身から遡って探す）。
  try { return require('playwright'); } catch (e) { /* fallthrough */ }
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'node_modules', 'playwright');
    if (fs.existsSync(candidate)) { try { return require(candidate); } catch (e) { /* continue */ } }
    dir = path.dirname(dir);
  }
  return null;
}

function hashFile(p) {
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
}

async function buildThumbs(viewerSrcDir, outDir, opts) {
  opts = opts || {};
  const result = { generated: 0, skipped: 0, missing: 0, manifest: {} };
  const model = readModel(viewerSrcDir);
  const screens = model.screens || [];
  const screensSrcDir = path.join(viewerSrcDir, 'screens');
  const thumbsDir = path.join(outDir, 'thumbs');
  fs.mkdirSync(thumbsDir, { recursive: true });

  const hashCachePath = path.join(thumbsDir, '.hash.json');
  const manifestPath = path.join(thumbsDir, '.manifest.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(hashCachePath, 'utf8')); } catch (e) { cache = {}; }

  const playwright = loadPlaywright();
  if (!playwright) {
    console.warn('[thumbs] Playwright が見つかりません。サムネイル生成をスキップします（画面は灰色のプレースホルダーになります）');
    let existingManifest = {};
    try { existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { /* none */ }
    result.manifest = existingManifest;
    result.skipped = screens.length;
    return result;
  }

  const { chromium } = playwright;
  const browser = await chromium.launch();
  const newCache = {};
  try {
    for (const s of screens) {
      const srcPath = path.join(screensSrcDir, `${s.id}.html`);
      if (!fs.existsSync(srcPath)) {
        console.warn(`[thumbs] screens/${s.id}.html が無いためスキップします`);
        result.missing++;
        continue;
      }
      const w = s.w || 1440, h = s.h || 900;
      const hash = hashFile(srcPath) + `:${w}x${h}`;
      const largePath = path.join(thumbsDir, `${s.id}.jpg`);
      const smallPath = path.join(thumbsDir, `${s.id}.s.jpg`);
      newCache[s.id] = hash;

      if (!opts.force && cache[s.id] === hash && fs.existsSync(largePath) && fs.existsSync(smallPath)) {
        result.skipped++;
        result.manifest[s.id] = { l: `thumbs/${s.id}.jpg`, s: `thumbs/${s.id}.s.jpg` };
        continue;
      }

      const url = pathToFileURL(srcPath).href;
      for (const [targetW, outPath] of [[LARGE_W, largePath], [SMALL_W, smallPath]]) {
        const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: targetW / w });
        const page = await context.newPage();
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 15000 });
          await page.waitForTimeout(50);
          await page.screenshot({ path: outPath, type: 'jpeg', quality: JPEG_QUALITY });
        } catch (e) {
          console.warn(`[thumbs] ${s.id} のキャプチャに失敗しました: ${e.message}`);
        } finally {
          await context.close();
        }
      }
      result.generated++;
      result.manifest[s.id] = { l: `thumbs/${s.id}.jpg`, s: `thumbs/${s.id}.s.jpg` };
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(hashCachePath, JSON.stringify(newCache, null, 2), 'utf8');
  fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2), 'utf8');
  return result;
}

module.exports = { buildThumbs };

if (require.main === module) {
  (async () => {
    const [viewerSrcArg, outArg] = process.argv.slice(2);
    if (!viewerSrcArg || !outArg) {
      console.error('使い方: node thumbs.js <viewer-src> <out> [--force]');
      process.exit(2);
    }
    const force = process.argv.includes('--force');
    const t0 = Date.now();
    const result = await buildThumbs(path.resolve(viewerSrcArg), path.resolve(outArg), { force });
    console.log(`[thumbs] 生成 ${result.generated} 件 / スキップ(キャッシュ) ${result.skipped} 件 / 未検出 ${result.missing} 件（${Date.now() - t0}ms）`);
  })().catch(e => { console.error('[thumbs] 失敗:', e); process.exit(1); });
}
