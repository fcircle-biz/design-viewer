(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // ノード本体・カード・選択ハイライトの描画。
  // --- import ---
  var LIVE_MIN_PX, TEXT_MIN_SCALE, CARD_TITLE_MIN_PX, getIconPath, roundRectPath, measureCached, truncateText, registry, screensById, batchesById, state, worldRectToScreen, pickBucket, getRaster, getScreenRaster, BIZ_DOT_COLOR, JOB_DOT_COLOR, BIZ_LABEL_WORLD_PX, drawBizLabelOverlay, CONCEPT_VARIANT_COLOR, ER_TONE_GRAD, DFD_VARIANT_COLOR, ensureImage, rectIntersects, FONT_STACK;
  DV.links.push(function(){
    LIVE_MIN_PX = DV.LIVE_MIN_PX; TEXT_MIN_SCALE = DV.TEXT_MIN_SCALE; CARD_TITLE_MIN_PX = DV.CARD_TITLE_MIN_PX; getIconPath = DV.getIconPath; roundRectPath = DV.roundRectPath; measureCached = DV.measureCached; truncateText = DV.truncateText; registry = DV.registry; screensById = DV.screensById; batchesById = DV.batchesById; state = DV.state; worldRectToScreen = DV.worldRectToScreen; pickBucket = DV.pickBucket; getRaster = DV.getRaster; getScreenRaster = DV.getScreenRaster; BIZ_DOT_COLOR = DV.BIZ_DOT_COLOR; JOB_DOT_COLOR = DV.JOB_DOT_COLOR; BIZ_LABEL_WORLD_PX = DV.BIZ_LABEL_WORLD_PX; drawBizLabelOverlay = DV.drawBizLabelOverlay; CONCEPT_VARIANT_COLOR = DV.CONCEPT_VARIANT_COLOR; ER_TONE_GRAD = DV.ER_TONE_GRAD; DFD_VARIANT_COLOR = DV.DFD_VARIANT_COLOR; ensureImage = DV.ensureImage; rectIntersects = DV.rectIntersects; FONT_STACK = DV.FONT_STACK;
  });
  // --- body ---
  function drawNodes(ctx, cull, visSet){
    var ids = state.currentNodeIds;
    for(var i=0;i<ids.length;i++){
      var entry = registry.get(ids[i]);
      if(!entry || !entry.cur) continue;
      if(visSet && !visSet.has(entry.id)) continue;
      var c = entry.cur;
      if(c.op<=0.02) continue;
      if(!rectIntersects({x:c.x,y:c.y,w:c.w,h:c.h}, cull)) continue;
      var sr = worldRectToScreen(c);
      if(sr.x>rt.cssW || sr.y>rt.cssH || sr.x+sr.w<0 || sr.y+sr.h<0) continue;

      ctx.save();
      ctx.globalAlpha = c.op;
      if(entry.kind==='screen') drawScreenNode(ctx, entry, sr, c);
      else if(entry.kind==='batch') drawBatchNode(ctx, entry, sr, c);
      else drawCacheableNode(ctx, entry, sr, c);
      ctx.restore();
    }
  }

  var SCREEN_HEAD_MIN_W = 90;
  function drawScreenNode(ctx, entry, sr, c){
    var scr = screensById.get(entry.id) || {};
    var mp = entry.modePos[state.mode];
    var card = mp && mp.node && mp.node.card;
    if(card){ drawScreenCard(ctx, entry, scr, sr, c, card); return; }
    var isTeams = scr.platform==='teams';
    roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, 14*state.view.k);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = isTeams?1.4:1;
    ctx.strokeStyle = isTeams ? 'rgba(91,95,199,.5)' : 'rgba(20,30,50,.14)';
    ctx.stroke();

    drawScreenImage(ctx, entry, sr.x+1, sr.y+1, Math.max(0,sr.w-2), Math.max(0,sr.h-2), c.w, c.h);
    // 表（機能一覧の arrange: "table"）では ID・画面名を表の列に出すので、サムネイルの上には描かない
    if(mp && mp.node && mp.node.table) return;

    // 見出し（スクリーン座標固定サイズ）。サムネイルが画面上で SCREEN_HEAD_MIN_W 未満の縮尺では
    // 文字が隣の画面にはみ出して読めないので描かない（layout.js の GALLERY_HEAD_MIN_W と揃える）
    drawNodeHeading(ctx, entry.id, scr.title, screenTagText(scr), scr.platform==='teams' ? '#5B5FC7' : '#2F5BEA', sr);
  }

  // 機能一覧（格子）のノードの上に出す「ID タイトル」と右端のタグ（画面・バッチ共通）
  function drawNodeHeading(ctx, id, title, tagText, tagColor, sr){
    if(sr.w < SCREEN_HEAD_MIN_W) return;
    var headY = sr.y-8;
    ctx.font = '700 12px '+FONT_STACK;
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    var idText = id+'  ';
    var idW = measureCached(ctx, idText, ctx.font);
    var maxHeadW = Math.max(40, sr.w);
    ctx.fillStyle = '#8A93A3';
    ctx.fillText(idText, sr.x, headY);
    ctx.fillStyle = '#1A2029';
    var titleMaxW = Math.max(10, maxHeadW-idW-(sr.w>=300?100:0));
    ctx.fillText(truncateText(ctx, title||'', ctx.font, titleMaxW), sr.x+idW, headY);
    if(sr.w>=300 && tagText){
      ctx.font = '700 10px '+FONT_STACK;
      var tw = measureCached(ctx, tagText, ctx.font)+16;
      var tx = sr.x+sr.w-tw;
      roundRectPath(ctx, tx, headY-13, tw, 17, 999);
      ctx.fillStyle = tagColor;
      ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(tagText, tx+tw/2, headY-13+9);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    }
  }

  // バッチ機能（batches[]）のカード。画面イメージが無いので、時計のアイコン・名称・起動のタイミングを描く。
  // 文字はズームに比例する（カードの短辺に対する比率）。表（機能一覧の arrange: "table"）では名称・起動を列に出すので
  // アイコンと「バッチ」の文字だけにする。
  var BATCH_COLOR = { card:'#F3FAF8', border:'#8CCBC0', iconBg:'#DDF1EC', fg:'#0F766E' };
  function drawBatchNode(ctx, entry, sr, c){
    var b = batchesById.get(entry.id) || {};
    var mp = entry.modePos[state.mode];
    var inTable = !!(mp && mp.node && mp.node.table);
    var s = Math.min(sr.w, sr.h);
    roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, s*0.08);
    ctx.fillStyle = BATCH_COLOR.card; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = BATCH_COLOR.border; ctx.stroke();
    if(s < 6) return;
    var cx = sr.x+sr.w/2;
    var sched = inTable ? 'バッチ' : b.schedule;
    var titlePx = inTable ? 0 : s*0.075, schedPx = s*(inTable ? 0.13 : 0.055);
    var box = s*(inTable ? 0.42 : 0.3);
    var textH = (titlePx>=6 ? titlePx*1.5 : 0) + (schedPx>=6 && sched ? schedPx*1.5 : 0);
    var boxY = sr.y + (sr.h - box - textH)/2;
    roundRectPath(ctx, cx-box/2, boxY, box, box, box*0.26);
    ctx.fillStyle = BATCH_COLOR.iconBg; ctx.fill();
    ctx.save();
    var icon = box*0.62;
    ctx.translate(cx-icon/2, boxY+box/2-icon/2);
    ctx.scale(icon/24, icon/24);
    ctx.strokeStyle = BATCH_COLOR.fg; ctx.lineWidth = 1.8; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.stroke(getIconPath('clock'));
    ctx.restore();
    var ty = boxY + box + s*0.04;
    ctx.textAlign='center'; ctx.textBaseline='top';
    if(titlePx >= 6){
      ctx.font = '800 '+titlePx.toFixed(2)+'px '+FONT_STACK;
      ctx.fillStyle = '#1A2029';
      ctx.fillText(truncateText(ctx, b.title||'', ctx.font, sr.w*0.86), cx, ty);
      ty += titlePx*1.5;
    }
    if(schedPx >= 6 && sched){
      ctx.font = '600 '+schedPx.toFixed(2)+'px '+FONT_STACK;
      ctx.fillStyle = BATCH_COLOR.fg;
      ctx.fillText(truncateText(ctx, sched, ctx.font, sr.w*0.86), cx, ty);
    }
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    if(!inTable) drawNodeHeading(ctx, entry.id, b.title, 'バッチ', BATCH_COLOR.fg, sr);
  }

  function platformName(scr, appName){
    if(scr.platform==='teams') return 'Teams';
    if(!scr.platform || scr.platform==='app') return appName;
    return scr.platform;
  }

  function screenTagText(scr){
    return platformName(scr, 'App')+(scr.role ? ' / '+scr.role : '');
  }

  // 文字幅は 100px の基準フォントで測って比例計算する（カードの文字はズームに合わせて
  // 連続的に大きさが変わるため、実サイズのフォント文字列で測るとキャッシュが効かない）
  function scaledFont(weight, px){ return weight+' '+px.toFixed(2)+'px '+FONT_STACK; }
  function measureScaled(ctx, text, weight, px){ return measureCached(ctx, text, weight+' 100px '+FONT_STACK)*px/100; }
  function truncateScaled(ctx, text, weight, px, maxWidth){ return truncateText(ctx, text, weight+' 100px '+FONT_STACK, maxWidth*100/px); }

  // layout: "elk" の画面カード（docs/design-viewer-elk.html の .node と同じ構成）:
  // 白い角丸カード、上部に「ID タイトル」と役割バッジ、その下に角丸枠付きのサムネイル。
  // 寸法は参照 px（幅 360 のカード基準）× card.unit のワールド座標で、文字もズームに比例する。
  function drawScreenCard(ctx, entry, scr, sr, c, card){
    var k = sr.w / c.w;
    var u = card.unit * k;                     // 参照 1px あたりのスクリーン px
    ctx.fillStyle = 'rgba(27,39,56,.07)';
    roundRectPath(ctx, sr.x, sr.y+8*u, sr.w, sr.h, card.radius*k);
    ctx.fill();
    roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, card.radius*k);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#D5DDE7'; ctx.stroke();

    var ix = sr.x+card.pad*k, iy = sr.y+card.header*k, iw = card.thumbW*k, ih = card.thumbH*k;
    drawScreenImage(ctx, entry, ix, iy, iw, ih, card.thumbW, card.thumbH);
    roundRectPath(ctx, ix, iy, iw, ih, 12*u);
    ctx.lineWidth = 1; ctx.strokeStyle = '#DDE3EB'; ctx.stroke();

    var cy = sr.y + 26*u, left = sr.x + 14*u, right = sr.x + sr.w - 14*u;
    var titlePx = 15*u, badgePx = 11*u;
    if(titlePx < CARD_TITLE_MIN_PX){
      // 縮小時はカード内の見出しが読めないため、カードの上に固定サイズで「ID タイトル」を出す
      // （全体表示で画面遷移を読めるようにする）
      ctx.fillStyle = '#D7DEE8';
      roundRectPath(ctx, left, cy-3*u, (right-left)*0.55, 6*u, 3*u); ctx.fill();
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.font = '700 '+CARD_TITLE_MIN_PX+'px '+FONT_STACK;
      ctx.fillStyle = '#8390A1';
      ctx.fillText(entry.id, sr.x, sr.y-6);
      var idW2 = measureCached(ctx, entry.id, ctx.font) + 5;
      ctx.font = '800 '+CARD_TITLE_MIN_PX+'px '+FONT_STACK;
      ctx.fillStyle = '#1D2735';
      ctx.fillText(truncateText(ctx, scr.title||'', ctx.font, Math.max(sr.w-idW2, 60)), sr.x+idW2, sr.y-6);
      return;
    }
    ctx.textBaseline = 'middle';
    var badgeW = 0;
    if(badgePx >= 4){
      var tagText = screenTagText(scr);
      badgeW = measureScaled(ctx, tagText, '800', badgePx) + 16*u;
      var bh = 21*u;
      roundRectPath(ctx, right-badgeW, cy-bh/2, badgeW, bh, bh/2);
      ctx.fillStyle = scr.platform==='teams' ? '#5B5FC7' : '#2F6DFF'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.font = scaledFont('800', badgePx);
      ctx.fillText(tagText, right-badgeW/2, cy+0.5*u);
    }
    ctx.textAlign = 'left';
    var idText = entry.id;
    var idW = measureScaled(ctx, idText, '700', titlePx) + 7*u;
    ctx.font = scaledFont('700', titlePx);
    ctx.fillStyle = '#8390A1';
    ctx.fillText(idText, left, cy);
    var titleMax = right - badgeW - 10*u - (left+idW);
    if(titleMax > 8){
      ctx.font = scaledFont('800', titlePx);
      ctx.fillStyle = '#1D2735';
      ctx.fillText(truncateScaled(ctx, scr.title||'', '800', titlePx, titleMax), left+idW, cy);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // 画面サムネイル本体。(ix,iy,iw,ih) はスクリーン座標の描画先、worldW/worldH はラスタキャッシュの基準寸法。
  function drawScreenImage(ctx, entry, ix, iy, iw, ih, worldW, worldH){
    // 画像は clip() せずに描く（大きな面積の clip() は毎フレームのコストが大きい。
    // 背景・枠の角丸描画だけで「角丸カード」に見え、画像の角がわずかに角丸から
    // はみ出す程度は許容する）。表示サイズより大きい元 JPEG を毎フレーム縮小すると
    // ズーム連打でフレームが詰まるため、表示サイズに近い縮小コピー（mip キャッシュ）
    // を介して描く。デコード未完了の画像は使わず（drawImage の同期ジャンク回避）、
    // 望む解像度がまだ無ければ逆側（大⇄小）で代用する。
    var devicePx = iw*rt.dprCur;
    var wantWhich = devicePx>LIVE_MIN_PX ? 'l' : 's';
    var altWhich = wantWhich==='l' ? 's' : 'l';
    var which = wantWhich, img = ensureImage(entry.id, wantWhich);
    if(!img){ img = ensureImage(entry.id, altWhich); which = altWhich; }
    if(img){
      var bucket = pickBucket(state.view.k, rt.dprCur);
      var rec = getScreenRaster(entry, worldW, worldH, bucket, img, which);
      if(rec){
        ctx.drawImage(rec.canvas, 0,0, rec.w, rec.h, ix, iy, iw, ih);
      } else {
        // 縮小コピーが未構築（予算切れ・初回）のときのフォールバック。ここで元の
        // 大サムネイル（最大 1080w）を直接 drawImage すると、縮小コピーを作る
        // 目的そのものが台無しになる（連続ズーム中は毎フレームここを通りかねない）ため、
        // 軽い「小」サムネイル（270w。無ければプレースホルダー）で代用し、
        // 縮小コピーができ次第、次のフレームで正しいものに差し替わる。
        var smallImg = ensureImage(entry.id, 's');
        if(smallImg){ ctx.drawImage(smallImg, ix, iy, iw, ih); }
        else {
          ctx.fillStyle = '#F6F7FA';
          ctx.fillRect(ix, iy, iw, ih);
        }
      }
    } else {
      ctx.fillStyle = '#F6F7FA';
      ctx.fillRect(ix, iy, iw, ih);
      if(iw>60 && ih>40){
        ctx.fillStyle = '#B7BEC9';
        ctx.font = '600 '+Math.max(10,Math.min(16,iw*0.06))+'px '+FONT_STACK;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(entry.id, ix+iw/2, iy+ih/2);
        ctx.textAlign='left'; ctx.textBaseline='alphabetic';
      }
    }
  }

  function drawSimpleBox(ctx, entry, sr){
    var mp = entry.modePos[state.mode];
    var n = (mp && mp.node) || {};
    var fill = '#2F5BEA';
    if(entry.kind==='er') fill = (ER_TONE_GRAD[n.tone]||ER_TONE_GRAD.slate)[0];
    else if(entry.kind==='concept') fill = (CONCEPT_VARIANT_COLOR[n.variant]||CONCEPT_VARIANT_COLOR.entity).fg;
    else if(entry.kind==='biz') fill = BIZ_DOT_COLOR[n.variant] || BIZ_DOT_COLOR.task;
    else if(entry.kind==='job') fill = JOB_DOT_COLOR[n.variant] || JOB_DOT_COLOR.job;
    else if(entry.kind==='dfd') fill = (DFD_VARIANT_COLOR[n.variant]||DFD_VARIANT_COLOR.proc).fg;
    else if(entry.kind==='pill') fill = '#1A2029';
    roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, Math.min(10, sr.w/4));
    ctx.fillStyle = fill; ctx.fill();
  }
  // dfd の proc/ext ノードは左上にノード本体の矩形外へはみ出すコードバッジ（P1 等。
  // 05-shapes.js の drawDfdContent 参照）を描くため、ラスタキャンバスに余白を確保しないと
  // 上端で切れる。バッジは (-10,-10) から幅 bw・高さ 22 で描かれるので、それを覆う余白を取る。
  var DFD_CODE_BADGE_PAD = 14;
  function dfdRasterPad(entry, n){
    return (entry.kind==='dfd' && n.variant!=='store' && n.code) ? DFD_CODE_BADGE_PAD : 0;
  }
  var BIZ_LABEL_OVERLAY_MIN_PX = 10; // 画面上でこれ未満になったらラスタ文字→オーバーレイに切り替え
  function drawCacheableNode(ctx, entry, sr, c){
    var mp = entry.modePos[state.mode];
    var n = (mp && mp.node) || {};
    var unit = n.unit || 1;   // layout: "elk" の起点ノードは文字も unit 倍で大きい
    var deviceScale = state.view.k*rt.dprCur*unit;
    if(deviceScale < TEXT_MIN_SCALE){
      // 文字を描かず色付きの箱だけ
      drawSimpleBox(ctx, entry, sr);
      return;
    }
    // biz / job: ラスタ内の label が画面上で読めなくなる倍率では、ラスタは文字なしで
    // 作り直し、代わりに画面固定サイズのオーバーレイラベルを重ねて描く（二重描画防止）。
    var noText = false, overlayNode = null;
    if(entry.kind==='biz' || entry.kind==='job'){
      var labelWorldPx = BIZ_LABEL_WORLD_PX[n.variant] || 15;
      if(labelWorldPx*state.view.k < BIZ_LABEL_OVERLAY_MIN_PX){
        noText = true;
        if(sr.w>=44) overlayNode = n;
      }
    }
    var bucket = pickBucket(state.view.k, rt.dprCur);
    var pad = dfdRasterPad(entry, n);
    var rec = getRaster(entry, c.w, c.h, bucket, noText, pad);
    if(!rec){ drawSimpleBox(ctx, entry, sr); return; }
    if(rec.pad){
      // ラスタは四辺に rec.pad（ワールド px）分の余白を含むので、画面側でも同じ比率で
      // 外側に広げて描く（中心の本体部分はちょうど sr に一致する）。
      var padPxX = rec.pad*(sr.w/c.w), padPxY = rec.pad*(sr.h/c.h);
      ctx.drawImage(rec.canvas, 0,0, rec.w, rec.h, sr.x-padPxX, sr.y-padPxY, sr.w+2*padPxX, sr.h+2*padPxY);
    } else {
      ctx.drawImage(rec.canvas, 0,0, rec.w, rec.h, sr.x, sr.y, sr.w, sr.h);
    }
    if(overlayNode) drawBizLabelOverlay(ctx, overlayNode, sr);
  }

  function drawHighlights(ctx){
    if(state.hovered){
      var eh = registry.get(state.hovered);
      if(eh && eh.cur && eh.cur.op>0.02) drawHiBox(ctx, eh.cur, '#7C3AED', 'rgba(124,58,237,.12)');
    }
    if(state.selected && state.selected!==state.hovered){
      var es = registry.get(state.selected);
      if(es && es.cur && es.cur.op>0.02) drawHiBox(ctx, es.cur, '#2F5BEA', 'rgba(47,91,234,.16)');
    }
  }
  function drawHiBox(ctx, rectWorld, stroke, glow){
    var sr = worldRectToScreen(rectWorld);
    ctx.save();
    ctx.strokeStyle = glow; ctx.lineWidth = 9;
    roundRectPath(ctx, sr.x-6, sr.y-6, sr.w+12, sr.h+12, 14);
    ctx.stroke();
    ctx.strokeStyle = stroke; ctx.lineWidth = 2.5;
    roundRectPath(ctx, sr.x-6, sr.y-6, sr.w+12, sr.h+12, 14);
    ctx.stroke();
    ctx.restore();
  }
  // --- body end ---
  // --- export ---
  DV.drawNodes = drawNodes; DV.drawHighlights = drawHighlights; DV.platformName = platformName; DV.scaledFont = scaledFont; DV.measureScaled = measureScaled;
})();
