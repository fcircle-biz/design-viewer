(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // 詳細パネルと画面プレビューモーダル。
  // --- import ---
  var KIND_LABEL_JA, escHtml, detailPanelEl, panelBodyEl, neighborToggleBtn, modalTitleEl, modalBodyEl, previewModalEl, modalScale100Btn, modalScaleFitBtn, registry, screensById, state, nodeLabel, focusNode, platformName, invalidate;
  DV.links.push(function(){
    KIND_LABEL_JA = DV.KIND_LABEL_JA; escHtml = DV.escHtml; detailPanelEl = DV.detailPanelEl; panelBodyEl = DV.panelBodyEl; neighborToggleBtn = DV.neighborToggleBtn; modalTitleEl = DV.modalTitleEl; modalBodyEl = DV.modalBodyEl; previewModalEl = DV.previewModalEl; modalScale100Btn = DV.modalScale100Btn; modalScaleFitBtn = DV.modalScaleFitBtn; registry = DV.registry; screensById = DV.screensById; state = DV.state; nodeLabel = DV.nodeLabel; focusNode = DV.focusNode; platformName = DV.platformName; invalidate = DV.invalidate;
  });
  // --- body ---
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
  function renderBizPanel(entry){
    var mp = entry.modePos[state.mode] || entry.modePos[Object.keys(entry.modePos)[0]];
    var n = (mp && mp.node) || {};
    var modeObj = VIEWER_DATA.modes[state.mode] || {};
    // v1: group.id はレーン id そのもの。v2: group.id はフェーズごとの複合 id（"PH1:L_STAFF"）
    // なので group.lane / group.phase で照合する（フェーズ無し入力の group.phase は "_all"）。
    var lane = (modeObj.groups||[]).filter(function(g){
      return g.lane!=null ? (g.lane===n.lane && (n.phase==null || g.phase===n.phase)) : g.id===n.lane;
    })[0];
    var phase = (modeObj.phases||[]).filter(function(p){ return p.id===n.phase; })[0];
    var html = '<div class="v-panel-kicker">'+escHtml(entry.id)+' ・ '+escHtml(KIND_LABEL_JA.biz||'業務ステップ')+'</div>'+
      '<div class="v-panel-title">'+escHtml(n.label||entry.id)+'</div>';
    var tags = [];
    if(lane) tags.push('<span class="v-tag">'+escHtml(lane.label)+'</span>');
    if(phase) tags.push('<span class="v-tag v-tag-slate">'+escHtml(phase.label)+'</span>');
    if(tags.length) html += '<div class="v-tag-row">'+tags.join('')+'</div>';
    if(n.sub){ html += section('補足', '<div class="v-section-p">'+escHtml(n.sub)+'</div>'); }
    if(n.screen){
      var scr = screensById.get(n.screen);
      html += section('関連画面', scr
        ? '<button class="v-open-screen-btn" type="button" data-id="'+escHtml(n.screen)+'">'+escHtml(n.screen)+' '+escHtml(scr.title||'')+' を開く</button>'
        : emptyHtml());
    }
    html += listSection('仕様', n.spec);
    html += listSection('補足情報', n.info);
    html += transitionsSection(entry.id, '前後の工程');
    panelBodyEl.innerHTML = html;
    attachPanelHandlers();
  }
  function renderPanel(){
    if(!state.selected){ detailPanelEl.hidden=true; return; }
    var entry = registry.get(state.selected);
    if(!entry){ detailPanelEl.hidden=true; return; }
    if(entry.kind==='screen') renderScreenPanel(entry);
    else if(entry.kind==='biz') renderBizPanel(entry);
    else renderNodePanel(entry);
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
  // --- body end ---
  // --- export ---
  DV.closePanel = closePanel; DV.selectNode = selectNode; DV.openScreenPreview = openScreenPreview; DV.setModalScale = setModalScale; DV.closeModal = closeModal;
})();
