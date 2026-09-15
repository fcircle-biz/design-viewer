(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // DOM 参照のキャッシュ・状態・レジストリ構築・座標変換・全体表示。
  // --- import ---
  var MIN_K, MAX_K, clamp, invalidate;
  DV.links.push(function(){
    MIN_K = DV.MIN_K; MAX_K = DV.MAX_K; clamp = DV.clamp; invalidate = DV.invalidate;
  });
  // --- body ---
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
    DV.stageEl = stageEl; DV.stageCtx = stageCtx; DV.minimapEl = minimapEl; DV.minimapCtx = minimapCtx; // [split]
    DV.titleTextEl = titleTextEl; DV.subtitleTextEl = subtitleTextEl; DV.statusNoteEl = statusNoteEl; DV.modeDescEl = modeDescEl; // [split]
    DV.searchInputEl = searchInputEl; DV.searchResultsEl = searchResultsEl; // [split]
    DV.legendListEl = legendListEl; DV.toggleListEl = toggleListEl; // [split]
    DV.stepsCardEl = stepsCardEl; DV.stepPlayEl = stepPlayEl; DV.stepListEl = stepListEl; // [split]
    DV.detailPanelEl = detailPanelEl; DV.closePanelBtn = closePanelBtn; DV.panelBodyEl = panelBodyEl; // [split]
    DV.modeSegEl = modeSegEl; DV.zoomOutBtn = zoomOutBtn; DV.zoomInBtn = zoomInBtn; DV.zoomFitBtn = zoomFitBtn; DV.zoomPctEl = zoomPctEl; DV.neighborToggleBtn = neighborToggleBtn; // [split]
    DV.minimapCardEl = minimapCardEl; // [split]
    DV.previewModalEl = previewModalEl; DV.modalTitleEl = modalTitleEl; DV.modalBodyEl = modalBodyEl; DV.modalCloseBtn = modalCloseBtn; DV.modalScale100Btn = modalScale100Btn; DV.modalScaleFitBtn = modalScaleFitBtn; // [split]
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
    currentPhases: [],
    currentTable: null,
    modeBounds: { x:0,y:0,w:1000,h:1000 },
    dfdStep: null,
    autoplayTimer: null,
    anim: null,
    nodeAnim: null,                  // モード切替時のノード移動・フェード（view の anim とは独立）
    neighborOnly: false
  };

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
    rt.cssW = w; rt.cssH = h; rt.dprCur = dpr;
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
    rt.minimapBgDirty = true;
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

  // 全体表示の候補領域を1つ作る。belowTitle: タイトルカードの下（全幅）、
  // rightOfTitle: タイトルカードの右（全高）。どちらも右のステップカード・
  // 下のツールバーとは重ならないよう詰める（狭い画面ではタイトルカードを避けるだけ）。
  function fitViewRegion(pinTitleToTop){
    var left=60, right=rt.cssW-60, top=60, bottom=rt.cssH-60;
    if(rt.cssW>900){
      var tc = document.getElementById('titleCard');
      if(tc && !tc.hidden){
        var tcRect = tc.getBoundingClientRect();
        if(pinTitleToTop) top = Math.max(top, tcRect.bottom + 24);
        else left = Math.max(left, tcRect.right + 24);
      }
      var sc = document.getElementById('stepsCard');
      if(sc && !sc.hidden) right = Math.min(right, sc.getBoundingClientRect().left - 24);
      var tb = document.getElementById('toolbar');
      if(tb) bottom = Math.min(bottom, tb.getBoundingClientRect().top - 24);
    }
    return { left:left, right:right, top:top, bottom:bottom };
  }

  // 全体表示: 「タイトルカードの下・全幅」と「タイトルカードの右・全高」の
  // 2 つの候補領域それぞれで倍率を計算し、大きい方（＝より大きく表示できる方）を
  // 採用する。全モード共通の改善（図の縦横比によってどちらが有利かが変わるため）。
  function fitView(bbox, maxK){
    var regions = rt.cssW>900 ? [fitViewRegion(true), fitViewRegion(false)] : [fitViewRegion(true)];
    var best=null, bestK=-1;
    for(var i=0;i<regions.length;i++){
      var reg = regions[i];
      var availW = Math.max(80, reg.right-reg.left), availH = Math.max(80, reg.bottom-reg.top);
      var k = Math.min(availW/bbox.w, availH/bbox.h);
      k = clamp(k, MIN_K, Math.min(maxK||1.4, MAX_K));
      if(k>bestK){ bestK=k; best=reg; }
    }
    var k = bestK;
    var cx = bbox.x+bbox.w/2, cy = bbox.y+bbox.h/2;
    return { x:(best.left+best.right)/2 - cx*k, y:(best.top+best.bottom)/2 - cy*k, k:k };
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

  // biz モードのフェーズ（表の行。見出し欄を含む全幅）を全体表示の範囲に含める。
  function phaseRects(modeObj){
    return ((modeObj && modeObj.phases) || []).map(function(p){ return p; });
  }
  // --- body end ---
  // --- export ---
  DV.cacheDom = cacheDom; DV.registry = registry; DV.screensById = screensById; DV.state = state; DV.buildRegistry = buildRegistry; DV.nodeLabel = nodeLabel; DV.resizeStage = resizeStage; DV.worldToScreen = worldToScreen; DV.screenToWorld = screenToWorld; DV.worldRectToScreen = worldRectToScreen; DV.computeBBox = computeBBox; DV.fitView = fitView; DV.routeRects = routeRects; DV.modeNodeRects = modeNodeRects; DV.phaseRects = phaseRects; DV.stageEl = stageEl; DV.stageCtx = stageCtx; DV.minimapEl = minimapEl; DV.minimapCtx = minimapCtx; DV.titleTextEl = titleTextEl; DV.subtitleTextEl = subtitleTextEl; DV.statusNoteEl = statusNoteEl; DV.modeDescEl = modeDescEl; DV.searchInputEl = searchInputEl; DV.searchResultsEl = searchResultsEl; DV.legendListEl = legendListEl; DV.toggleListEl = toggleListEl; DV.stepsCardEl = stepsCardEl; DV.stepPlayEl = stepPlayEl; DV.stepListEl = stepListEl; DV.detailPanelEl = detailPanelEl; DV.closePanelBtn = closePanelBtn; DV.panelBodyEl = panelBodyEl; DV.modeSegEl = modeSegEl; DV.zoomOutBtn = zoomOutBtn; DV.zoomInBtn = zoomInBtn; DV.zoomFitBtn = zoomFitBtn; DV.zoomPctEl = zoomPctEl; DV.neighborToggleBtn = neighborToggleBtn; DV.minimapCardEl = minimapCardEl; DV.previewModalEl = previewModalEl; DV.modalTitleEl = modalTitleEl; DV.modalBodyEl = modalBodyEl; DV.modalCloseBtn = modalCloseBtn; DV.modalScale100Btn = modalScale100Btn; DV.modalScaleFitBtn = modalScaleFitBtn;
})();
