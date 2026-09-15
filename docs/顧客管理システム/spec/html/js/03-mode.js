(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // アニメーション・モード切替・凡例・DFD ステップ・ジョブフローの機能の絞り込み・検索。
  // --- import ---
  var jobFilterCardEl, jobFilterSelectEl, batchesById, CONCEPT_VARIANT_COLOR, MODE_MAX_K, EDGE_COLOR, lerp, logLerp, easeInOutCubic, now, escHtml, modeDescEl, searchResultsEl, legendListEl, toggleListEl, stepPlayEl, stepListEl, stepsCardEl, detailPanelEl, neighborToggleBtn, registry, state, nodeLabel, computeBBox, fitView, routeRects, modeNodeRects, phaseRects, worldRectToScreen, invalidate, onViewChanged, selectNode, updateSegActive, currentPanelWidth, updatePanelCssVar;
  DV.links.push(function(){
    jobFilterCardEl = DV.jobFilterCardEl; jobFilterSelectEl = DV.jobFilterSelectEl; batchesById = DV.batchesById; CONCEPT_VARIANT_COLOR = DV.CONCEPT_VARIANT_COLOR; MODE_MAX_K = DV.MODE_MAX_K; EDGE_COLOR = DV.EDGE_COLOR; lerp = DV.lerp; logLerp = DV.logLerp; easeInOutCubic = DV.easeInOutCubic; now = DV.now; escHtml = DV.escHtml; modeDescEl = DV.modeDescEl; searchResultsEl = DV.searchResultsEl; legendListEl = DV.legendListEl; toggleListEl = DV.toggleListEl; stepPlayEl = DV.stepPlayEl; stepListEl = DV.stepListEl; stepsCardEl = DV.stepsCardEl; detailPanelEl = DV.detailPanelEl; neighborToggleBtn = DV.neighborToggleBtn; registry = DV.registry; state = DV.state; nodeLabel = DV.nodeLabel; computeBBox = DV.computeBBox; fitView = DV.fitView; routeRects = DV.routeRects; modeNodeRects = DV.modeNodeRects; phaseRects = DV.phaseRects; worldRectToScreen = DV.worldRectToScreen; invalidate = DV.invalidate; onViewChanged = DV.onViewChanged; selectNode = DV.selectNode; updateSegActive = DV.updateSegActive; currentPanelWidth = DV.currentPanelWidth; updatePanelCssVar = DV.updatePanelCssVar;
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
    state.currentTable = modeObj.table || null;
    state.currentEdges = prepareEdgesForMode(modeKey);
    state.currentNodeIds = (modeObj.nodes||[]).map(function(n){ return n.id; }).filter(function(id){ return registry.has(id); });
    rebuildLegendAndToggles(modeObj);
    rebuildStepsUI(modeKey, modeObj);
    rebuildJobFilterUI(modeKey, modeObj);
    if(modeKey==='jobflow') applyJobFilterLayout();
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

    var fit = modeFitBox(modeKey, modeObj);
    state.modeBounds = fit.bbox;
    var toView = fitViewAdjusted(fit.box, fit.maxK);
    startAnim({ duration: opts.noAnim?0:600, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:nodeAnims });
    rt.minimapBgDirty = true;

    try{ history.replaceState(null, '', '#'+modeKey); }catch(err){ /* file:// で失敗する場合がある */ }
  }

  // 全体表示の対象領域と最大倍率。表（機能一覧の arrange: "table"。layout が fit: "width" を付ける）は
  // 縦に長いので、全体を収めると文字が読めない。表の幅に合わせ、上端から画面の縦横比ぶんだけを対象にする。
  var FIT_WIDTH_ASPECT = 0.5;
  // ジョブフローを機能で絞り込んでいるときは、対象のノードと行（フェーズ）だけを全体表示の対象にする。
  function modeFitBox(modeKey, modeObj){
    var extra = modeObj.table ? [modeObj.table] : [];
    var filterNodes = modeKey===state.mode ? jobFilterNodeSet() : null;
    if(filterNodes){
      // 絞り込み中のジョブフローは applyJobFilterLayout で詰めた行・列・辺（state.current*）と、表示するノードだけで囲む
      var rects = modeNodeRects(modeKey).filter(function(p){ return filterNodes.has(p.node.id); });
      var fb = computeBBox(rects.concat(routeRects({ edges: state.currentEdges })), state.currentGroups.concat(state.currentPhases));
      return { bbox:fb, box:fb, maxK: modeObj.maxK || MODE_MAX_K[modeKey] || 1.4 };
    }
    var bbox = computeBBox(modeNodeRects(modeKey).concat(routeRects(modeObj)), (modeObj.groups||[]).concat(phaseRects(modeObj)).concat(extra));
    var box = bbox;
    if(modeObj.fit==='width') box = { x:bbox.x, y:bbox.y, w:bbox.w, h:Math.min(bbox.h, bbox.w*FIT_WIDTH_ASPECT) };
    return { bbox:bbox, box:box, maxK: modeObj.maxK || MODE_MAX_K[modeKey] || 1.4 };
  }
  function fitCurrentMode(animate){
    var modeObj = VIEWER_DATA.modes[state.mode];
    var fit = modeFitBox(state.mode, modeObj);
    var toView = fitViewAdjusted(fit.box, fit.maxK);
    startAnim({ duration: animate?500:0, fromView:{x:state.view.x,y:state.view.y,k:state.view.k}, toView:toView, nodeAnims:[] });
  }

  function focusNode(id){
    if(!registry.has(id)){ console.warn('[viewer] focusNode: 未知のノード id: '+id); return; }
    // 機能の絞り込みで隠れているノードへ寄るときは、絞り込みを解除する
    var filterNodes = jobFilterNodeSet();
    if(filterNodes && !filterNodes.has(id)) setJobFilter('', { noFit:true });
    selectNode(id);
    var entry = registry.get(id);
    var pos = entry.modePos[state.mode] || entry.cur;
    if(!pos) return;
    var bbox = { x:pos.x-90, y:pos.y-90, w:pos.w+180, h:pos.h+180 };
    var modeObjF = VIEWER_DATA.modes[state.mode] || {};
    var maxK = modeObjF.maxK || MODE_MAX_K[state.mode] || 1.4;
    // 表では画面の行（サムネイルと文字の全体）に寄る
    var tableRow = state.currentTable && state.currentTable.rows.filter(function(r){ return r.id===id; })[0];
    if(tableRow) bbox = { x:state.currentTable.x, y:tableRow.y-120, w:state.currentTable.w, h:tableRow.h+240 };
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
      if(item.type==='system' || item.type==='weak' || item.type==='ng') cls += ' v-dash';
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
    // arrange: "steps" はステップごとのブロックがあるので、そのブロックへ寄る
    var g = (state.currentGroups||[]).filter(function(x){ return x.step===n; })[0];
    if(g && state.mode==='dfd') fitGroup(g);
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
  // ジョブフローの機能の絞り込み
  // ---------------------------------------------------------
  // 右上のセレクトボックスで batches[] の 1 件を選ぶと、そのバッチのジョブだけを表示して寄る（ほかのバッチの行は取り除いて詰める）。
  // 対象は「batch がそのバッチのノード」と「batch を持たず、それらと同じ行（フェーズ）にあるノード」
  // （外部システム側の受け取り・分岐など、バッチを付けにくいノードを行ごと残すため）。
  // 選択はモードを切り替えても保持する（機能一覧から戻ったときも同じ絞り込みのまま）。
  var jobFilterCache = { key:null, nodes:null, phases:null };
  function computeJobFilter(){
    var modeObj = VIEWER_DATA.modes.jobflow;
    var key = state.jobFilter;
    if(jobFilterCache.key===key) return jobFilterCache;
    var nodes = (modeObj && modeObj.nodes) || [];
    var phases = new Set(), ids = new Set();
    nodes.forEach(function(n){ if(n.batch===key){ ids.add(n.id); if(n.phase) phases.add(n.phase); } });
    nodes.forEach(function(n){ if(!n.batch && n.phase && phases.has(n.phase)) ids.add(n.id); });
    jobFilterCache = { key:key, nodes:ids, phases:phases };
    return jobFilterCache;
  }
  function jobFilterActive(){ return state.mode==='jobflow' && !!state.jobFilter && !!VIEWER_DATA.modes.jobflow; }
  function jobFilterNodeSet(){ return jobFilterActive() ? computeJobFilter().nodes : null; }
  function jobFilterPhaseSet(){ return jobFilterActive() ? computeJobFilter().phases : null; }
  // セレクトボックスの選択肢: jobflow のノードが参照するバッチを、ノードの記述順に 1 回ずつ
  function jobFilterOptions(modeObj){
    var seen = {}, list = [];
    ((modeObj && modeObj.nodes) || []).forEach(function(n){
      if(!n.batch || seen[n.batch]) return;
      seen[n.batch] = true;
      var b = batchesById.get(n.batch);
      list.push({ id:n.batch, label: n.batch+(b && b.title ? ' '+b.title : '') });
    });
    return list;
  }
  function rebuildJobFilterUI(modeKey, modeObj){
    var opts = modeKey==='jobflow' ? jobFilterOptions(modeObj) : [];
    if(!opts.length){ jobFilterCardEl.hidden = true; return; }
    if(state.jobFilter && !opts.some(function(o){ return o.id===state.jobFilter; })) state.jobFilter = '';
    jobFilterSelectEl.innerHTML = '<option value="">すべての機能（'+opts.length+'）</option>'+opts.map(function(o){
      return '<option value="'+escHtml(o.id)+'">'+escHtml(o.label)+'</option>';
    }).join('');
    jobFilterSelectEl.value = state.jobFilter;
    jobFilterCardEl.hidden = false;
  }
  // 絞り込みの対象外の行（フェーズ）を取り除き、その下の行を上へ詰める。レイアウト（layout.js）は作り直さず、
  // 元の座標（VIEWER_DATA と entry.jobBase）から y を写像して、ノード（modePos）・辺・行・列を置き換える。
  // 写像は区分線形: 対象外の行より下の点はその行の高さだけ上へ、対象外の行の中の点はその行の上端へ寄せる
  // （行をまたいで対象外の行を通る辺も途切れずにつながる）。絞り込みを解除すると元の座標に戻る。
  function applyJobFilterLayout(){
    var modeObj = VIEWER_DATA.modes.jobflow;
    if(!modeObj) return;
    var phaseSet = jobFilterPhaseSet();
    var hidden = phaseSet ? (modeObj.phases||[]).filter(function(p){ return !phaseSet.has(p.id); }) : [];
    function mapY(y){
      var shift = 0;
      for(var i=0;i<hidden.length;i++){
        var p = hidden[i];
        if(y >= p.y+p.h) shift += p.h;
        else if(y > p.y) shift += y-p.y;
      }
      return y-shift;
    }
    (modeObj.nodes||[]).forEach(function(n){
      var entry = registry.get(n.id);
      var mp = entry && entry.modePos.jobflow;
      if(!mp) return;
      if(!entry.jobBase) entry.jobBase = { y: mp.y };
      mp.y = mapY(entry.jobBase.y);
    });
    state.currentPhases = (modeObj.phases||[]).filter(function(p){ return !phaseSet || phaseSet.has(p.id); })
      .map(function(p){ return Object.assign({}, p, { y: mapY(p.y) }); });
    state.currentGroups = (modeObj.groups||[]).map(function(g){
      var y = mapY(g.y);
      return Object.assign({}, g, { y: y, h: mapY(g.y+g.h)-y });
    });
    state.currentEdges = prepareEdgesForMode('jobflow').map(function(e){
      if(!hidden.length) return e;
      return Object.assign({}, e, {
        route: e.route.map(function(pt){ return [pt[0], mapY(pt[1])]; }),
        labelAt: e.labelAt ? [e.labelAt[0], mapY(e.labelAt[1])] : e.labelAt
      });
    });
  }

  // id: batches[].id（'' で解除）。opts.noFit: 全体表示に寄せない（focusNode から呼ぶとき）
  function setJobFilter(id, opts){
    opts = opts || {};
    state.jobFilter = id || '';
    if(state.mode!=='jobflow') return;
    jobFilterSelectEl.value = state.jobFilter;
    var filterNodes = jobFilterNodeSet();
    if(filterNodes && state.selected && !filterNodes.has(state.selected)){
      state.selected = null; detailPanelEl.hidden = true; if(updatePanelCssVar) updatePanelCssVar();
    }
    // 行を詰め直し、ノードは新しい位置へそのまま移す（辺・行と同時に変わるので、ノードだけ動かすと途中でずれる）
    applyJobFilterLayout();
    if(state.nodeAnim){ state.nodeAnim = null; }
    (VIEWER_DATA.modes.jobflow.nodes||[]).forEach(function(n){
      var entry = registry.get(n.id), mp = entry && entry.modePos.jobflow;
      if(mp) entry.cur = { x:mp.x, y:mp.y, w:mp.w, h:mp.h, op:1 };
    });
    state.modeBounds = modeFitBox('jobflow', VIEWER_DATA.modes.jobflow).bbox;
    rebuildSearchIndex();
    rt.minimapBgDirty = true;
    if(!opts.noFit) fitCurrentMode(true);
    invalidate();
  }

  // ---------------------------------------------------------
  // 検索
  // ---------------------------------------------------------
  var searchIndex = [];
  function rebuildSearchIndex(){
    var filterNodes = jobFilterNodeSet();
    searchIndex = state.currentNodeIds.filter(function(id){ return !filterNodes || filterNodes.has(id); }).map(function(id){
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
  DV.stepAnim = stepAnim; DV.setMode = setMode; DV.fitCurrentMode = fitCurrentMode; DV.focusNode = focusNode; DV.fitGroup = fitGroup; DV.setDfdStep = setDfdStep; DV.toggleAutoplay = toggleAutoplay; DV.runSearch = runSearch; DV.nudgeViewForPanel = nudgeViewForPanel; DV.jobFilterNodeSet = jobFilterNodeSet; DV.jobFilterPhaseSet = jobFilterPhaseSet; DV.setJobFilter = setJobFilter;
})();
