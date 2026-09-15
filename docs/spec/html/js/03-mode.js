(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // アニメーション・モード切替・凡例・DFD ステップ・検索。
  // --- import ---
  var CONCEPT_VARIANT_COLOR, MODE_MAX_K, EDGE_COLOR, lerp, logLerp, easeInOutCubic, now, escHtml, modeDescEl, searchResultsEl, legendListEl, toggleListEl, stepPlayEl, stepListEl, stepsCardEl, detailPanelEl, neighborToggleBtn, registry, state, nodeLabel, computeBBox, fitView, routeRects, modeNodeRects, phaseRects, worldRectToScreen, invalidate, onViewChanged, selectNode, updateSegActive, currentPanelWidth, updatePanelCssVar;
  DV.links.push(function(){
    CONCEPT_VARIANT_COLOR = DV.CONCEPT_VARIANT_COLOR; MODE_MAX_K = DV.MODE_MAX_K; EDGE_COLOR = DV.EDGE_COLOR; lerp = DV.lerp; logLerp = DV.logLerp; easeInOutCubic = DV.easeInOutCubic; now = DV.now; escHtml = DV.escHtml; modeDescEl = DV.modeDescEl; searchResultsEl = DV.searchResultsEl; legendListEl = DV.legendListEl; toggleListEl = DV.toggleListEl; stepPlayEl = DV.stepPlayEl; stepListEl = DV.stepListEl; stepsCardEl = DV.stepsCardEl; detailPanelEl = DV.detailPanelEl; neighborToggleBtn = DV.neighborToggleBtn; registry = DV.registry; state = DV.state; nodeLabel = DV.nodeLabel; computeBBox = DV.computeBBox; fitView = DV.fitView; routeRects = DV.routeRects; modeNodeRects = DV.modeNodeRects; phaseRects = DV.phaseRects; worldRectToScreen = DV.worldRectToScreen; invalidate = DV.invalidate; onViewChanged = DV.onViewChanged; selectNode = DV.selectNode; updateSegActive = DV.updateSegActive; currentPanelWidth = DV.currentPanelWidth; updatePanelCssVar = DV.updatePanelCssVar;
  });
  // --- body ---
  // ---------------------------------------------------------
  // アニメーション（モード切替・フォーカス）
  // ---------------------------------------------------------
  // ビュー（パン・ズーム）のアニメーション state.anim と、モード切替時のノード移動・フェード
  // state.nodeAnim は別々に持つ。ホイール・ドラッグ・F キーなどは state.anim だけを止める／置き換えるので、
  // モード切替の直後に操作してもノードが途中の位置・透明度のまま固まらない。
  function snapNodeAnims(nodeAnims){
    (nodeAnims||[]).forEach(function(na){ na.entry.cur = { x:na.to.x, y:na.to.y, w:na.to.w, h:na.to.h, op:na.to.op }; });
  }
  function startAnim(cfg){
    var hasNodes = cfg.nodeAnims && cfg.nodeAnims.length;
    if(hasNodes){
      // 前のモード切替が途中なら最終状態に揃えてから新しい遷移を始める
      if(state.nodeAnim){ snapNodeAnims(state.nodeAnim.nodeAnims); state.nodeAnim = null; }
    }
    if(!cfg.duration || cfg.duration<=0){
      state.view = { x:cfg.toView.x, y:cfg.toView.y, k:cfg.toView.k };
      if(hasNodes) snapNodeAnims(cfg.nodeAnims);
      state.anim = null;
      onViewChanged();
      invalidate();
      return;
    }
    state.anim = { start: now(), duration: cfg.duration, fromView: cfg.fromView, toView: cfg.toView };
    if(hasNodes) state.nodeAnim = { start: state.anim.start, duration: cfg.duration, nodeAnims: cfg.nodeAnims };
    invalidate();
  }
  function stepAnim(){
    var active = false;
    if(state.nodeAnim){
      var tn = (now() - state.nodeAnim.start) / state.nodeAnim.duration;
      if(tn>=1) tn=1;
      var en = easeInOutCubic(tn);
      state.nodeAnim.nodeAnims.forEach(function(na){
        na.entry.cur = {
          x: lerp(na.from.x, na.to.x, en), y: lerp(na.from.y, na.to.y, en),
          w: lerp(na.from.w, na.to.w, en), h: lerp(na.from.h, na.to.h, en),
          op: lerp(na.from.op, na.to.op, en)
        };
      });
      if(tn>=1) state.nodeAnim = null;
      active = true;
    }
    if(state.anim){
      var t = (now() - state.anim.start) / state.anim.duration;
      if(t>=1) t=1;
      var e = easeInOutCubic(t);
      state.view.x = lerp(state.anim.fromView.x, state.anim.toView.x, e);
      state.view.y = lerp(state.anim.fromView.y, state.anim.toView.y, e);
      state.view.k = logLerp(state.anim.fromView.k, state.anim.toView.k, e);
      if(t>=1){ state.anim = null; onViewChanged(); }
      active = true;
    }
    return active;
  }

  // ---------------------------------------------------------
  // 詳細パネルの可視領域を考慮した全体表示
  // ---------------------------------------------------------
  // fitView はタイトルカード・ステップカード・ツールバーの実際の位置は見るが、
  // 詳細パネル（キャンバスの上に浮くカードで DOM 上は関与しない）までは知らない。
  // パネル表示中は rt.cssW を一時的にパネル幅ぶん狭めてから fitView を呼び、
  // 呼び終わったら元に戻す。fitView 自体（02-model.js）は変更しない。
  function fitViewAdjusted(bbox, maxK){
    var inset = currentPanelWidth ? currentPanelWidth() : 0;
    if(!inset) return fitView(bbox, maxK);
    var savedW = rt.cssW;
    rt.cssW = Math.max(200, savedW - inset);
    var result;
    try{ result = fitView(bbox, maxK); }
    finally { rt.cssW = savedW; }
    return result;
  }
  // 選択中のノードが詳細パネルの裏に隠れていたら、ズームはそのままキャンバスだけ
  // 左へパンして可視領域（キャンバス左端〜パネル左端）に収める。パネルを開いた
  // 直後・幅を変え終えたときに呼ぶ。
  function nudgeViewForPanel(){
    var inset = currentPanelWidth ? currentPanelWidth() : 0;
    if(!inset || !state.selected) return;
    var entry = registry.get(state.selected);
    if(!entry) return;
    var pos = entry.modePos[state.mode];
    if(!pos) return;
    var margin = 16;
    var visibleLeft = margin, visibleRight = rt.cssW - inset - margin;
    if(visibleRight<=visibleLeft) return;
    var sr = worldRectToScreen(pos);
    var overflowRight = (sr.x+sr.w) - visibleRight;
    if(overflowRight<=0) return; // すでに見えている
    var dx = overflowRight;
    if(sr.w > (visibleRight-visibleLeft)){ dx = Math.max(0, sr.x-visibleLeft); }
    if(dx<=0) return;
    var toView = { x: state.view.x-dx, y: state.view.y, k: state.view.k };
    startAnim({ duration:280, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:[] });
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
    if(!opts.keepSelection){ state.selected = null; detailPanelEl.hidden = true; if(updatePanelCssVar) updatePanelCssVar(); }
    state.hovered = null;
    if(modeKey!=='dfd'){ stopAutoplay(); state.dfdStep = null; }
    state.neighborOnly = false;
    if(neighborToggleBtn) neighborToggleBtn.classList.remove('v-active');

    var modeObj = VIEWER_DATA.modes[modeKey];
    state.currentGroups = modeObj.groups || [];
    state.currentPhases = modeObj.phases || [];
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

    var bbox = computeBBox(modeNodeRects(modeKey).concat(routeRects(modeObj)), (modeObj.groups||[]).concat(phaseRects(modeObj)));
    state.modeBounds = bbox;
    var maxK = MODE_MAX_K[modeKey] || 1.4;
    var toView = fitViewAdjusted(bbox, maxK);
    startAnim({ duration: opts.noAnim?0:600, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:nodeAnims });
    rt.minimapBgDirty = true;

    try{ history.replaceState(null, '', '#'+modeKey); }catch(err){ /* file:// で失敗する場合がある */ }
  }

  function fitCurrentMode(animate){
    var modeObj = VIEWER_DATA.modes[state.mode];
    var bbox = computeBBox(modeNodeRects(state.mode).concat(routeRects(modeObj)), (modeObj.groups||[]).concat(phaseRects(modeObj)));
    var maxK = MODE_MAX_K[state.mode] || 1.4;
    var toView = fitViewAdjusted(bbox, maxK);
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
    var toView = fitViewAdjusted(bbox, maxK);
    startAnim({ duration:500, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:[] });
  }

  function fitGroup(g){
    var bbox = { x:g.x, y:g.y, w:g.w, h:g.h };
    var maxK = MODE_MAX_K[state.mode] || 1.4;
    var toView = fitViewAdjusted(bbox, maxK);
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
      // ノード種別の凡例（concept の variant）。辺の線種ではなく、ノードの形・色の見本を出す
      if(item.variant && CONCEPT_VARIANT_COLOR && CONCEPT_VARIANT_COLOR[item.variant]){
        var vc = CONCEPT_VARIANT_COLOR[item.variant];
        var rad = item.variant==='actor' ? '7px' : (item.variant==='file' ? '2px' : '4px');
        var st = 'display:inline-block;flex:none;width:20px;height:13px;box-sizing:border-box;border-radius:'+rad+';background:'+vc.card+';border:1.5px '+(vc.dash?'dashed ':'solid ')+vc.border+';'+(item.variant==='system'?'box-shadow:inset 3px 0 0 '+vc.fg+';':'');
        return '<div class="v-legend-item"><span style="'+st+'"></span><span>'+escHtml(item.label)+'</span></div>';
      }
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
      var mp = entry.modePos[state.mode];
      var sub = (entry.kind!=='screen' && mp && mp.node && mp.node.sub) || '';
      return { id:id, label: nodeLabel(entry), sub: sub };
    });
  }
  function runSearch(q){
    q = (q||'').trim().toLowerCase();
    if(!q){ searchResultsEl.classList.remove('v-open'); searchResultsEl.innerHTML=''; return; }
    var hits = searchIndex.filter(function(it){
      return it.id.toLowerCase().indexOf(q)>=0 || it.label.toLowerCase().indexOf(q)>=0 ||
        (it.sub && it.sub.toLowerCase().indexOf(q)>=0);
    }).slice(0,30);
    searchResultsEl.classList.add('v-open');
    if(!hits.length){ searchResultsEl.innerHTML = '<div class="v-search-empty">該当なし</div>'; return; }
    searchResultsEl.innerHTML = hits.map(function(it){
      return '<div class="v-search-item" data-id="'+escHtml(it.id)+'"><span class="v-search-id">'+escHtml(it.id)+'</span><span class="v-search-label">'+escHtml(it.label)+'</span></div>';
    }).join('');
  }
  // --- body end ---
  // --- export ---
  DV.stepAnim = stepAnim; DV.setMode = setMode; DV.fitCurrentMode = fitCurrentMode; DV.focusNode = focusNode; DV.fitGroup = fitGroup; DV.setDfdStep = setDfdStep; DV.toggleAutoplay = toggleAutoplay; DV.runSearch = runSearch; DV.nudgeViewForPanel = nudgeViewForPanel;
})();
