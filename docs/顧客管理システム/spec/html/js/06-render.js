(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // 画像遅延ロード・背景ドット・カリング・メイン render・描画スケジューラ。
  // --- import ---
  var SETTLE_MS, now, recordFrame, stageCtx, zoomPctEl, state, screenToWorld, stepAnim, renderMinimap, RASTER_BUILD_BUDGET_PER_FRAME, SCREEN_RASTER_BUILD_BUDGET_PER_FRAME, nodeRasterBudget, screenRasterBudget, drawGroups, drawEdges, drawNodes, drawHighlights, drawGroupHeaders;
  DV.links.push(function(){
    SETTLE_MS = DV.SETTLE_MS; now = DV.now; recordFrame = DV.recordFrame; stageCtx = DV.stageCtx; zoomPctEl = DV.zoomPctEl; state = DV.state; screenToWorld = DV.screenToWorld; stepAnim = DV.stepAnim; renderMinimap = DV.renderMinimap; RASTER_BUILD_BUDGET_PER_FRAME = DV.RASTER_BUILD_BUDGET_PER_FRAME; SCREEN_RASTER_BUILD_BUDGET_PER_FRAME = DV.SCREEN_RASTER_BUILD_BUDGET_PER_FRAME; nodeRasterBudget = DV.nodeRasterBudget; screenRasterBudget = DV.screenRasterBudget; drawGroups = DV.drawGroups; drawGroupHeaders = DV.drawGroupHeaders; drawEdges = DV.drawEdges; drawNodes = DV.drawNodes; drawHighlights = DV.drawHighlights;
  });
  // --- body ---
  // ---------------------------------------------------------
  // 画像（画面サムネイル）遅延ロード
  // ---------------------------------------------------------
  var imageCache = new Map(); // id -> {l:Image|null, s:Image|null, lLoading, sLoading}
  function getImageEntry(id){
    var e = imageCache.get(id);
    if(!e){ e = { l:null, s:null, lLoading:false, sLoading:false, failed:false }; imageCache.set(id, e); }
    return e;
  }
  function ensureImage(id, which){
    var thumbs = (VIEWER_DATA.thumbs||{})[id];
    if(!thumbs || !thumbs[which]) return null;
    var e = getImageEntry(id);
    var img = e[which];
    if(img) return img;
    var loadingKey = which+'Loading';
    if(e[loadingKey]) return null;
    e[loadingKey] = true;
    var im = new Image();
    im.decoding = 'async';
    im.src = thumbs[which];
    // レンダリングパス（drawImage）で同期デコードのジャンクを起こさないよう、
    // decode() が終わってから「使える」画像として扱う。decode() は描画スレッドを
    // ブロックせずに済む（対応ブラウザでは別スレッド/非同期）。未対応・失敗時は
    // onload にフォールバックする（すでに読み込み完了しているケースも考慮）。
    var markReady = function(){ e[which] = im; e[loadingKey] = false; invalidate(); };
    var markFailed = function(){ e[loadingKey] = false; e.failed = true; console.warn('[viewer] サムネイルを読めませんでした: '+thumbs[which]); invalidate(); };
    if(im.decode){
      im.decode().then(markReady).catch(function(){
        if(im.complete && im.naturalWidth>0) markReady();
        else { im.onload = markReady; im.onerror = markFailed; }
      });
    } else {
      im.onload = markReady;
      im.onerror = markFailed;
    }
    return null;
  }

  // ---------------------------------------------------------
  // 背景ドット
  // ---------------------------------------------------------
  var dotPatternCache = { spacingKey:null, canvas:null, pattern:null };
  function drawBackgroundDots(ctx){
    ctx.fillStyle = '#EEF0F4';
    ctx.fillRect(0,0,rt.cssW,rt.cssH);
    var spacing = 28*state.view.k;
    while(spacing<10) spacing*=4;
    var spacingRounded = Math.round(spacing);
    var key = spacingRounded+'@'+rt.dprCur;
    if(dotPatternCache.spacingKey!==key){
      var tile = document.createElement('canvas');
      var tsize = Math.max(4, Math.round(spacingRounded*rt.dprCur));
      tile.width = tsize; tile.height = tsize;
      var tctx = tile.getContext('2d');
      tctx.fillStyle = '#C7CDD9';
      tctx.beginPath();
      tctx.arc(tsize/2, tsize/2, Math.max(1, 1.4*rt.dprCur), 0, Math.PI*2);
      tctx.fill();
      dotPatternCache.spacingKey = key;
      dotPatternCache.canvas = tile;
      dotPatternCache.pattern = ctx.createPattern(tile, 'repeat');
    }
    var ox = ((state.view.x % spacing)+spacing)%spacing;
    var oy = ((state.view.y % spacing)+spacing)%spacing;
    ctx.save();
    ctx.translate(ox, oy);
    if(dotPatternCache.pattern.setTransform){
      try{ dotPatternCache.pattern.setTransform(new DOMMatrix().scale(1/rt.dprCur)); }catch(err){}
    }
    ctx.fillStyle = dotPatternCache.pattern;
    ctx.fillRect(-ox, -oy, rt.cssW+spacing, rt.cssH+spacing);
    ctx.restore();
  }

  // ---------------------------------------------------------
  // カリング用ビューポート矩形（ワールド座標、余白付き）
  // ---------------------------------------------------------
  function getCullRect(){
    var margin = 200;
    var tl = screenToWorld(-margin,-margin), br = screenToWorld(rt.cssW+margin, rt.cssH+margin);
    return { x:tl.x, y:tl.y, x2:br.x, y2:br.y };
  }
  function rectIntersects(r, cull){
    return r.x < cull.x2 && r.x+r.w > cull.x && r.y < cull.y2 && r.y+r.h > cull.y;
  }

  // ---------------------------------------------------------
  // 近傍のみ表示 - 表示対象ノード id 集合
  // ---------------------------------------------------------
  function visibleNodeIdSet(){
    if(!state.neighborOnly || !state.selected) return null;
    var set = new Set([state.selected]);
    state.currentEdges.forEach(function(e){
      if(e.from===state.selected) set.add(e.to);
      else if(e.to===state.selected) set.add(e.from);
    });
    return set;
  }

  // ---------------------------------------------------------
  // メイン描画
  // ---------------------------------------------------------
  var FONT_STACK = '"Segoe UI","Yu Gothic UI","Hiragino Sans","Meiryo",system-ui,sans-serif';

  var lastZoomLabel = null;
  function render(){
    var t0 = now();
    var animating = stepAnim();
    var zoomLabelNow = Math.round(state.view.k*100);
    if(zoomLabelNow!==lastZoomLabel){ lastZoomLabel=zoomLabelNow; zoomPctEl.textContent = zoomLabelNow+'%'; }

    var ctx = stageCtx;
    ctx.setTransform(rt.dprCur,0,0,rt.dprCur,0,0);
    ctx.clearRect(0,0,rt.cssW,rt.cssH);

    if(!state.mode){ recordFrame(now()-t0); return; }

    drawBackgroundDots(ctx);

    var cull = getCullRect();
    var visSet = visibleNodeIdSet();
    var focusId = state.hovered || state.selected;
    var connected = null;
    if(focusId){
      connected = new Set();
      state.currentEdges.forEach(function(e){ if(e.from===focusId || e.to===focusId) connected.add(e); });
    }

    nodeRasterBudget.remaining = RASTER_BUILD_BUDGET_PER_FRAME;
    nodeRasterBudget.catchup = false;
    screenRasterBudget.remaining = SCREEN_RASTER_BUILD_BUDGET_PER_FRAME;
    screenRasterBudget.catchup = false;

    drawGroups(ctx, cull);
    drawEdges(ctx, cull, visSet, connected, focusId);
    drawNodes(ctx, cull, visSet);
    drawHighlights(ctx);
    drawGroupHeaders(ctx);

    renderMinimap();

    recordFrame(now()-t0);
    if(animating || nodeRasterBudget.catchup || screenRasterBudget.catchup){ invalidate(); }
  }
  // ---------------------------------------------------------
  // 描画スケジューラ（待機中は rAF もタイマーも回さない）
  // ---------------------------------------------------------
  var rafId = 0, settleTimer = 0;
  function invalidate(){
    if(!rafId) rafId = requestAnimationFrame(function(){ rafId=0; render(); });
  }
  function onViewChanged(){
    if(settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function(){ settleTimer=0; rt.minimapBgDirty=true; invalidate(); }, SETTLE_MS);
    rt.minimapBgDirty = true;
  }
  // --- body end ---
  // --- export ---
  DV.ensureImage = ensureImage; DV.rectIntersects = rectIntersects; DV.visibleNodeIdSet = visibleNodeIdSet; DV.FONT_STACK = FONT_STACK; DV.invalidate = invalidate; DV.onViewChanged = onViewChanged;
})();
