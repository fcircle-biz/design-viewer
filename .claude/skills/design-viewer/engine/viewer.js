/* ============================================================
   design-viewer engine — Canvas 2D ビューア本体
   依存: window.VIEWER_DATA (viewer-data.js)
   file:// で開ける想定（ES modules 不可、fetch 不可）。
   ============================================================ */
(function(){
  'use strict';

  // ---------------------------------------------------------
  // 定数
  // ---------------------------------------------------------
  var MODE_KEYS = ['flow','gallery','concept','er','dfd'];
  var MODE_LABEL_JA = { flow:'画面遷移', gallery:'画面イメージ', concept:'概念図', er:'ER 図', dfd:'データフロー' };
  var MODE_MAX_K = { flow:0.6, gallery:0.6, concept:1.4, er:1.4, dfd:1.4 };
  var MIN_K = 0.02, MAX_K = 4.0;
  var EDGE_COLOR = {
    user:'#3B6FF5', system:'#8B5CF6', nav:'#A3ABB9', start:'#64748B',
    rel:'#475569', weak:'#94A3B8', flow:'#2F5BEA'
  };
  var EDGE_DASH = {
    system:[7,6], weak:[7,6], nav:[1.5,7]
  };
  var EDGE_ALPHA = { start:0.72 };
  var KIND_LABEL_JA = { pill:'開始点', concept:'概念', er:'テーブル（リスト）', dfd:'処理・データストア・外部' };
  var LOD_BUCKETS = [0.25,0.5,1,2];
  var LIVE_MIN_PX = 300;      // 画面ノードの表示幅（デバイス px）がこれ以上で「大」サムネイル
  var TEXT_MIN_SCALE = 0.3;   // concept/er/dfd: 表示倍率×DPR がこれ未満なら文字を描かず箱だけ
  var EDGE_LABEL_MIN_K = 0.14;
  var CARD_TITLE_MIN_PX = 12;  // layout: "elk" の画面カード見出しの最小文字サイズ（これ未満ならカード上に出す）
  var RASTER_CACHE_MAX = 300;
  var SETTLE_MS = 160;

  // ---------------------------------------------------------
  // アイコン（icons.js の SVG マークアップを構造化して保持。Path2D で描く）
  // ---------------------------------------------------------
  var ICONS = {
    chat: [['path','M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H9l-4 3v-3H5.5C4.67 16 4 15.33 4 14.5v-9Z']],
    bell: [['path','M12 3.5c-2.49 0-4.5 2.01-4.5 4.5v3.1c0 .5-.2 1-.55 1.35L5.5 14v1h13v-1l-1.45-1.55c-.35-.35-.55-.85-.55-1.35V8c0-2.49-2.01-4.5-4.5-4.5Z'],['path','M9.8 18a2.2 2.2 0 0 0 4.4 0']],
    team: [['circle',8.5,8,2.5],['circle',16,9,2],['path','M3.5 19c0-2.76 2.24-5 5-5s5 2.24 5 5'],['path','M13.8 14.3c1.9.4 3.3 2.1 3.3 4.1v.6']],
    cal: [['rect',4,5.5,16,14,1.5],['path','M4 9.5h16'],['path','M8 3.5v3M16 3.5v3'],['path','M7.5 13h2v2h-2zM11 13h2v2h-2zM14.5 13h2v2h-2z']],
    bot: [['rect',5,8,14,10,2.5],['path','M12 8V5'],['circle',12,4,1.1],['circle',9,13,1.2],['circle',15,13,1.2],['path','M9 16.5h6']],
    apps: [['rect',4,4,6.5,6.5,1.2],['rect',13.5,4,6.5,6.5,1.2],['rect',4,13.5,6.5,6.5,1.2],['rect',13.5,13.5,6.5,6.5,1.2]],
    search: [['circle',10.5,10.5,6],['path','M15 15l5 5']],
    inbox: [['path','M4 12l2.2-6.6A1.5 1.5 0 0 1 7.6 4.4h8.8c.65 0 1.22.42 1.4 1L20 12'],['path','M4 12v5.5C4 18.33 4.67 19 5.5 19h13c.83 0 1.5-.67 1.5-1.5V12h-4.2a2.2 2.2 0 0 1-4.6 0H4Z']],
    doc: [['path','M7 3.5h7l4 4v13H7Z'],['path','M14 3.5v4h4'],['path','M9.5 12h5M9.5 15h5M9.5 9h2']],
    check: [['path','M4.5 12.5l5 5 10-11']],
    tag: [['path','M11.5 4.5H6.5a2 2 0 0 0-2 2v5l9.6 9.6a1.5 1.5 0 0 0 2.12 0l5.38-5.38a1.5 1.5 0 0 0 0-2.12L11.5 4.5Z'],['circle',8.2,8.2,1.3]],
    user: [['circle',12,8.3,3.3],['path','M5 20c0-3.6 3.13-6.5 7-6.5s7 2.9 7 6.5']],
    flow: [['circle',6,6.5,2.2],['circle',18,6.5,2.2],['circle',12,17.5,2.2],['path','M8 7.3 10.4 15.6M16 7.3 13.6 15.6']],
    db: [['ellipse',12,6,7,2.6],['path','M5 6v12c0 1.44 3.13 2.6 7 2.6s7-1.16 7-2.6V6'],['path','M5 12c0 1.44 3.13 2.6 7 2.6s7-1.16 7-2.6']],
    spark: [['path','M12 3.5c.5 3.2 2 4.7 5.2 5.2-3.2.5-4.7 2-5.2 5.2-.5-3.2-2-4.7-5.2-5.2 3.2-.5 4.7-2 5.2-5.2Z'],['path','M18.5 15.5c.28 1.5.9 2.12 2.4 2.4-1.5.28-2.12.9-2.4 2.4-.28-1.5-.9-2.12-2.4-2.4 1.5-.28 2.12-.9 2.4-2.4Z']],
    shield: [['path','M12 3.7 18.5 6v5.3c0 4.3-2.8 7.7-6.5 9-3.7-1.3-6.5-4.7-6.5-9V6Z'],['path','M9.3 12l1.9 1.9 3.5-3.9']],
    gear: [['circle',12,12,3],['path','M12 3.5v2.1M12 18.4v2.1M20.5 12h-2.1M5.6 12H3.5M17.8 6.2l-1.5 1.5M7.7 16.3l-1.5 1.5M17.8 17.8l-1.5-1.5M7.7 7.7 6.2 6.2']],
    plus: [['path','M12 5v14M5 12h14']],
    back: [['path','M15 5l-7 7 7 7']],
    list: [['path','M9 6.5h11M9 12h11M9 17.5h11'],['circle',4.3,6.5,1.1],['circle',4.3,12,1.1],['circle',4.3,17.5,1.1]],
    send: [['path','M4.5 12 20 4.5 15 19.5 11.2 13 4.5 12Z'],['path','M11.2 13 15 19.5']],
    warn: [['path','M12 4 21 19.5H3Z'],['path','M12 10.2v4'],['circle',12,16.8,0.9]]
  };
  var iconPathCache = new Map();
  function getIconPath(name){
    if(iconPathCache.has(name)) return iconPathCache.get(name);
    var shapes = ICONS[name];
    var p = new Path2D();
    if(shapes){
      shapes.forEach(function(s){
        if(s[0]==='path'){ p.addPath(new Path2D(s[1])); }
        else if(s[0]==='circle'){ p.moveTo(s[1]+s[3], s[2]); p.arc(s[1],s[2],s[3],0,Math.PI*2); }
        else if(s[0]==='rect'){ addRoundRectPath(p, s[1],s[2],s[3],s[4], s[5]||0); }
        else if(s[0]==='ellipse'){ p.ellipse(s[1],s[2],s[3],s[4],0,0,Math.PI*2); }
      });
    }
    iconPathCache.set(name, p);
    return p;
  }
  function addRoundRectPath(p, x,y,w,h,r){
    r = Math.max(0, Math.min(r, w/2, h/2));
    if(r<=0.01){ p.rect(x,y,w,h); return; }
    p.moveTo(x+r,y);
    p.arcTo(x+w,y,x+w,y+h,r);
    p.arcTo(x+w,y+h,x,y+h,r);
    p.arcTo(x,y+h,x,y,r);
    p.arcTo(x,y,x+w,y,r);
    p.closePath();
  }

  // ---------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function logLerp(a,b,t){ return Math.exp(lerp(Math.log(a), Math.log(b), t)); }
  function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
  function now(){ return performance.now(); }
  function esc(v){ return v===null||v===undefined ? '' : String(v); }
  function escHtml(v){
    return esc(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function roundRectPath(ctx,x,y,w,h,r){
    r = Math.max(0, Math.min(r, Math.abs(w)/2, Math.abs(h)/2));
    ctx.beginPath();
    if(r<=0.01){ ctx.rect(x,y,w,h); return; }
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  // 文字列の省略記号付き切り詰め（measureText キャッシュ付き）
  var textWidthCache = new Map();
  function measureCached(ctx, text, font){
    var key = font+''+text;
    var w = textWidthCache.get(key);
    if(w===undefined){
      var prevFont = ctx.font;
      if(ctx.font!==font) ctx.font = font;
      w = ctx.measureText(text).width;
      if(ctx.font!==prevFont) ctx.font = prevFont;
      if(textWidthCache.size>5000) textWidthCache.clear();
      textWidthCache.set(key, w);
    }
    return w;
  }
  function truncateText(ctx, text, font, maxWidth){
    if(!text) return '';
    if(maxWidth<=4) return '';
    if(measureCached(ctx, text, font) <= maxWidth) return text;
    var ell = '…';
    var lo=0, hi=text.length;
    while(lo<hi){
      var mid = (lo+hi+1)>>1;
      var cand = text.slice(0,mid)+ell;
      if(measureCached(ctx, cand, font) <= maxWidth) lo=mid; else hi=mid-1;
    }
    return lo<=0 ? ell : text.slice(0,lo)+ell;
  }

  // ---------------------------------------------------------
  // 性能計測（試験用。常時 ON）
  // ---------------------------------------------------------
  window.__viewerPerf = { frames: [] };
  function recordFrame(ms){
    var arr = window.__viewerPerf.frames;
    arr.push(ms);
    if(arr.length>300) arr.splice(0, arr.length-300);
  }

  // ---------------------------------------------------------
  // DOM 参照
  // ---------------------------------------------------------
  var stageEl, stageCtx, minimapEl, minimapCtx;
  var titleTextEl, subtitleTextEl, statusNoteEl, modeDescEl;
  var searchInputEl, searchResultsEl;
  var legendListEl, toggleListEl;
  var stepsCardEl, stepPlayEl, stepListEl;
  var detailPanelEl, closePanelBtn, panelBodyEl;
  var modeSegEl, zoomOutBtn, zoomInBtn, zoomFitBtn, zoomPctEl, neighborToggleBtn;
  var minimapCardEl;
  var previewModalEl, modalTitleEl, modalBodyEl, modalCloseBtn, modalScale100Btn, modalScaleFitBtn;

  function cacheDom(){
    stageEl = document.getElementById('stage');
    stageCtx = stageEl.getContext('2d');
    minimapEl = document.getElementById('minimapCanvas');
    minimapCtx = minimapEl.getContext('2d');
    minimapCardEl = document.getElementById('minimapCard');
    titleTextEl = document.getElementById('titleText');
    subtitleTextEl = document.getElementById('subtitleText');
    statusNoteEl = document.getElementById('statusNote');
    modeDescEl = document.getElementById('modeDesc');
    searchInputEl = document.getElementById('searchInput');
    searchResultsEl = document.getElementById('searchResults');
    legendListEl = document.getElementById('legendList');
    toggleListEl = document.getElementById('toggleList');
    stepsCardEl = document.getElementById('stepsCard');
    stepPlayEl = document.getElementById('stepPlay');
    stepListEl = document.getElementById('stepList');
    detailPanelEl = document.getElementById('detailPanel');
    closePanelBtn = document.getElementById('closePanel');
    panelBodyEl = document.getElementById('panelBody');
    modeSegEl = document.getElementById('modeSeg');
    zoomOutBtn = document.getElementById('zoomOut');
    zoomInBtn = document.getElementById('zoomIn');
    zoomFitBtn = document.getElementById('zoomFit');
    zoomPctEl = document.getElementById('zoomPct');
    neighborToggleBtn = document.getElementById('neighborToggle');
    previewModalEl = document.getElementById('previewModal');
    modalTitleEl = document.getElementById('modalTitle');
    modalBodyEl = document.getElementById('modalBody');
    modalCloseBtn = document.getElementById('modalClose');
    modalScale100Btn = document.getElementById('modalScale100');
    modalScaleFitBtn = document.getElementById('modalScaleFit');
  }

  // ---------------------------------------------------------
  // 状態
  // ---------------------------------------------------------
  var registry = new Map();          // id -> entry
  var screensById = new Map();
  var state = {
    mode: null,
    view: { x:0, y:0, k:1 },
    selected: null,
    hovered: null,
    hiddenTypes: new Set(),
    currentNodeIds: [],              // 現在モードのノード id（描画順）
    currentEdges: [],                // 現在モードの辺（検証済み）
    currentGroups: [],
    modeBounds: { x:0,y:0,w:1000,h:1000 },
    dfdStep: null,
    autoplayTimer: null,
    anim: null,
    neighborOnly: false
  };
  var cssW=0, cssH=0, dprCur=1;

  // ---------------------------------------------------------
  // レジストリ構築
  // ---------------------------------------------------------
  function buildRegistry(){
    (VIEWER_DATA.screens||[]).forEach(function(s){ screensById.set(s.id, s); });
    var modes = VIEWER_DATA.modes||{};
    Object.keys(modes).forEach(function(modeKey){
      var mode = modes[modeKey];
      (mode.nodes||[]).forEach(function(n){
        if(!n || !n.id){ console.warn('[viewer] mode "'+modeKey+'" に id の無いノード定義があります'); return; }
        var kind = n.kind;
        if(!kind){
          if(screensById.has(n.id)) kind='screen';
          else { console.warn('[viewer] mode "'+modeKey+'" のノード "'+n.id+'" は kind が無く画面としても見つかりません'); return; }
        }
        var w = n.w, h = n.h;
        if(kind==='screen'){
          var scr = screensById.get(n.id);
          if(!scr){ console.warn('[viewer] mode "'+modeKey+'" が未知の画面 id を参照しています: '+n.id); return; }
          w = n.w || scr.w || 1440; h = n.h || scr.h || 900;
        }
        var entry = registry.get(n.id);
        if(!entry){
          entry = { id:n.id, kind:kind, modePos:{}, cur:null, thumb:null, thumbFailed:false };
          registry.set(n.id, entry);
        } else if(entry.kind!==kind){
          console.warn('[viewer] ノード id "'+n.id+'" の種別が mode によって食い違っています（'+entry.kind+' / '+kind+'）。最初の定義を使います。');
          return;
        }
        entry.modePos[modeKey] = { x:n.x||0, y:n.y||0, w:w||100, h:h||60, node:n };
      });
    });
    return registry;
  }

  function nodeLabel(entry, modeKey){
    if(entry.kind==='screen'){
      var s = screensById.get(entry.id);
      return s ? (entry.id+' '+s.title) : entry.id;
    }
    var mp = entry.modePos[modeKey||state.mode] || entry.modePos[Object.keys(entry.modePos)[0]];
    var n = mp && mp.node;
    return (n && n.label) || entry.id;
  }

  // ---------------------------------------------------------
  // キャンバス設定
  // ---------------------------------------------------------
  function resizeStage(){
    var dpr = window.devicePixelRatio || 1;
    var rect = stageEl.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var needW = Math.round(w*dpr), needH = Math.round(h*dpr);
    if(stageEl.width!==needW || stageEl.height!==needH){
      stageEl.width = needW; stageEl.height = needH;
    }
    cssW = w; cssH = h; dprCur = dpr;
    resizeMinimap();
    invalidate();
  }
  function resizeMinimap(){
    var dpr = window.devicePixelRatio || 1;
    var rect = minimapEl.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var needW = Math.round(w*dpr), needH = Math.round(h*dpr);
    if(minimapEl.width!==needW || minimapEl.height!==needH){
      minimapEl.width = needW; minimapEl.height = needH;
    }
    minimapEl.__cssW = w; minimapEl.__cssH = h; minimapEl.__dpr = dpr;
    minimapBgDirty = true;
  }

  // ---------------------------------------------------------
  // 座標変換
  // ---------------------------------------------------------
  function worldToScreen(x,y){ return { x: state.view.x + x*state.view.k, y: state.view.y + y*state.view.k }; }
  function screenToWorld(x,y){ return { x: (x-state.view.x)/state.view.k, y: (y-state.view.y)/state.view.k }; }
  function worldRectToScreen(r){
    return { x: state.view.x + r.x*state.view.k, y: state.view.y + r.y*state.view.k, w: r.w*state.view.k, h: r.h*state.view.k };
  }

  function computeBBox(nodeList, groupList){
    var minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    (nodeList||[]).forEach(function(n){
      minX=Math.min(minX,n.x); minY=Math.min(minY,n.y);
      maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h);
    });
    (groupList||[]).forEach(function(g){
      minX=Math.min(minX,g.x); minY=Math.min(minY,g.y);
      maxX=Math.max(maxX,g.x+g.w); maxY=Math.max(maxY,g.y+g.h);
    });
    if(!isFinite(minX)) return { x:0, y:0, w:1000, h:1000 };
    return { x:minX, y:minY, w:Math.max(1,maxX-minX), h:Math.max(1,maxY-minY) };
  }

  function fitView(bbox, maxK){
    var left=60, right=cssW-60, top=60, bottom=cssH-60;
    if(cssW>900){
      var tc = document.getElementById('titleCard');
      if(tc) top = Math.max(top, tc.getBoundingClientRect().bottom + 24);
      var sc = document.getElementById('stepsCard');
      if(sc && !sc.hidden) right = Math.min(right, sc.getBoundingClientRect().left - 24);
      var tb = document.getElementById('toolbar');
      if(tb) bottom = Math.min(bottom, tb.getBoundingClientRect().top - 24);
    }
    var availW = Math.max(80, right-left), availH = Math.max(80, bottom-top);
    var k = Math.min(availW/bbox.w, availH/bbox.h);
    k = clamp(k, MIN_K, Math.min(maxK||1.4, MAX_K));
    var cx = bbox.x+bbox.w/2, cy = bbox.y+bbox.h/2;
    return { x:(left+right)/2 - cx*k, y:(top+bottom)/2 - cy*k, k:k };
  }

  // 辺の経路の点も全体表示の範囲に含める（ノードの外側を回る線が画面外に切れないように）
  function routeRects(modeObj){
    var list = [];
    ((modeObj && modeObj.edges) || []).forEach(function(e){
      (e.route || []).forEach(function(p){ list.push({ x:p[0], y:p[1], w:0, h:0 }); });
    });
    return list;
  }

  function modeNodeRects(modeKey){
    var list = [];
    registry.forEach(function(entry){ if(entry.modePos[modeKey]) list.push(entry.modePos[modeKey]); });
    return list;
  }

  // ---------------------------------------------------------
  // アニメーション（モード切替・フォーカス）
  // ---------------------------------------------------------
  function startAnim(cfg){
    if(!cfg.duration || cfg.duration<=0){
      state.view = { x:cfg.toView.x, y:cfg.toView.y, k:cfg.toView.k };
      (cfg.nodeAnims||[]).forEach(function(na){ na.entry.cur = { x:na.to.x, y:na.to.y, w:na.to.w, h:na.to.h, op:na.to.op }; });
      state.anim = null;
      onViewChanged();
      invalidate();
      return;
    }
    state.anim = { start: now(), duration: cfg.duration, fromView: cfg.fromView, toView: cfg.toView, nodeAnims: cfg.nodeAnims||[] };
    invalidate();
  }
  function stepAnim(){
    if(!state.anim) return false;
    var t = (now() - state.anim.start) / state.anim.duration;
    if(t>=1) t=1;
    var e = easeInOutCubic(t);
    state.view.x = lerp(state.anim.fromView.x, state.anim.toView.x, e);
    state.view.y = lerp(state.anim.fromView.y, state.anim.toView.y, e);
    state.view.k = logLerp(state.anim.fromView.k, state.anim.toView.k, e);
    state.anim.nodeAnims.forEach(function(na){
      na.entry.cur = {
        x: lerp(na.from.x, na.to.x, e), y: lerp(na.from.y, na.to.y, e),
        w: lerp(na.from.w, na.to.w, e), h: lerp(na.from.h, na.to.h, e),
        op: lerp(na.from.op, na.to.op, e)
      };
    });
    if(t>=1){ state.anim = null; onViewChanged(); }
    return true;
  }

  // ---------------------------------------------------------
  // モード切替
  // ---------------------------------------------------------
  function stopAutoplay(){
    if(state.autoplayTimer){ clearInterval(state.autoplayTimer); state.autoplayTimer=null; }
    if(stepPlayEl) stepPlayEl.textContent = '▶';
  }

  function setMode(modeKey, opts){
    opts = opts || {};
    if(!VIEWER_DATA.modes[modeKey]){ console.warn('[viewer] 未知のモードです: '+modeKey); return; }
    if(modeKey===state.mode && !opts.noAnim) return;
    var oldMode = state.mode;
    state.mode = modeKey;
    if(!opts.keepSelection){ state.selected = null; detailPanelEl.hidden = true; }
    state.hovered = null;
    if(modeKey!=='dfd'){ stopAutoplay(); state.dfdStep = null; }
    state.neighborOnly = false;
    if(neighborToggleBtn) neighborToggleBtn.classList.remove('v-active');

    var modeObj = VIEWER_DATA.modes[modeKey];
    state.currentGroups = modeObj.groups || [];
    state.currentEdges = prepareEdgesForMode(modeKey);
    state.currentNodeIds = (modeObj.nodes||[]).map(function(n){ return n.id; }).filter(function(id){ return registry.has(id); });
    rebuildLegendAndToggles(modeObj);
    rebuildStepsUI(modeKey, modeObj);
    updateSegActive();
    modeDescEl.textContent = modeObj.desc || '';
    rebuildSearchIndex();

    var nodeAnims = [];
    registry.forEach(function(entry){
      var hasOld = oldMode!=null ? entry.modePos[oldMode] : null;
      var hasNew = entry.modePos[modeKey];
      if(hasOld && hasNew){
        nodeAnims.push({ entry:entry, from:{x:hasOld.x,y:hasOld.y,w:hasOld.w,h:hasOld.h,op:1}, to:{x:hasNew.x,y:hasNew.y,w:hasNew.w,h:hasNew.h,op:1} });
      } else if(hasNew && !hasOld){
        nodeAnims.push({ entry:entry, from:{x:hasNew.x,y:hasNew.y,w:hasNew.w,h:hasNew.h,op:0}, to:{x:hasNew.x,y:hasNew.y,w:hasNew.w,h:hasNew.h,op:1} });
      } else if(hasOld && !hasNew){
        var cur = entry.cur || hasOld;
        nodeAnims.push({ entry:entry, from:{x:cur.x,y:cur.y,w:cur.w,h:cur.h,op:(cur.op!=null?cur.op:1)}, to:{x:hasOld.x,y:hasOld.y,w:hasOld.w,h:hasOld.h,op:0} });
      } else if(!entry.cur){
        entry.cur = { x:0,y:0,w:10,h:10,op:0 };
      }
    });

    var bbox = computeBBox(modeNodeRects(modeKey).concat(routeRects(modeObj)), modeObj.groups||[]);
    state.modeBounds = bbox;
    var maxK = MODE_MAX_K[modeKey] || 1.4;
    var toView = fitView(bbox, maxK);
    startAnim({ duration: opts.noAnim?0:600, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:nodeAnims });
    minimapBgDirty = true;

    try{ history.replaceState(null, '', '#'+modeKey); }catch(err){ /* file:// で失敗する場合がある */ }
  }

  function fitCurrentMode(animate){
    var modeObj = VIEWER_DATA.modes[state.mode];
    var bbox = computeBBox(modeNodeRects(state.mode).concat(routeRects(modeObj)), modeObj.groups||[]);
    var maxK = MODE_MAX_K[state.mode] || 1.4;
    var toView = fitView(bbox, maxK);
    startAnim({ duration: animate?500:0, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:[] });
  }

  function focusNode(id){
    if(!registry.has(id)){ console.warn('[viewer] focusNode: 未知のノード id: '+id); return; }
    selectNode(id);
    var entry = registry.get(id);
    var pos = entry.modePos[state.mode] || entry.cur;
    if(!pos) return;
    var bbox = { x:pos.x-90, y:pos.y-90, w:pos.w+180, h:pos.h+180 };
    var maxK = MODE_MAX_K[state.mode] || 1.4;
    var toView = fitView(bbox, maxK);
    startAnim({ duration:500, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:[] });
  }

  function fitGroup(g){
    var bbox = { x:g.x, y:g.y, w:g.w, h:g.h };
    var maxK = MODE_MAX_K[state.mode] || 1.4;
    var toView = fitView(bbox, maxK);
    startAnim({ duration:500, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:[] });
  }

  // ---------------------------------------------------------
  // 辺の準備
  // ---------------------------------------------------------
  function prepareEdgesForMode(modeKey){
    var edgesArr = (VIEWER_DATA.modes[modeKey] && VIEWER_DATA.modes[modeKey].edges) || [];
    var out = [];
    edgesArr.forEach(function(e){
      if(!registry.has(e.from) || !registry.has(e.to)){
        console.warn('[viewer] mode "'+modeKey+'" の辺が未知のノードを参照しています: '+e.from+' -> '+e.to);
        return;
      }
      if(!e.route || e.route.length<2){
        var a = registry.get(e.from).modePos[modeKey], b = registry.get(e.to).modePos[modeKey];
        if(a && b){
          e = Object.assign({}, e, { route: [[a.x+a.w/2, a.y+a.h/2],[b.x+b.w/2,b.y+b.h/2]] });
        } else { return; }
      }
      out.push(e);
    });
    return out;
  }

  // ---------------------------------------------------------
  // 凡例・トグル
  // ---------------------------------------------------------
  function rebuildLegendAndToggles(modeObj){
    var legend = modeObj.legend || [];
    legendListEl.innerHTML = legend.length ? legend.map(function(item){
      var color = EDGE_COLOR[item.type] || '#8A93A3';
      var cls = 'v-legend-swatch';
      if(item.type==='system' || item.type==='weak') cls += ' v-dash';
      else if(item.type==='nav') cls += ' v-dot';
      return '<div class="v-legend-item"><span class="'+cls+'" style="border-color:'+color+'"></span><span>'+escHtml(item.label)+'</span></div>';
    }).join('') : '<div class="v-empty">凡例なし</div>';

    state.hiddenTypes = new Set();
    var toggles = modeObj.toggles || [];
    toggles.forEach(function(t){ if(t.default===false) state.hiddenTypes.add(t.type); });
    toggleListEl.innerHTML = toggles.map(function(t){
      var checked = !state.hiddenTypes.has(t.type);
      return '<label class="v-toggle-item"><input type="checkbox" data-toggle-type="'+escHtml(t.type)+'" '+(checked?'checked':'')+'> '+escHtml(t.label)+'</label>';
    }).join('');
  }

  // ---------------------------------------------------------
  // DFD ステップ
  // ---------------------------------------------------------
  function setDfdStep(n){
    state.dfdStep = n;
    var items = stepListEl.querySelectorAll('.v-step-item');
    for(var i=0;i<items.length;i++){
      items[i].classList.toggle('v-active', Number(items[i].getAttribute('data-step'))===n);
    }
    invalidate();
  }
  function rebuildStepsUI(modeKey, modeObj){
    if(modeKey==='dfd' && modeObj.steps && modeObj.steps.length){
      stepsCardEl.hidden = false;
      stepListEl.innerHTML = modeObj.steps.map(function(s){
        return '<div class="v-step-item" data-step="'+s.n+'">'+
          '<div><span class="v-step-num">'+s.n+'</span><span class="v-step-title">'+escHtml(s.title)+'</span></div>'+
          '<div class="v-step-desc">'+escHtml(s.desc||'')+'</div></div>';
      }).join('');
    } else {
      stepsCardEl.hidden = true;
      stepListEl.innerHTML = '';
    }
  }
  function toggleAutoplay(){
    if(state.autoplayTimer){ stopAutoplay(); return; }
    var modeObj = VIEWER_DATA.modes.dfd;
    var steps = (modeObj && modeObj.steps) || [];
    if(!steps.length) return;
    if(state.dfdStep==null) setDfdStep(steps[0].n);
    stepPlayEl.textContent = '⏸';
    state.autoplayTimer = setInterval(function(){
      var idx = steps.findIndex(function(s){ return s.n===state.dfdStep; });
      var next = steps[(idx+1) % steps.length];
      setDfdStep(next.n);
    }, 2500);
  }

  // ---------------------------------------------------------
  // 検索
  // ---------------------------------------------------------
  var searchIndex = [];
  function rebuildSearchIndex(){
    searchIndex = state.currentNodeIds.map(function(id){
      var entry = registry.get(id);
      return { id:id, label: nodeLabel(entry) };
    });
  }
  function runSearch(q){
    q = (q||'').trim().toLowerCase();
    if(!q){ searchResultsEl.classList.remove('v-open'); searchResultsEl.innerHTML=''; return; }
    var hits = searchIndex.filter(function(it){
      return it.id.toLowerCase().indexOf(q)>=0 || it.label.toLowerCase().indexOf(q)>=0;
    }).slice(0,30);
    searchResultsEl.classList.add('v-open');
    if(!hits.length){ searchResultsEl.innerHTML = '<div class="v-search-empty">該当なし</div>'; return; }
    searchResultsEl.innerHTML = hits.map(function(it){
      return '<div class="v-search-item" data-id="'+escHtml(it.id)+'"><span class="v-search-id">'+escHtml(it.id)+'</span><span class="v-search-label">'+escHtml(it.label)+'</span></div>';
    }).join('');
  }

  // ---------------------------------------------------------
  // ミニマップ
  // ---------------------------------------------------------
  var minimapBgDirty = true;
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
    bctx.fillStyle = 'rgba(47,91,234,.55)';
    for(var i=0;i<ids.length;i++){
      var entry = registry.get(ids[i]);
      var p = entry.modePos[state.mode];
      if(!p) continue;
      var x = geom.offX + p.x*geom.scale, y = geom.offY + p.y*geom.scale;
      var w = Math.max(1, p.w*geom.scale), h = Math.max(1, p.h*geom.scale);
      bctx.fillRect(x,y,w,h);
    }
    minimapBgDirty = false;
  }

  function renderMinimap(){
    if(!minimapCardEl || minimapCardEl.hidden) return;
    if(minimapBgDirty || !minimapGeom) rebuildMinimapBg();
    var dpr = minimapEl.__dpr||1;
    minimapCtx.setTransform(dpr,0,0,dpr,0,0);
    var mw = minimapGeom.mw, mh = minimapGeom.mh;
    minimapCtx.clearRect(0,0,mw,mh);
    minimapCtx.drawImage(minimapBgCanvas, 0,0, minimapBgCanvas.width, minimapBgCanvas.height, 0,0, mw, mh);
    // ビューポート枠
    var geom = minimapGeom;
    var tl = screenToWorld(0,0), br = screenToWorld(cssW,cssH);
    var vx = geom.offX + tl.x*geom.scale, vy = geom.offY + tl.y*geom.scale;
    var vw = (br.x-tl.x)*geom.scale, vh = (br.y-tl.y)*geom.scale;
    minimapCtx.strokeStyle = '#2F5BEA';
    minimapCtx.lineWidth = 2;
    minimapCtx.strokeRect(vx,vy,vw,vh);
  }

  function minimapToWorld(mx,my){
    if(!minimapGeom) rebuildMinimapBg();
    return { x:(mx-minimapGeom.offX)/minimapGeom.scale, y:(my-minimapGeom.offY)/minimapGeom.scale };
  }
  function panToWorldCenter(wx,wy){
    state.view.x = cssW/2 - wx*state.view.k;
    state.view.y = cssH/2 - wy*state.view.k;
    state.anim = null;
    onViewChanged();
    invalidate();
  }

  // ---------------------------------------------------------
  // ノードのラスタキャッシュ（concept / er / dfd / pill）
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
  // ノードの図形（concept/er/dfd/pill）は 1 件あたりの構築コストが高い（テキスト行の描画等）ため
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
  function buildRasterGeneric(cache, idPrefix, w, h, bucket, maxPixels, maxEffBucket, budget, drawFn){
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
    var dpr = dprCur;
    var effBucket = bucket*dpr;
    if(maxEffBucket && effBucket>maxEffBucket) effBucket = maxEffBucket;
    // ラスタが巨大になりすぎないよう、面積に上限を設けて必要なら実効倍率を下げる
    // （fill()/drawImage() 自体のコストは出力解像度に比例するため）。
    if(maxPixels){
      var area = (w*effBucket)*(h*effBucket);
      if(area > maxPixels) effBucket *= Math.sqrt(maxPixels/area);
    }
    var pw = Math.max(1, Math.ceil(w*effBucket)), ph = Math.max(1, Math.ceil(h*effBucket));
    // 予算は「件数」（図形ノード: 1 件あたりのコストがほぼ一定）または「面積」
    // （画面サムネイル: 解像度をむやみに落とさず、その代わり同時に作れる枚数で絞る）。
    budget.remaining -= budget.pixelMode ? (pw*ph) : 1;
    var c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    var cctx = c.getContext('2d');
    cctx.scale(effBucket, effBucket);
    drawFn(cctx, w, h);
    var rec = { canvas:c, w:pw, h:ph };
    cache.set(key, rec);
    if(cache.size>RASTER_CACHE_MAX){
      var firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    return rec;
  }

  function getRaster(entry, w, h, bucket){
    return buildRasterGeneric(rasterCache, entry.id, w, h, bucket, RASTER_MAX_PIXELS, 0, nodeRasterBudget, function(cctx){
      drawNodeRasterContent(cctx, entry, w, h);
    });
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

  function drawNodeRasterContent(ctx, entry, w, h){
    var mp = entry.modePos[state.mode];
    var n = (mp && mp.node) || {};
    if(entry.kind==='pill') drawPillContent(ctx, n, w, h);
    else if(entry.kind==='concept') drawConceptContent(ctx, n, w, h);
    else if(entry.kind==='er') drawErContent(ctx, n, w, h);
    else if(entry.kind==='dfd') drawDfdContent(ctx, n, w, h);
  }

  function drawPillContent(ctx, n, w, h){
    var r = h/2;
    roundRectPath(ctx, 0,0,w,h, r);
    var grad = ctx.createLinearGradient(0,0,w,h);
    grad.addColorStop(0,'#1A2029'); grad.addColorStop(1,'#333B48');
    ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if(n.unit){
      // layout: "elk" の起点ノード（参照 px × unit。ラベル 13px・補足 9px）
      var u = n.unit;
      ctx.font = '800 '+(13*u)+'px '+FONT_STACK;
      ctx.fillText(truncateText(ctx, n.label||'', ctx.font, w-24*u), w/2, n.sub ? h/2-7*u : h/2);
      if(n.sub){
        ctx.globalAlpha = 0.66;
        ctx.font = '500 '+(9*u)+'px '+FONT_STACK;
        ctx.fillText(truncateText(ctx, n.sub, ctx.font, w-24*u), w/2, h/2+10*u);
        ctx.globalAlpha = 1;
      }
      return;
    }
    ctx.font = '800 40px '+FONT_STACK;
    var subH = n.sub ? 16 : 0;
    ctx.fillText(truncateText(ctx, n.label||'', ctx.font, w-40), w/2, h/2-(subH?10:0));
    if(n.sub){
      ctx.globalAlpha = 0.72;
      ctx.font = '600 13px '+FONT_STACK;
      ctx.fillText(truncateText(ctx, n.sub, ctx.font, w-40), w/2, h/2+22);
      ctx.globalAlpha = 1;
    }
  }

  var CONCEPT_VARIANT_COLOR = {
    actor: { bg:'#FFF3DE', fg:'#B46C00' },
    entity:{ bg:'#EAF0FF', fg:'#2F5BEA' },
    system:{ bg:'#F1EAFE', fg:'#7C3AED' }
  };
  function drawConceptContent(ctx, n, w, h){
    var variant = n.variant||'entity';
    var col = CONCEPT_VARIANT_COLOR[variant] || CONCEPT_VARIANT_COLOR.entity;
    var r = variant==='actor' ? h/2 : 14;
    roundRectPath(ctx,0,0,w,h,r);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#E2E6ED'; ctx.stroke();
    var boxSize = 42, pad = 14, gap = 12;
    var by = h/2-boxSize/2;
    if(variant==='actor'){ roundRectPath(ctx,pad,by,boxSize,boxSize,boxSize/2); }
    else { roundRectPath(ctx,pad,by,boxSize,boxSize,11); }
    ctx.fillStyle = col.bg; ctx.fill();
    ctx.save();
    ctx.strokeStyle = col.fg; ctx.lineWidth = 1.8; ctx.lineCap='round'; ctx.lineJoin='round';
    var iconSize = 22, ip = getIconPath(n.icon);
    ctx.translate(pad+boxSize/2-iconSize/2, by+boxSize/2-iconSize/2);
    ctx.scale(iconSize/24, iconSize/24);
    ctx.stroke(ip);
    ctx.restore();
    var tx = pad+boxSize+gap;
    ctx.fillStyle = '#1A2029'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.font = '800 16px '+FONT_STACK;
    var maxW = w-tx-14;
    ctx.fillText(truncateText(ctx,n.label||'',ctx.font,maxW), tx, h/2-(n.sub? 2:-5));
    if(n.sub){
      ctx.fillStyle = '#8A93A3'; ctx.font = '400 12px '+FONT_STACK;
      ctx.fillText(truncateText(ctx,n.sub,ctx.font,maxW), tx, h/2+16);
    }
  }

  var ER_TONE_GRAD = {
    blue:['#2F5BEA','#1E40C4'], amber:['#C77B00','#9C5F00'], green:['#0E9F6E','#0A7A55'],
    slate:['#5B6472','#3E4552'], purple:['#7C3AED','#5B21B6'], teal:['#0891B2','#0E7490']
  };
  var ER_KEY_BADGE = { PK:{bg:'#FFF3B0',fg:'#7A5E00'}, FK:{bg:'#DCE8FF',fg:'#1E40C4'}, UK:{bg:'#D9F4E6',fg:'#0A7A55'} };
  // 角丸は「見せたい形の輪郭だけを描く」ことで実現し、clip() は使わない。
  // clip() は大きな ER ラスタ（列数が多いと数百〜千数百 px 四方）だと再ラスタライズが
  // 非常に重く、ズーム連打でバケットが変わるたびにフレームが数十 ms 単位で詰まる原因になる。
  function topRoundRectPath(ctx,x,y,w,h,r){
    r = Math.max(0, Math.min(r, w/2, h));
    ctx.beginPath();
    ctx.moveTo(x, y+h);
    ctx.lineTo(x, y+r);
    ctx.arcTo(x,y,x+r,y,r);
    ctx.lineTo(x+w-r,y);
    ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h);
    ctx.closePath();
  }
  function drawErContent(ctx, n, w, h){
    // 背景は角丸の輪郭を直接塗る（clip 不要）。下端は角丸にしない（性能優先の簡略化）。
    roundRectPath(ctx,0,0,w,h,14);
    ctx.fillStyle = '#fff'; ctx.fill();
    var tone = ER_TONE_GRAD[n.tone] || ER_TONE_GRAD.slate;
    var headH = 56;
    var grad = ctx.createLinearGradient(0,0,w,headH);
    grad.addColorStop(0,tone[0]); grad.addColorStop(1,tone[1]);
    topRoundRectPath(ctx,0,0,w,headH,14);
    ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.font = '800 15px '+FONT_STACK;
    ctx.fillText(truncateText(ctx,n.label||'',ctx.font,w-32), 16, n.sub? headH/2-2 : headH/2+5);
    if(n.sub){
      ctx.globalAlpha=0.85; ctx.font='400 11.5px '+FONT_STACK;
      ctx.fillText(truncateText(ctx,n.sub,ctx.font,w-32), 16, headH/2+16);
      ctx.globalAlpha=1;
    }
    var fields = n.fields||[];
    var rowH = 30;
    for(var i=0;i<fields.length;i++){
      var f = fields[i];
      var ry = headH+i*rowH;
      ctx.strokeStyle = '#E2E6ED'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(0,ry); ctx.lineTo(w,ry); ctx.stroke();
      var cx = 8;
      var keyW = 36;
      if(f.key){
        var badge2 = ER_KEY_BADGE[String(f.key).toUpperCase()] || {bg:'#F1F3F7',fg:'#5B6472'};
        ctx.font = '800 9.5px '+FONT_STACK;
        var bw2 = Math.min(30, ctx.measureText(f.key).width + 10);
        var bx = cx, by2 = ry + (rowH-16)/2;
        roundRectPath(ctx, bx, by2, bw2, 16, 5);
        ctx.fillStyle = badge2.bg; ctx.fill();
        ctx.fillStyle = badge2.fg; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(f.key, bx+bw2/2, by2+9);
        ctx.textAlign='left'; ctx.textBaseline='alphabetic';
      }
      var nameX = 8+keyW;
      ctx.fillStyle = '#1A2029'; ctx.font = '600 12px '+FONT_STACK;
      var typeW = f.type ? Math.min(150, measureCached(ctx, f.type, '400 11px '+FONT_STACK)+8) : 0;
      var noteW = f.note ? 14 : 0;
      var nameMaxW = Math.max(10, w-nameX-typeW-noteW-12);
      ctx.fillText(truncateText(ctx,f.name||'',ctx.font,nameMaxW), nameX, ry+rowH/2+4);
      if(f.type){
        ctx.fillStyle = '#8A93A3'; ctx.font = '400 11px '+FONT_STACK;
        ctx.textAlign='right';
        ctx.fillText(truncateText(ctx,f.type,ctx.font,typeW), w-12-noteW, ry+rowH/2+4);
        ctx.textAlign='left';
      }
      if(f.note){
        ctx.fillStyle = '#B46C00'; ctx.font='800 12px '+FONT_STACK; ctx.textAlign='right';
        ctx.fillText('＊', w-12, ry+rowH/2+4);
        ctx.textAlign='left';
      }
    }
    ctx.strokeStyle = '#E2E6ED'; ctx.lineWidth=1;
    roundRectPath(ctx,0.5,0.5,w-1,h-1,14); ctx.stroke();
  }

  var DFD_VARIANT_COLOR = {
    ext:{ bg:'#F1F3F7', fg:'#5B6472' }, proc:{ bg:'#EAF0FF', fg:'#2F5BEA' }, store:{ bg:'#EEF0F4', fg:'#5B6472' }
  };
  function drawDfdContent(ctx, n, w, h){
    var variant = n.variant||'proc';
    var col = DFD_VARIANT_COLOR[variant] || DFD_VARIANT_COLOR.proc;
    ctx.fillStyle = '#fff';
    if(variant==='ext'){
      roundRectPath(ctx,1.25,1.25,w-2.5,h-2.5,6); ctx.fill();
      ctx.lineWidth=2.5; ctx.strokeStyle='#1A2029'; ctx.stroke();
    } else if(variant==='proc'){
      roundRectPath(ctx,1.25,1.25,w-2.5,h-2.5,Math.min(44,h/2)); ctx.fill();
      ctx.lineWidth=2.5; ctx.strokeStyle='#2F5BEA'; ctx.stroke();
    } else {
      ctx.fillStyle = '#F9FAFC'; ctx.fillRect(0,1.25,w,h-2.5);
      ctx.lineWidth=2.5; ctx.strokeStyle='#1A2029';
      ctx.beginPath(); ctx.moveTo(0,1.25); ctx.lineTo(w,1.25); ctx.moveTo(0,h-1.25); ctx.lineTo(w,h-1.25); ctx.stroke();
    }
    var padLeft = 14, boxSize = 36, gap = 10, textX;
    if(variant==='store'){
      var cellW = 34;
      ctx.strokeStyle = '#E2E6ED'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(cellW,4); ctx.lineTo(cellW,h-4); ctx.stroke();
      ctx.fillStyle = '#5B6472'; ctx.font='800 11px '+FONT_STACK; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(n.code||'', cellW/2, h/2);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
      padLeft = cellW+10;
    } else if(n.code){
      var bw = Math.max(26, ctx.measureText(n.code).width+12);
      roundRectPath(ctx,-10,-10,bw,22,7);
      ctx.fillStyle = '#1A2029'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font='800 11px '+FONT_STACK; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(n.code, -10+bw/2, 1);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    }
    var by = h/2-boxSize/2;
    roundRectPath(ctx,padLeft,by,boxSize,boxSize,9);
    ctx.fillStyle = col.bg; ctx.fill();
    ctx.save();
    ctx.strokeStyle = col.fg; ctx.lineWidth=1.8; ctx.lineCap='round'; ctx.lineJoin='round';
    var iconSize=20, ip=getIconPath(n.icon);
    ctx.translate(padLeft+boxSize/2-iconSize/2, by+boxSize/2-iconSize/2);
    ctx.scale(iconSize/24, iconSize/24);
    ctx.stroke(ip);
    ctx.restore();
    textX = padLeft+boxSize+gap;
    var maxW = w-textX-10;
    ctx.fillStyle='#1A2029'; ctx.font='800 14px '+FONT_STACK; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.fillText(truncateText(ctx,n.label||'',ctx.font,maxW), textX, h/2-(n.sub?2:-5));
    if(n.sub){
      ctx.fillStyle='#8A93A3'; ctx.font='400 11px '+FONT_STACK;
      ctx.fillText(truncateText(ctx,n.sub,ctx.font,maxW), textX, h/2+15);
    }
  }

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
    ctx.fillRect(0,0,cssW,cssH);
    var spacing = 28*state.view.k;
    while(spacing<10) spacing*=4;
    var spacingRounded = Math.round(spacing);
    var key = spacingRounded+'@'+dprCur;
    if(dotPatternCache.spacingKey!==key){
      var tile = document.createElement('canvas');
      var tsize = Math.max(4, Math.round(spacingRounded*dprCur));
      tile.width = tsize; tile.height = tsize;
      var tctx = tile.getContext('2d');
      tctx.fillStyle = '#C7CDD9';
      tctx.beginPath();
      tctx.arc(tsize/2, tsize/2, Math.max(1, 1.4*dprCur), 0, Math.PI*2);
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
      try{ dotPatternCache.pattern.setTransform(new DOMMatrix().scale(1/dprCur)); }catch(err){}
    }
    ctx.fillStyle = dotPatternCache.pattern;
    ctx.fillRect(-ox, -oy, cssW+spacing, cssH+spacing);
    ctx.restore();
  }

  // ---------------------------------------------------------
  // カリング用ビューポート矩形（ワールド座標、余白付き）
  // ---------------------------------------------------------
  function getCullRect(){
    var margin = 200;
    var tl = screenToWorld(-margin,-margin), br = screenToWorld(cssW+margin, cssH+margin);
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
  var groupLabelHitRects = [];

  var lastZoomLabel = null;
  function render(){
    var t0 = now();
    var animating = stepAnim();
    var zoomLabelNow = Math.round(state.view.k*100);
    if(zoomLabelNow!==lastZoomLabel){ lastZoomLabel=zoomLabelNow; zoomPctEl.textContent = zoomLabelNow+'%'; }

    var ctx = stageCtx;
    ctx.setTransform(dprCur,0,0,dprCur,0,0);
    ctx.clearRect(0,0,cssW,cssH);

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

    renderMinimap();

    recordFrame(now()-t0);
    if(animating || nodeRasterBudget.catchup || screenRasterBudget.catchup){ invalidate(); }
  }

  function drawGroups(ctx, cull){
    groupLabelHitRects = [];
    var groups = state.currentGroups || [];
    ctx.save();
    for(var i=0;i<groups.length;i++){
      var g = groups[i];
      var r = { x:g.x, y:g.y, w:g.w, h:g.h };
      if(!rectIntersects(r, cull)) continue;
      var sr = worldRectToScreen(r);
      ctx.strokeStyle = 'rgba(90,100,120,.28)';
      ctx.setLineDash([6,5]);
      ctx.lineWidth = 1;
      roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, 20);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if(g.label){
        ctx.font = '700 12.5px '+FONT_STACK;
        var padX=10, padY=6, th=20;
        var tw = measureCached(ctx, g.label, ctx.font)+padX*2;
        // 見出し帯（グループ上端〜最初のノード上端）が画面上で狭いときは、
        // 画面ノードの見出しと重ならないようグループ枠の外側（上）に出す
        if(g.__band==null){
          var minTop = Infinity;
          registry.forEach(function(en){
            var p = en.modePos[state.mode];
            if(p && p.x>=g.x && p.x<g.x+g.w && p.y>=g.y && p.y<g.y+g.h) minTop = Math.min(minTop, p.y);
          });
          g.__band = isFinite(minTop) ? minTop-g.y : g.h;
        }
        var lx = sr.x+16;
        var ly = (g.__band*state.view.k >= th+12+34) ? sr.y+12 : sr.y-th-6;
        ctx.fillStyle = 'rgba(238,240,244,.9)';
        roundRectPath(ctx, lx, ly, tw, th, 8);
        ctx.fill();
        ctx.fillStyle = '#5B6472';
        ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(g.label, lx+padX, ly+th/2+1);
        groupLabelHitRects.push({ x:lx, y:ly, w:tw, h:th, group:g });
      }
    }
    ctx.restore();
  }

  function drawEdges(ctx, cull, visSet, connected, focusId){
    var edges = state.currentEdges;
    var placedLabels = [];
    var mode = state.mode;
    var modeUnit = (VIEWER_DATA.modes[mode] && VIEWER_DATA.modes[mode].unit) || 0;
    // ハイライト対象を先に処理してラベル優先度を上げる
    var ordered = edges;
    if(connected){
      ordered = edges.slice().sort(function(a,b){
        var ca = connected.has(a)?0:1, cb = connected.has(b)?0:1;
        return ca-cb;
      });
    }
    for(var idx=0; idx<ordered.length; idx++){
      var e = ordered[idx];
      if(state.hiddenTypes.has(e.type)) continue;
      if(visSet && !(visSet.has(e.from) && visSet.has(e.to))) continue;
      var a = registry.get(e.from), b = registry.get(e.to);
      if(!a || !b || !a.cur || !b.cur || a.cur.op<=0.02 || b.cur.op<=0.02) continue;
      var route = e.route;
      if(!route || route.length<2) continue;

      // route のバウンディングボックスでカリング
      var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(var i=0;i<route.length;i++){ minX=Math.min(minX,route[i][0]); minY=Math.min(minY,route[i][1]); maxX=Math.max(maxX,route[i][0]); maxY=Math.max(maxY,route[i][1]); }
      if(!rectIntersects({x:minX,y:minY,w:maxX-minX,h:maxY-minY}, cull)) continue;

      // layout: "elk" の flow は参照 HTML に合わせて線幅もズームに比例させる（参照 3.2px。見やすさのため上下限あり）
      var baseW = modeUnit ? clamp(3.2*modeUnit*state.view.k, 1.6, 4) : 1.6;
      var opacity = EDGE_ALPHA[e.type] || 1, widthPx = baseW;
      if(mode==='dfd' && state.dfdStep!=null){ opacity = (e.step===state.dfdStep) ? 1 : 0.15; }
      if(focusId){
        if(connected.has(e)){ opacity=1; widthPx=baseW+1; }
        else { opacity=Math.min(opacity,0.15); }
      }

      var pts = route.map(function(p){ return worldToScreen(p[0],p[1]); });
      var isBezier = e.shape==='bezier' && pts.length===4;
      var color = EDGE_COLOR[e.type] || '#94A3B8';
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      var dash = EDGE_DASH[e.type];
      var dashScale = modeUnit ? widthPx/1.6 : Math.max(0.6,Math.min(1.6,state.view.k));
      ctx.setLineDash(dash ? dash.map(function(d){return d*dashScale;}) : []);
      if(isBezier){
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
      } else {
        drawRoundedPolyline(ctx, pts, Math.max(2, Math.min(20, 12*state.view.k)));
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // 矢じり（ベジェは終点の接線 = 制御点2→終点 の向き）
      var pEnd = pts[pts.length-1], pPrev = pts[pts.length-2];
      var arrowSize = modeUnit ? clamp(widthPx*3.4, 7, 14) : Math.max(6, Math.min(11, 9*Math.sqrt(state.view.k)));
      drawArrowHead(ctx, pPrev, pEnd, color, arrowSize);
      ctx.restore();

      // ラベル（貪欲法で重なりを間引く）
      // layout: "elk" はラベルもズームに比例（参照 12px・左右余白 11px・高さ 26px。10〜13px に収める。
      // 全体表示でも遷移の意味が読めるよう、縮小しても消さない）
      var labelPx = modeUnit ? clamp(12*modeUnit*state.view.k, 10, 13) : 11;
      var labelVisible = modeUnit ? true : state.view.k>EDGE_LABEL_MIN_K;
      if(e.label && labelVisible){
        var labelWorld = e.labelAt || route[Math.floor(route.length/2)];
        var lp = worldToScreen(labelWorld[0], labelWorld[1]);
        var lw, lh;
        if(modeUnit){
          ctx.font = scaledFont('600', labelPx);
          lw = measureScaled(ctx, e.label, '600', labelPx) + labelPx*1.8; lh = labelPx*2.1;
        } else {
          ctx.font = '600 11px '+FONT_STACK;
          lw = measureCached(ctx, e.label, ctx.font)+18; lh = 20;
        }
        var lrect = { x:lp.x-lw/2, y:lp.y-lh/2, w:lw, h:lh };
        var overlap = false;
        if(!connected || !connected.has(e)){
          for(var pi=0; pi<placedLabels.length; pi++){
            var pr = placedLabels[pi];
            if(lrect.x < pr.x+pr.w && lrect.x+lrect.w > pr.x && lrect.y < pr.y+pr.h && lrect.y+lrect.h > pr.y){ overlap=true; break; }
          }
        }
        if(!overlap){
          placedLabels.push(lrect);
          ctx.save();
          ctx.globalAlpha = opacity;
          roundRectPath(ctx, lrect.x, lrect.y, lrect.w, lrect.h, 999);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.lineWidth=1; ctx.strokeStyle = e.type==='system' ? '#DCCBFB' : '#E2E6ED';
          ctx.stroke();
          ctx.fillStyle = e.type==='system' ? '#6D28D9' : '#5B6472';
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(e.label, lp.x, lp.y+1);
          ctx.restore();
        }
      }
      if(mode==='er'){
        drawMultLabel(ctx, pts[0], e.fromLabel, opacity);
        drawMultLabel(ctx, pts[pts.length-1], e.toLabel, opacity);
      }
    }
  }
  function drawMultLabel(ctx, p, text, opacity){
    if(!text) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = '800 10.5px '+FONT_STACK;
    var w = measureCached(ctx,text,ctx.font)+6;
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x-w/2, p.y-8, w, 14);
    ctx.fillStyle = '#5B6472';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(text, p.x, p.y-1);
    ctx.restore();
  }

  function drawRoundedPolyline(ctx, pts, radius){
    ctx.beginPath();
    if(pts.length===2){ ctx.moveTo(pts[0].x,pts[0].y); ctx.lineTo(pts[1].x,pts[1].y); return; }
    ctx.moveTo(pts[0].x, pts[0].y);
    for(var i=1;i<pts.length-1;i++){
      ctx.arcTo(pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y, radius);
    }
    ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
  }
  function drawArrowHead(ctx, from, to, color, size){
    var dx=to.x-from.x, dy=to.y-from.y;
    var len=Math.hypot(dx,dy)||1; dx/=len; dy/=len;
    var back={x:to.x-dx*size,y:to.y-dy*size};
    var nx=-dy, ny=dx, wing=size*0.55;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha; // 既存の alpha を継承
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x,to.y);
    ctx.lineTo(back.x+nx*wing, back.y+ny*wing);
    ctx.lineTo(back.x-nx*wing, back.y-ny*wing);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

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
      if(sr.x>cssW || sr.y>cssH || sr.x+sr.w<0 || sr.y+sr.h<0) continue;

      ctx.save();
      ctx.globalAlpha = c.op;
      if(entry.kind==='screen') drawScreenNode(ctx, entry, sr, c);
      else drawCacheableNode(ctx, entry, sr, c);
      ctx.restore();
    }
  }

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

    // 見出し（スクリーン座標固定サイズ）
    var headY = sr.y-8;
    ctx.font = '700 12px '+FONT_STACK;
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    var idText = entry.id+'  ';
    var idW = measureCached(ctx, idText, ctx.font);
    var maxHeadW = Math.max(40, sr.w);
    ctx.fillStyle = '#8A93A3';
    ctx.fillText(idText, sr.x, headY);
    ctx.fillStyle = '#1A2029';
    var titleMaxW = Math.max(10, maxHeadW-idW-(sr.w>=300?100:0));
    ctx.fillText(truncateText(ctx, scr.title||'', ctx.font, titleMaxW), sr.x+idW, headY);
    if(sr.w>=300){
      var tagText = screenTagText(scr);
      ctx.font = '700 10px '+FONT_STACK;
      var tw = measureCached(ctx, tagText, ctx.font)+16;
      var tx = sr.x+sr.w-tw;
      roundRectPath(ctx, tx, headY-13, tw, 17, 999);
      ctx.fillStyle = scr.platform==='teams' ? '#5B5FC7' : '#2F5BEA';
      ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(tagText, tx+tw/2, headY-13+9);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    }
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
    var devicePx = iw*dprCur;
    var wantWhich = devicePx>LIVE_MIN_PX ? 'l' : 's';
    var altWhich = wantWhich==='l' ? 's' : 'l';
    var which = wantWhich, img = ensureImage(entry.id, wantWhich);
    if(!img){ img = ensureImage(entry.id, altWhich); which = altWhich; }
    if(img){
      var bucket = pickBucket(state.view.k, dprCur);
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
    else if(entry.kind==='dfd') fill = (DFD_VARIANT_COLOR[n.variant]||DFD_VARIANT_COLOR.proc).fg;
    else if(entry.kind==='pill') fill = '#1A2029';
    roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, Math.min(10, sr.w/4));
    ctx.fillStyle = fill; ctx.fill();
  }
  function drawCacheableNode(ctx, entry, sr, c){
    var mp = entry.modePos[state.mode];
    var unit = (mp && mp.node && mp.node.unit) || 1;   // layout: "elk" の起点ノードは文字も unit 倍で大きい
    var deviceScale = state.view.k*dprCur*unit;
    if(deviceScale < TEXT_MIN_SCALE){
      // 文字を描かず色付きの箱だけ
      drawSimpleBox(ctx, entry, sr);
      return;
    }
    var bucket = pickBucket(state.view.k, dprCur);
    var rec = getRaster(entry, c.w, c.h, bucket);
    if(!rec){ drawSimpleBox(ctx, entry, sr); return; }
    ctx.drawImage(rec.canvas, 0,0, rec.w, rec.h, sr.x, sr.y, sr.w, sr.h);
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

  // ---------------------------------------------------------
  // 描画スケジューラ（待機中は rAF もタイマーも回さない）
  // ---------------------------------------------------------
  var rafId = 0, settleTimer = 0;
  function invalidate(){
    if(!rafId) rafId = requestAnimationFrame(function(){ rafId=0; render(); });
  }
  function onViewChanged(){
    if(settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function(){ settleTimer=0; minimapBgDirty=true; invalidate(); }, SETTLE_MS);
    minimapBgDirty = true;
  }

  // ---------------------------------------------------------
  // ヒットテスト
  // ---------------------------------------------------------
  function hitTestNode(sx, sy){
    var visSet = visibleNodeIdSet();
    var ids = state.currentNodeIds;
    for(var i=ids.length-1;i>=0;i--){
      var entry = registry.get(ids[i]);
      if(!entry || !entry.cur || entry.cur.op<=0.05) continue;
      if(visSet && !visSet.has(entry.id)) continue;
      var sr = worldRectToScreen(entry.cur);
      if(sx>=sr.x && sx<=sr.x+sr.w && sy>=sr.y && sy<=sr.y+sr.h) return entry.id;
    }
    return null;
  }
  function hitTestGroupLabel(sx,sy){
    for(var i=0;i<groupLabelHitRects.length;i++){
      var r = groupLabelHitRects[i];
      if(sx>=r.x && sx<=r.x+r.w && sy>=r.y && sy<=r.y+r.h) return r.group;
    }
    return null;
  }

  // ---------------------------------------------------------
  // 詳細パネル
  // ---------------------------------------------------------
  function closePanel(){
    state.selected = null;
    detailPanelEl.hidden = true;
    if(state.neighborOnly){ state.neighborOnly=false; neighborToggleBtn.classList.remove('v-active'); }
    invalidate();
  }
  function selectNode(id){
    if(!registry.has(id)){ console.warn('[viewer] selectNode: 未知のノード id: '+id); return; }
    state.selected = id;
    renderPanel();
    detailPanelEl.hidden = false;
    invalidate();
  }
  function section(title, innerHtml){ return '<div class="v-section"><div class="v-section-h">'+escHtml(title)+'</div>'+innerHtml+'</div>'; }
  function emptyHtml(){ return '<div class="v-empty">なし</div>'; }
  function listSection(title, arr){
    if(!arr || !arr.length) return section(title, emptyHtml());
    return section(title, '<ul>'+arr.map(function(x){ return '<li>'+escHtml(x)+'</li>'; }).join('')+'</ul>');
  }
  function transitionsSection(id, heading){
    var rows = state.currentEdges.filter(function(e){ return e.from===id || e.to===id; }).map(function(e){
      var otherId = e.from===id ? e.to : e.from;
      var dir = e.from===id ? '→' : '←';
      var other = registry.get(otherId);
      var label = other ? nodeLabel(other) : (otherId+'（未定義）');
      return '<div class="v-trans-item" data-target="'+escHtml(otherId)+'">'+
        '<span class="v-trans-dir">'+dir+'</span><span class="v-trans-node">'+escHtml(label)+'</span>'+
        (e.label? '<span class="v-trans-label">'+escHtml(e.label)+'</span>' : '')+'</div>';
    }).join('');
    return section(heading, rows ? '<div class="v-trans-list">'+rows+'</div>' : emptyHtml());
  }
  function attachPanelHandlers(){
    var rows = panelBodyEl.querySelectorAll('.v-trans-item');
    for(var i=0;i<rows.length;i++){
      rows[i].addEventListener('click', (function(el){ return function(){ focusNode(el.getAttribute('data-target')); }; })(rows[i]));
    }
    var openBtn = panelBodyEl.querySelector('.v-open-screen-btn');
    if(openBtn){ openBtn.addEventListener('click', function(){ openScreenPreview(openBtn.getAttribute('data-id')); }); }
  }
  function renderScreenPanel(entry){
    var s = screensById.get(entry.id) || {};
    var html = '<div class="v-panel-kicker">'+escHtml(entry.id)+' ・ 画面</div>'+
      '<div class="v-panel-title">'+escHtml(s.title)+'</div>'+
      '<div class="v-tag-row"><span class="v-tag">'+escHtml(platformName(s, 'Power Apps'))+'</span>'+
      '<span class="v-tag v-tag-slate">'+escHtml(s.role)+'</span></div>'+
      '<button class="v-open-screen-btn" type="button" data-id="'+escHtml(entry.id)+'">画面を開く（等倍プレビュー）</button>';
    html += section('目的', s.purpose ? '<div class="v-section-p">'+escHtml(s.purpose)+'</div>' : emptyHtml());
    html += listSection('主な操作', s.ops);
    html += listSection('読み取り', s.reads);
    html += listSection('書き込み', s.writes);
    html += listSection('関連タスク', s.tasks);
    html += listSection('仕様', s.spec);
    html += listSection('注意', s.notes);
    html += transitionsSection(entry.id, 'この画面から／への遷移');
    panelBodyEl.innerHTML = html;
    attachPanelHandlers();
  }
  function renderNodePanel(entry){
    var mp = entry.modePos[state.mode] || entry.modePos[Object.keys(entry.modePos)[0]];
    var n = (mp && mp.node) || {};
    var html = '<div class="v-panel-kicker">'+escHtml(entry.id)+' ・ '+escHtml(KIND_LABEL_JA[entry.kind]||entry.kind)+'</div>'+
      '<div class="v-panel-title">'+escHtml(n.label||entry.id)+'</div>';
    if(n.sub){ html += '<div class="v-tag-row"><span class="v-tag v-tag-slate">'+escHtml(n.sub)+'</span></div>'; }
    html += section('説明', n.info ? '<div class="v-section-p">'+escHtml(n.info)+'</div>' : emptyHtml());
    if(entry.kind==='er' && n.fields && n.fields.length){
      html += section('列', '<ul>'+n.fields.map(function(f){
        var keyTxt = f.key? '['+f.key+'] ' : '';
        var noteTxt = f.note? '　'+f.note : '';
        return '<li>'+escHtml(keyTxt)+escHtml(f.name)+'（'+escHtml(f.type||'')+'）'+escHtml(noteTxt)+'</li>';
      }).join('')+'</ul>');
    }
    html += transitionsSection(entry.id, '関連する辺');
    panelBodyEl.innerHTML = html;
    attachPanelHandlers();
  }
  function renderPanel(){
    if(!state.selected){ detailPanelEl.hidden=true; return; }
    var entry = registry.get(state.selected);
    if(!entry){ detailPanelEl.hidden=true; return; }
    if(entry.kind==='screen') renderScreenPanel(entry); else renderNodePanel(entry);
  }

  // ---------------------------------------------------------
  // 等倍プレビュー モーダル
  // ---------------------------------------------------------
  function openScreenPreview(id){
    var s = screensById.get(id);
    if(!s) return;
    modalTitleEl.textContent = id+' ・ '+(s.title||'');
    var w = s.w||1440, h = s.h||900;
    modalBodyEl.innerHTML = '';
    var iframe = document.createElement('iframe');
    iframe.src = 'screens/'+encodeURIComponent(id)+'.html';
    iframe.width = w; iframe.height = h;
    iframe.style.width = w+'px'; iframe.style.height = h+'px';
    modalBodyEl.appendChild(iframe);
    previewModalEl.classList.add('v-open');
    setModalScale('fit', w, h);
  }
  function setModalScale(mode, w, h){
    var iframe = modalBodyEl.querySelector('iframe');
    if(!iframe) return;
    modalScale100Btn.classList.toggle('v-active', mode==='100');
    modalScaleFitBtn.classList.toggle('v-active', mode==='fit');
    if(mode==='100'){
      iframe.style.transform = 'none';
      modalBodyEl.style.width = w+'px'; modalBodyEl.style.height = h+'px';
    } else {
      var maxW = Math.min(window.innerWidth*0.9, 1400);
      var maxH = window.innerHeight*0.78;
      var scale = Math.min(1, maxW/w, maxH/h);
      iframe.style.transformOrigin = '0 0';
      iframe.style.transform = 'scale('+scale+')';
      modalBodyEl.style.width = (w*scale)+'px'; modalBodyEl.style.height = (h*scale)+'px';
    }
  }
  function closeModal(){
    previewModalEl.classList.remove('v-open');
    modalBodyEl.innerHTML = '';
  }

  // ---------------------------------------------------------
  // パン・ズーム・入力
  // ---------------------------------------------------------
  function zoomAt(sx, sy, factor){
    var oldK = state.view.k;
    var newK = clamp(oldK*factor, MIN_K, MAX_K);
    var wx = (sx-state.view.x)/oldK, wy = (sy-state.view.y)/oldK;
    state.view.x = sx - wx*newK;
    state.view.y = sy - wy*newK;
    state.view.k = newK;
    state.anim = null;
    onViewChanged();
    invalidate();
  }
  function zoomStep(dir){ zoomAt(cssW/2, cssH/2, dir>0?1.2:1/1.2); }
  function updateZoomLabel(){ zoomPctEl.textContent = Math.round(state.view.k*100)+'%'; }

  function updateSegActive(){
    var btns = modeSegEl.querySelectorAll('.v-seg-btn');
    for(var i=0;i<btns.length;i++){ btns[i].classList.toggle('v-active', btns[i].getAttribute('data-mode')===state.mode); }
  }

  var drag = { active:false, moved:false, startX:0, startY:0, startView:null, targetId:null };
  var hoverPending = false, lastPointer = {x:0,y:0};

  function processHover(){
    hoverPending = false;
    var id = hitTestNode(lastPointer.x, lastPointer.y);
    if(state.hovered!==id){ state.hovered = id; invalidate(); }
    updateZoomLabel();
  }

  function attachListeners(){
    window.addEventListener('resize', function(){ resizeStage(); fitCurrentMode(false); });

    modeSegEl.addEventListener('click', function(e){
      var b = e.target.closest('.v-seg-btn'); if(!b) return;
      setMode(b.getAttribute('data-mode'));
    });
    zoomOutBtn.addEventListener('click', function(){ zoomStep(-1); });
    zoomInBtn.addEventListener('click', function(){ zoomStep(1); });
    zoomFitBtn.addEventListener('click', function(){ fitCurrentMode(true); });
    closePanelBtn.addEventListener('click', closePanel);
    neighborToggleBtn.addEventListener('click', function(){
      state.neighborOnly = !state.neighborOnly;
      neighborToggleBtn.classList.toggle('v-active', state.neighborOnly);
      minimapBgDirty = true;
      invalidate();
    });
    toggleListEl.addEventListener('change', function(e){
      var cb = e.target.closest('input[data-toggle-type]'); if(!cb) return;
      var type = cb.getAttribute('data-toggle-type');
      if(cb.checked) state.hiddenTypes.delete(type); else state.hiddenTypes.add(type);
      invalidate();
    });
    stepListEl.addEventListener('click', function(e){
      var item = e.target.closest('.v-step-item'); if(!item) return;
      setDfdStep(Number(item.getAttribute('data-step')));
    });
    stepPlayEl.addEventListener('click', toggleAutoplay);

    // 検索
    searchInputEl.addEventListener('input', function(){ runSearch(searchInputEl.value); });
    searchInputEl.addEventListener('keydown', function(e){
      if(e.key==='Enter'){
        var first = searchResultsEl.querySelector('.v-search-item');
        if(first){ focusNode(first.getAttribute('data-id')); searchResultsEl.classList.remove('v-open'); searchInputEl.blur(); }
      } else if(e.key==='Escape'){ searchInputEl.value=''; searchResultsEl.classList.remove('v-open'); searchInputEl.blur(); }
    });
    searchResultsEl.addEventListener('click', function(e){
      var item = e.target.closest('.v-search-item'); if(!item) return;
      focusNode(item.getAttribute('data-id'));
      searchResultsEl.classList.remove('v-open');
    });
    searchInputEl.addEventListener('focus', function(){ if(searchInputEl.value) runSearch(searchInputEl.value); });
    document.addEventListener('click', function(e){
      if(!e.target.closest('#searchCard')) searchResultsEl.classList.remove('v-open');
    });

    // モーダル
    modalCloseBtn.addEventListener('click', closeModal);
    previewModalEl.addEventListener('click', function(e){ if(e.target===previewModalEl) closeModal(); });
    modalScale100Btn.addEventListener('click', function(){
      var iframe = modalBodyEl.querySelector('iframe');
      if(iframe) setModalScale('100', parseInt(iframe.width,10), parseInt(iframe.height,10));
    });
    modalScaleFitBtn.addEventListener('click', function(){
      var iframe = modalBodyEl.querySelector('iframe');
      if(iframe) setModalScale('fit', parseInt(iframe.width,10), parseInt(iframe.height,10));
    });

    // キャンバス操作
    stageEl.addEventListener('pointerdown', function(e){
      if(e.pointerType==='mouse' && e.button!==0) return;
      drag.active = true; drag.moved = false;
      drag.startX = e.clientX; drag.startY = e.clientY;
      drag.startView = { x:state.view.x, y:state.view.y, k:state.view.k };
      var rect = stageEl.getBoundingClientRect();
      drag.targetId = hitTestNode(e.clientX-rect.left, e.clientY-rect.top);
      drag.targetGroup = drag.targetId ? null : hitTestGroupLabel(e.clientX-rect.left, e.clientY-rect.top);
      try{ stageEl.setPointerCapture(e.pointerId); }catch(err){}
      stageEl.classList.add('v-panning');
      state.anim = null;
    });
    stageEl.addEventListener('pointermove', function(e){
      var rect = stageEl.getBoundingClientRect();
      var sx = e.clientX-rect.left, sy = e.clientY-rect.top;
      if(drag.active){
        var dx=e.clientX-drag.startX, dy=e.clientY-drag.startY;
        if(!drag.moved && Math.hypot(dx,dy)>4) drag.moved=true;
        if(drag.moved){
          state.view.x = drag.startView.x+dx;
          state.view.y = drag.startView.y+dy;
          onViewChanged();
          invalidate();
        }
      } else {
        lastPointer.x = sx; lastPointer.y = sy;
        if(!hoverPending){ hoverPending = true; requestAnimationFrame(processHover); }
      }
    });
    function endDrag(e){
      if(!drag.active) return;
      if(!drag.moved){
        if(drag.targetId) selectNode(drag.targetId);
        else if(drag.targetGroup) fitGroup(drag.targetGroup);
        else closePanel();
      }
      drag.active = false;
      stageEl.classList.remove('v-panning');
      try{ stageEl.releasePointerCapture(e.pointerId); }catch(err){}
    }
    stageEl.addEventListener('pointerup', endDrag);
    stageEl.addEventListener('pointercancel', function(){ drag.active=false; stageEl.classList.remove('v-panning'); });

    stageEl.addEventListener('dblclick', function(e){
      var rect = stageEl.getBoundingClientRect();
      var id = hitTestNode(e.clientX-rect.left, e.clientY-rect.top);
      if(id) focusNode(id);
    });

    stageEl.addEventListener('wheel', function(e){
      e.preventDefault();
      var rect = stageEl.getBoundingClientRect();
      var mx = e.clientX-rect.left, my = e.clientY-rect.top;
      var factor = Math.exp(-e.deltaY*0.0018);
      zoomAt(mx, my, factor);
    }, { passive:false });

    // ミニマップ
    var mmDrag = false;
    minimapEl.addEventListener('pointerdown', function(e){
      mmDrag = true;
      var rect = minimapEl.getBoundingClientRect();
      var w = minimapToWorld(e.clientX-rect.left, e.clientY-rect.top);
      panToWorldCenter(w.x, w.y);
      try{ minimapEl.setPointerCapture(e.pointerId); }catch(err){}
    });
    minimapEl.addEventListener('pointermove', function(e){
      if(!mmDrag) return;
      var rect = minimapEl.getBoundingClientRect();
      var w = minimapToWorld(e.clientX-rect.left, e.clientY-rect.top);
      panToWorldCenter(w.x, w.y);
    });
    minimapEl.addEventListener('pointerup', function(e){ mmDrag=false; try{ minimapEl.releasePointerCapture(e.pointerId); }catch(err){} });

    window.addEventListener('keydown', function(e){
      var tag = e.target && e.target.tagName;
      if(tag==='INPUT' || tag==='TEXTAREA') return;
      if(e.key==='/'){ e.preventDefault(); searchInputEl.focus(); return; }
      if(e.key>='1' && e.key<='5'){ setMode(MODE_KEYS[Number(e.key)-1]); return; }
      if(e.key==='f' || e.key==='F'){ fitCurrentMode(true); return; }
      if(e.key==='+' || e.key==='='){ zoomStep(1); return; }
      if(e.key==='-' || e.key==='_'){ zoomStep(-1); return; }
      if(e.key==='Escape'){ if(previewModalEl.classList.contains('v-open')) closeModal(); else closePanel(); return; }
      if(e.key==='Enter'){
        if(state.selected && registry.get(state.selected) && registry.get(state.selected).kind==='screen'){ openScreenPreview(state.selected); }
        return;
      }
      if(e.key==='ArrowRight' || e.key==='ArrowLeft'){
        if(state.mode==='flow' || state.mode==='gallery'){
          var list = VIEWER_DATA.screens || [];
          if(!list.length) return;
          var idx = state.selected ? list.findIndex(function(s){ return s.id===state.selected; }) : -1;
          if(e.key==='ArrowRight') idx=(idx+1+list.length)%list.length; else idx=(idx-1+list.length)%list.length;
          focusNode(list[idx].id);
        }
      }
    });
  }

  // ---------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------
  function applyMeta(){
    var meta = VIEWER_DATA.meta || {};
    titleTextEl.textContent = meta.title || '';
    document.title = meta.title || '設計ビューア';
    subtitleTextEl.textContent = meta.subtitle || '';
    if(meta.statusNote){ statusNoteEl.textContent = meta.statusNote; statusNoteEl.style.display=''; }
    else { statusNoteEl.style.display='none'; }
  }
  function renderFatalError(msg){
    if(titleTextEl) titleTextEl.textContent = '読み込みエラー';
    if(subtitleTextEl) subtitleTextEl.textContent = msg;
  }

  function init(){
    cacheDom();
    if(!window.VIEWER_DATA || !VIEWER_DATA.modes || !VIEWER_DATA.screens){
      console.error('[viewer] VIEWER_DATA が未定義、または不正です。viewer-data.js を確認してください。');
      renderFatalError('データ（viewer-data.js）が読み込めませんでした。');
      return;
    }
    buildRegistry();
    var hasAnyMinimap = MODE_KEYS.some(function(k){ return VIEWER_DATA.modes[k]; });
    minimapCardEl.hidden = !hasAnyMinimap;
    resizeStage();
    attachListeners();
    applyMeta();

    var hashMode = (location.hash||'').replace('#','');
    var initMode = MODE_KEYS.indexOf(hashMode)>=0 && VIEWER_DATA.modes[hashMode] ? hashMode : MODE_KEYS.filter(function(k){return VIEWER_DATA.modes[k];})[0];
    if(!initMode){ renderFatalError('表示できるモードがありません。'); return; }
    setMode(initMode, { noAnim:true });
    invalidate();
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); }
  else { init(); }

})();
