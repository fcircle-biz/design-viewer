(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // ミニマップ描画とノード／画面ラスタキャッシュ。
  // --- import ---
  var LOD_BUCKETS, RASTER_CACHE_MAX, minimapEl, minimapCtx, minimapCardEl, registry, state, screenToWorld, drawNodeRasterContent, BIZ_MINIMAP_COLOR, JOB_MINIMAP_COLOR, ARCH_MINIMAP_COLOR, invalidate, onViewChanged;
  DV.links.push(function(){
    LOD_BUCKETS = DV.LOD_BUCKETS; RASTER_CACHE_MAX = DV.RASTER_CACHE_MAX; minimapEl = DV.minimapEl; minimapCtx = DV.minimapCtx; minimapCardEl = DV.minimapCardEl; registry = DV.registry; state = DV.state; screenToWorld = DV.screenToWorld; drawNodeRasterContent = DV.drawNodeRasterContent; BIZ_MINIMAP_COLOR = DV.BIZ_MINIMAP_COLOR; JOB_MINIMAP_COLOR = DV.JOB_MINIMAP_COLOR; ARCH_MINIMAP_COLOR = DV.ARCH_MINIMAP_COLOR; invalidate = DV.invalidate; onViewChanged = DV.onViewChanged;
  });
  // --- body ---
  // ---------------------------------------------------------
  // ミニマップ
  // ---------------------------------------------------------
  var minimapBgCanvas = document.createElement('canvas');
  var minimapGeom = null; // {scale, offX, offY}

  function computeMinimapGeom(){
    var mw = minimapEl.__cssW||minimapEl.clientWidth||1, mh = minimapEl.__cssH||minimapEl.clientHeight||1;
    var b = state.modeBounds;
    var pad = 8;
    var sx = (mw-pad*2)/b.w, sy = (mh-pad*2)/b.h;
    var s = Math.min(sx, sy);
    if(!isFinite(s) || s<=0) s = 0.001;
    var offX = pad - b.x*s + Math.max(0,(mw-pad*2-b.w*s))/2;
    var offY = pad - b.y*s + Math.max(0,(mh-pad*2-b.h*s))/2;
    return { scale:s, offX:offX, offY:offY, mw:mw, mh:mh };
  }

  function rebuildMinimapBg(){
    var dpr = minimapEl.__dpr||1;
    var geom = computeMinimapGeom();
    minimapGeom = geom;
    var pw = Math.max(1, Math.round(geom.mw*dpr)), ph = Math.max(1, Math.round(geom.mh*dpr));
    minimapBgCanvas.width = pw; minimapBgCanvas.height = ph;
    var bctx = minimapBgCanvas.getContext('2d');
    bctx.setTransform(dpr,0,0,dpr,0,0);
    bctx.clearRect(0,0,geom.mw,geom.mh);
    bctx.fillStyle = '#F6F7FA';
    bctx.fillRect(0,0,geom.mw,geom.mh);
    var ids = state.currentNodeIds;
    var filter = DV.jobFilterNodeSet();
    var defaultFill = 'rgba(47,91,234,.55)';
    bctx.fillStyle = defaultFill;
    for(var i=0;i<ids.length;i++){
      var entry = registry.get(ids[i]);
      var p = entry.modePos[state.mode];
      if(!p || (filter && !filter.has(ids[i]))) continue;
      var variant = p.node && p.node.variant;
      bctx.fillStyle = entry.kind==='biz' ? (BIZ_MINIMAP_COLOR[variant||'task'] || defaultFill)
        : entry.kind==='job' ? (JOB_MINIMAP_COLOR[variant||'job'] || defaultFill)
        : entry.kind==='arch' ? (ARCH_MINIMAP_COLOR[variant||'service'] || defaultFill)
        : entry.kind==='batch' ? 'rgba(15,118,110,.55)' : defaultFill;
      var x = geom.offX + p.x*geom.scale, y = geom.offY + p.y*geom.scale;
      var w = Math.max(1, p.w*geom.scale), h = Math.max(1, p.h*geom.scale);
      bctx.fillRect(x,y,w,h);
    }
    rt.minimapBgDirty = false;
  }

  function renderMinimap(){
    if(!minimapCardEl || minimapCardEl.hidden) return;
    if(rt.minimapBgDirty || !minimapGeom) rebuildMinimapBg();
    var dpr = minimapEl.__dpr||1;
    minimapCtx.setTransform(dpr,0,0,dpr,0,0);
    var mw = minimapGeom.mw, mh = minimapGeom.mh;
    minimapCtx.clearRect(0,0,mw,mh);
    minimapCtx.drawImage(minimapBgCanvas, 0,0, minimapBgCanvas.width, minimapBgCanvas.height, 0,0, mw, mh);
    // ビューポート枠
    var geom = minimapGeom;
    var tl = screenToWorld(0,0), br = screenToWorld(rt.cssW,rt.cssH);
    var vx = geom.offX + tl.x*geom.scale, vy = geom.offY + tl.y*geom.scale;
    var vw = (br.x-tl.x)*geom.scale, vh = (br.y-tl.y)*geom.scale;
    // 表示範囲が図全体より広いと枠の大半がミニマップの外に出て、下端の 1 辺だけが
    // 横線のように残る。ミニマップの内側に切り詰めて描く（線幅 2px が欠けないよう 1px 内側）。
    var x0 = Math.max(1, vx), y0 = Math.max(1, vy);
    var x1 = Math.min(mw-1, vx+vw), y1 = Math.min(mh-1, vy+vh);
    if(x1>x0 && y1>y0){
      minimapCtx.strokeStyle = '#2F5BEA';
      minimapCtx.lineWidth = 2;
      minimapCtx.strokeRect(x0,y0,x1-x0,y1-y0);
    }
  }

  function minimapToWorld(mx,my){
    if(!minimapGeom) rebuildMinimapBg();
    return { x:(mx-minimapGeom.offX)/minimapGeom.scale, y:(my-minimapGeom.offY)/minimapGeom.scale };
  }
  function panToWorldCenter(wx,wy){
    state.view.x = rt.cssW/2 - wx*state.view.k;
    state.view.y = rt.cssH/2 - wy*state.view.k;
    state.anim = null;
    onViewChanged();
    invalidate();
  }

  // ---------------------------------------------------------
  // ノードのラスタキャッシュ（concept / biz / job / er / dfd / pill）
  // ---------------------------------------------------------
  var rasterCache = new Map(); // key -> {canvas,w,h}
  function pickBucket(viewK, dpr){
    var target = viewK*dpr;
    for(var i=0;i<LOD_BUCKETS.length;i++){ if(LOD_BUCKETS[i]*dpr >= target) return LOD_BUCKETS[i]; }
    return LOD_BUCKETS[LOD_BUCKETS.length-1];
  }
  // 1 フレームあたりのラスタ新規構築数に上限を設ける。ズームの連打でバケットが
  // 一斉に変わっても、1 フレームに全ノード分を作り直して落ち込まないようにするため。
  // 予算切れのノードは「前のバケットのラスタ（あれば）」→ 呼び出し側のフォールバック
  // （色付きの箱・軽い代替画像など）の順に描かれ、数フレームのうちに自然に作り直される。
  // ノードの図形（concept/biz/er/dfd/pill）は 1 件あたりの構築コストが高い（テキスト行の描画等）ため
  // 予算を絞り、画面サムネイルは drawImage 1 回で済み安いため別枠で多めに与える。
  var RASTER_BUILD_BUDGET_PER_FRAME = 1;                 // 図形ノード: 件数ベース（1 件あたりのコストがほぼ一定なため）
  var SCREEN_RASTER_BUILD_BUDGET_PER_FRAME = 900000;      // 画面サムネイル: 面積（px）ベース。解像度は落とさず同時構築枚数で絞る
  var RASTER_MAX_PIXELS = 200000;
  var nodeRasterBudget = { remaining:0, catchup:false, pixelMode:false };
  var screenRasterBudget = { remaining:0, catchup:false, pixelMode:true };

  // 汎用ラスタ構築（ノードの図形描画にも画面サムネイルの縮小コピーにも使う）。
  // cache: Map、idPrefix: キャッシュキーの id 部分、maxPixels: 面積上限（0 なら無制限）、
  // maxEffBucket: 元画像の実解像度を超えて拡大しないための上限（画面サムネイル用）、
  // budget: { remaining, catchup } — 呼び出し側の予算カウンター。
  // padWorld: ノード本体の矩形 (0,0,w,h) の外にはみ出して描く装飾（例: dfd プロセスの
  // コードバッジ）があるノード用に、ラスタキャンバスの四辺へ余白を確保する量（ワールド px）。
  // 省略時は 0（従来どおり、キャンバスは w×h ちょうど）。
  function buildRasterGeneric(cache, idPrefix, w, h, bucket, maxPixels, maxEffBucket, budget, drawFn, padWorld){
    padWorld = padWorld || 0;
    var key = idPrefix+'|'+bucket;
    var hit = cache.get(key);
    if(hit){ cache.delete(key); cache.set(key, hit); return hit; }
    if(budget.remaining<=0){
      budget.catchup = true;
      // 予算切れ: 他バケットの既存ラスタがあればそれを流用（少しぼやけるだけで済む）
      for(var i=0;i<LOD_BUCKETS.length;i++){
        var altKey = idPrefix+'|'+LOD_BUCKETS[i];
        var altHit = cache.get(altKey);
        if(altHit) return altHit;
      }
      return null;
    }
    var dpr = rt.dprCur;
    var effBucket = bucket*dpr;
    if(maxEffBucket && effBucket>maxEffBucket) effBucket = maxEffBucket;
    var pw0 = w+padWorld*2, ph0 = h+padWorld*2;
    // ラスタが巨大になりすぎないよう、面積に上限を設けて必要なら実効倍率を下げる
    // （fill()/drawImage() 自体のコストは出力解像度に比例するため）。
    if(maxPixels){
      var area = (pw0*effBucket)*(ph0*effBucket);
      if(area > maxPixels) effBucket *= Math.sqrt(maxPixels/area);
    }
    var pw = Math.max(1, Math.ceil(pw0*effBucket)), ph = Math.max(1, Math.ceil(ph0*effBucket));
    // 予算は「件数」（図形ノード: 1 件あたりのコストがほぼ一定）または「面積」
    // （画面サムネイル: 解像度をむやみに落とさず、その代わり同時に作れる枚数で絞る）。
    budget.remaining -= budget.pixelMode ? (pw*ph) : 1;
    var c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    var cctx = c.getContext('2d');
    cctx.scale(effBucket, effBucket);
    if(padWorld) cctx.translate(padWorld, padWorld);
    drawFn(cctx, w, h);
    var rec = { canvas:c, w:pw, h:ph, pad:padWorld };
    cache.set(key, rec);
    if(cache.size>RASTER_CACHE_MAX){
      var firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    return rec;
  }

  // noText: このズームではノード内の文字を screen-fixed オーバーレイで別途描く
  // （drawBizLabelOverlay）ので、ラスタ側には文字を焼き込まない（二重描画防止）。
  // キャッシュキーに含めて「文字あり」バケットと衝突しないようにする。
  function getRaster(entry, w, h, bucket, noText, padWorld){
    var idPrefix = entry.id + (noText ? '|noText' : '');
    return buildRasterGeneric(rasterCache, idPrefix, w, h, bucket, RASTER_MAX_PIXELS, 0, nodeRasterBudget, function(cctx){
      drawNodeRasterContent(cctx, entry, w, h, noText);
    }, padWorld);
  }

  // ---------------------------------------------------------
  // 画面サムネイルの縮小コピー（mip）キャッシュ。
  // 元 JPEG（大 1080w／小 270w）をズームのたびに毎フレーム drawImage で縮小すると、
  // 目標サイズが連続的に変わり続けるためブラウザ側の縮小画像キャッシュが効かず、
  // フレームごとに重い再フィルタリングが走る（大きな倍率変化のバーストで顕著）。
  // ここではノードのラスタキャッシュと同じ仕組み（倍率バケット・LRU・予算制）で
  // 表示サイズに近い小さな canvas へ一度だけ縮小コピーし、以降はそれを描く。
  var screenRasterCache = new Map();
  // 大サムネイル（既定 1080 幅想定）の面積をおおよその上限とする。これより絞ると
  // 元 JPEG がすでに持つ解像度以下にまで不要に劣化させてしまい、画面を読むという
  // 本来の用途（LIVE_MIN_PX を超えたら「大」に切り替える設計）を損なう。
  var SCREEN_RASTER_MAX_PIXELS = 750000;
  function getScreenRaster(entry, w, h, bucket, img, which){
    // 画像の実体（src）でキャッシュキーを作る。id ではなく src にすることで、
    // 複数の画面が同じサムネイル画像を指す場合（テスト用データや、意図的な使い回し）に
    // 縮小コピーを重複して作らずに済む。
    var idPrefix = img.src+'|'+Math.round(w)+'x'+Math.round(h);
    var maxEffBucket = (img.naturalWidth>0) ? (img.naturalWidth/w) : 0;
    return buildRasterGeneric(screenRasterCache, idPrefix, w, h, bucket, SCREEN_RASTER_MAX_PIXELS, maxEffBucket, screenRasterBudget, function(cctx, ww, hh){
      cctx.drawImage(img, 0, 0, ww, hh);
    });
  }

  // --- body end ---
  // --- export ---
  DV.renderMinimap = renderMinimap; DV.minimapToWorld = minimapToWorld; DV.panToWorldCenter = panToWorldCenter; DV.pickBucket = pickBucket; DV.RASTER_BUILD_BUDGET_PER_FRAME = RASTER_BUILD_BUDGET_PER_FRAME; DV.SCREEN_RASTER_BUILD_BUDGET_PER_FRAME = SCREEN_RASTER_BUILD_BUDGET_PER_FRAME; DV.nodeRasterBudget = nodeRasterBudget; DV.screenRasterBudget = screenRasterBudget; DV.getRaster = getRaster; DV.getScreenRaster = getScreenRaster;
})();
