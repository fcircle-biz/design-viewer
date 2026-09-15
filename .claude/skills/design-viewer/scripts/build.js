#!/usr/bin/env node
/**
 * design-viewer / build.js
 *
 * validate.js → layout.js → thumbs.js → assemble.js を順に実行する。
 *
 * 使い方: node build.js <viewer-src> <out> [--skip-thumbs] [--force-thumbs]
 *   --skip-thumbs   サムネイル生成を飛ばす（Playwright が無い環境、または高速確認したいとき）
 *   --force-thumbs  ハッシュキャッシュを無視してサムネイルを再生成する
 *
 * 各ステップは独立したプロセスとして spawn する（各スクリプトが単体実行できることの裏返し）。
 * validate.js がエラーを検出した場合はそこで打ち切る。thumbs.js は失敗しても
 * （Playwright 不在など）警告に留めてビルド全体は続行する。
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

function run(script, args) {
  const scriptPath = path.join(__dirname, script);
  console.log(`\n[build] > node ${script} ${args.join(' ')}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [scriptPath, ...args], { stdio: 'inherit' });
  const ms = Date.now() - t0;
  console.log(`[build] < ${script} 終了コード ${r.status}（${ms}ms）`);
  return { status: r.status, ms };
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const [viewerSrcArg, outArg] = positional;
  if (!viewerSrcArg || !outArg) {
    console.error('使い方: node build.js <viewer-src> <out> [--skip-thumbs] [--force-thumbs]');
    process.exit(2);
  }
  const viewerSrc = path.resolve(viewerSrcArg);
  const out = path.resolve(outArg);
  const skipThumbs = flags.has('--skip-thumbs');
  const forceThumbs = flags.has('--force-thumbs');

  const totalT0 = Date.now();
  const timings = {};

  let r = run('validate.js', [viewerSrc]);
  timings.validate = r.ms;
  if (r.status !== 0) {
    console.error('\n[build] validate.js がエラーを検出したため中断しました。');
    process.exit(1);
  }

  r = run('layout.js', [viewerSrc, out]);
  timings.layout = r.ms;
  if (r.status !== 0) {
    console.error('\n[build] layout.js が失敗したため中断しました。');
    process.exit(1);
  }

  if (!skipThumbs) {
    const thumbArgs = [viewerSrc, out];
    if (forceThumbs) thumbArgs.push('--force');
    r = run('thumbs.js', thumbArgs);
    timings.thumbs = r.ms;
    if (r.status !== 0) {
      console.warn('\n[build] thumbs.js が非 0 終了しましたが、ビルドは続行します（画面はプレースホルダーになります）。');
    }
  } else {
    console.log('\n[build] --skip-thumbs によりサムネイル生成を飛ばします。');
  }

  r = run('assemble.js', [viewerSrc, out]);
  timings.assemble = r.ms;
  if (r.status !== 0) {
    console.error('\n[build] assemble.js が失敗したため中断しました。');
    process.exit(1);
  }

  const totalMs = Date.now() - totalT0;
  console.log('\n[build] 完了。所要時間(ms):', timings, '合計:', totalMs);
  console.log(`[build] 出力先: ${out}`);
}

main();
