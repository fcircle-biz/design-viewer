(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // 詳細パネルと画面プレビューモーダル。
  // --- import ---
  var KIND_LABEL_JA, escHtml, detailPanelEl, panelBodyEl, neighborToggleBtn, modalTitleEl, modalBodyEl, previewModalEl, modalScale100Btn, modalScaleFitBtn, registry, screensById, state, nodeLabel, focusNode, platformName, invalidate, nudgeViewForPanel;
  DV.links.push(function(){
    KIND_LABEL_JA = DV.KIND_LABEL_JA; escHtml = DV.escHtml; detailPanelEl = DV.detailPanelEl; panelBodyEl = DV.panelBodyEl; neighborToggleBtn = DV.neighborToggleBtn; modalTitleEl = DV.modalTitleEl; modalBodyEl = DV.modalBodyEl; previewModalEl = DV.previewModalEl; modalScale100Btn = DV.modalScale100Btn; modalScaleFitBtn = DV.modalScaleFitBtn; registry = DV.registry; screensById = DV.screensById; state = DV.state; nodeLabel = DV.nodeLabel; focusNode = DV.focusNode; platformName = DV.platformName; invalidate = DV.invalidate; nudgeViewForPanel = DV.nudgeViewForPanel;
  });
  // --- body ---
  // ---------------------------------------------------------
  // 詳細パネル：共通ヘルパー
  // ---------------------------------------------------------
  function closePanel(){
    state.selected = null;
    detailPanelEl.hidden = true;
    if(state.neighborOnly){ state.neighborOnly=false; neighborToggleBtn.classList.remove('v-active'); }
    updatePanelCssVar();
    invalidate();
  }
  function selectNode(id){
    if(!registry.has(id)){ console.warn('[viewer] selectNode: 未知のノード id: '+id); return; }
    state.selected = id;
    renderPanel();
    detailPanelEl.hidden = false;
    updatePanelCssVar();
    if(nudgeViewForPanel) nudgeViewForPanel();
    invalidate();
  }
  // セクション：見出し（色付きマーカー）＋中身。空なら省略してよい呼び出し元は
  // innerHtml が falsy のとき '' を返す関数（xxxSection）を使う。
  function section(title, innerHtml){ return '<div class="v-section"><div class="v-section-h">'+escHtml(title)+'</div>'+innerHtml+'</div>'; }
  function emptyHtml(){ return '<div class="v-empty">なし</div>'; }

  // "出典: 内容" / "出典：内容" を最初の区切りで分割する（見つからなければ内容のみ）。
  // 転記ルール（spec-refs-transcribe）に沿い、出典部分をバッジ表示するための分割。
  function splitBySource(s){
    s = String(s);
    var i1 = s.indexOf(': ');
    var i2 = s.indexOf('：');
    var idx = -1, delimLen = 0;
    if(i1>=0 && (i2<0 || i1<=i2)){ idx = i1; delimLen = 2; }
    else if(i2>=0){ idx = i2; delimLen = 1; }
    if(idx<0) return { source:null, content:s };
    var source = s.slice(0, idx).trim();
    var content = s.slice(idx+delimLen).trim();
    if(!source) return { source:null, content:s };
    return { source:source, content:content };
  }
  // 出典の種類（カテゴリ）とバッジに出す短いラベル。ラベル部分を出典文字列の
  // 先頭から取り除いた残り（"F-09 CSV 取込・出力" や "（CSV 取込）" など）は
  // detail としてバッジの下に小さく添える。
  var SPEC_CATS = [
    { key:'func', label:'機能一覧' },
    { key:'screen', label:'画面一覧' },
    { key:'rule', label:'業務ルール' },
    { key:'nonfunc', label:'非機能要件' },
    { key:'dataflow', label:'データフロー' },
    { key:'transition', label:'画面遷移' }
  ];
  function specSourceInfo(source){
    for(var i=0;i<SPEC_CATS.length;i++){
      var c = SPEC_CATS[i];
      if(source.indexOf(c.label)===0){
        return { key:c.key, badge:c.label, detail: source.slice(c.label.length).trim() };
      }
    }
    // 未知の出典：カテゴリ化できないのでバッジにそのまま出典全体を出す。
    return { key:'other', badge:source, detail:'' };
  }
  // 仕様（spec）：1 要素 1 項目「出典: 内容」を「出典 | 内容」の 2 列テーブルにする。
  // 出典はカテゴリ名だけをバッジにし、残りはバッジ下に小さく表示。連続して
  // 同じ出典が続く行は rowspan でまとめて重複を減らす。
  function specSection(arr, heading){
    if(!arr || !arr.length) return '';
    var parsed = arr.map(function(item){
      var parts = splitBySource(item);
      if(!parts.source) return { content: parts.content };
      var info = specSourceInfo(parts.source);
      return { source:parts.source, catKey:info.key, badge:info.badge, detail:info.detail, content:parts.content };
    });
    var rowsHtml = '', i = 0;
    while(i<parsed.length){
      var cur = parsed[i];
      if(!cur.source){
        rowsHtml += '<tr><td class="v-spec-content" colspan="2">'+escHtml(cur.content)+'</td></tr>';
        i++; continue;
      }
      var span = 1;
      while(i+span<parsed.length && parsed[i+span].source===cur.source) span++;
      var srcHtml = '<span class="v-badge v-src-'+cur.catKey+'">'+escHtml(cur.badge)+'</span>'+
        (cur.detail ? '<div class="v-spec-detail">'+escHtml(cur.detail)+'</div>' : '');
      rowsHtml += '<tr><td class="v-spec-src"'+(span>1?' rowspan="'+span+'"':'')+'>'+srcHtml+'</td>'+
        '<td class="v-spec-content">'+escHtml(cur.content)+'</td></tr>';
      for(var j=1;j<span;j++){
        rowsHtml += '<tr><td class="v-spec-content">'+escHtml(parsed[i+j].content)+'</td></tr>';
      }
      i += span;
    }
    return section(heading||'仕様', '<div class="v-table-wrap"><table class="v-table v-spec-table"><tbody>'+rowsHtml+'</tbody></table></div>');
  }
  // info（配列）：「キー: 値」形式が含まれればキー値テーブル、なければ箇条書き。
  // 文字列で来た場合はそのまま段落表示（従来互換）。
  function splitInfoKv(s){
    s = String(s);
    var i1 = s.indexOf(': ');
    var i2 = s.indexOf('：');
    var idx = -1, delimLen = 0;
    if(i1>=0 && (i2<0 || i1<=i2)){ idx = i1; delimLen = 2; }
    else if(i2>=0){ idx = i2; delimLen = 1; }
    if(idx<0) return { key:null, val:s };
    var key = s.slice(0, idx).trim();
    if(!key || key.length>20) return { key:null, val:s };
    return { key:key, val: s.slice(idx+delimLen).trim() };
  }
  function infoBodyHtml(info){
    if(info==null) return '';
    if(typeof info === 'string') return info ? '<div class="v-section-p">'+escHtml(info)+'</div>' : '';
    if(!Array.isArray(info) || !info.length) return '';
    var anyKv = info.some(function(x){ return splitInfoKv(x).key; });
    if(anyKv){
      var rows = info.map(function(x){
        var kv = splitInfoKv(x);
        if(kv.key) return '<tr><td class="v-info-key">'+escHtml(kv.key)+'</td><td class="v-info-val">'+escHtml(kv.val)+'</td></tr>';
        return '<tr><td class="v-info-val" colspan="2">'+escHtml(kv.val)+'</td></tr>';
      }).join('');
      return '<div class="v-table-wrap"><table class="v-table v-info-table"><tbody>'+rows+'</tbody></table></div>';
    }
    return '<ul>'+info.map(function(x){ return '<li>'+escHtml(x)+'</li>'; }).join('')+'</ul>';
  }
  // 主な操作：番号バッジ付きのステップ表示。
  function opsSection(arr){
    if(!arr || !arr.length) return '';
    var rows = arr.map(function(x,i){
      return '<li class="v-op-item"><span class="v-op-num">'+(i+1)+'</span><span class="v-op-text">'+escHtml(x)+'</span></li>';
    }).join('');
    return section('主な操作', '<ol class="v-op-list">'+rows+'</ol>');
  }
  // データアクセス：読み取り／書き込みするテーブルを 1 つの表にまとめる。
  function dataAccessSection(reads, writes){
    reads = reads||[]; writes = writes||[];
    if(!reads.length && !writes.length) return '';
    var seen = {}, names = [];
    reads.concat(writes).forEach(function(n){ if(!seen[n]){ seen[n]=true; names.push(n); } });
    var rows = names.map(function(n){
      var r = reads.indexOf(n)>=0, w = writes.indexOf(n)>=0;
      return '<tr><td>'+escHtml(n)+'</td>'+
        '<td>'+(r?'<span class="v-badge v-badge-r">R</span>':'<span class="v-cell-dash">−</span>')+'</td>'+
        '<td>'+(w?'<span class="v-badge v-badge-w">W</span>':'<span class="v-cell-dash">−</span>')+'</td></tr>';
    }).join('');
    return section('データアクセス', '<div class="v-table-wrap"><table class="v-table v-data-table">'+
      '<thead><tr><th>テーブル</th><th>読み取り</th><th>書き込み</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>');
  }
  // 注意：「未確定」を含む項目は注意ボックス＋バッジで強調する。
  function notesSection(arr){
    if(!arr || !arr.length) return '';
    var rows = arr.map(function(x){
      if(String(x).indexOf('未確定')>=0){
        return '<div class="v-note-item v-note-warn"><span class="v-badge v-badge-todo">未確定</span><span>'+escHtml(x)+'</span></div>';
      }
      return '<div class="v-note-item"><span class="v-note-dot"></span><span>'+escHtml(x)+'</span></div>';
    }).join('');
    return section('注意', '<div class="v-note-list">'+rows+'</div>');
  }
  // 関連タスク：チップ表示。
  function tasksSection(arr){
    if(!arr || !arr.length) return '';
    var chips = arr.map(function(x){ return '<span class="v-chip">'+escHtml(x)+'</span>'; }).join('');
    return section('関連タスク', '<div class="v-chip-row">'+chips+'</div>');
  }
  // ER の列：キー｜列名｜型｜備考のテーブル（PK=金・FK=青バッジ）。
  function fieldsSection(fields){
    if(!fields || !fields.length) return '';
    var rows = fields.map(function(f){
      var keyBadge = '';
      if(f.key==='PK') keyBadge = '<span class="v-badge v-badge-pk">PK</span>';
      else if(f.key==='FK') keyBadge = '<span class="v-badge v-badge-fk">FK</span>';
      else if(f.key) keyBadge = '<span class="v-badge v-badge-key">'+escHtml(f.key)+'</span>';
      return '<tr><td>'+keyBadge+'</td><td>'+escHtml(f.name)+'</td><td>'+escHtml(f.type||'')+'</td><td>'+escHtml(f.note||'')+'</td></tr>';
    }).join('');
    return section('列', '<div class="v-table-wrap"><table class="v-table v-field-table">'+
      '<thead><tr><th>キー</th><th>列名</th><th>型</th><th>備考</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>');
  }
  // 遷移：方向（→出／←入）｜相手ノード｜ラベルの一覧。クリックでフォーカスする。
  function transitionsSection(id, heading){
    var rows = state.currentEdges.filter(function(e){ return e.from===id || e.to===id; }).map(function(e){
      var otherId = e.from===id ? e.to : e.from;
      var isOut = e.from===id;
      var other = registry.get(otherId);
      var label = other ? nodeLabel(other) : (otherId+'（未定義）');
      return '<div class="v-trans-item '+(isOut?'v-dir-out':'v-dir-in')+'" data-target="'+escHtml(otherId)+'">'+
        '<span class="v-trans-dir">'+(isOut?'→ 出':'← 入')+'</span>'+
        '<span class="v-trans-node">'+escHtml(label)+'</span>'+
        (e.label? '<span class="v-trans-label">'+escHtml(e.label)+'</span>' : '<span class="v-trans-label v-trans-label-empty">—</span>')+
        '</div>';
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
  // 実装状況（screens[].status）のタグ。ラベルは layout が表に付けた statuses（無ければ既定）から引く
  var STATUS_TAG_DEFAULT = { done:{label:'実装済', tone:'green'}, wip:{label:'実装中', tone:'blue'}, designed:{label:'設計済・未実装', tone:'amber'}, planned:{label:'未着手', tone:'slate'} };
  function statusTagHtml(status){
    if(!status) return '';
    var t = ((VIEWER_DATA.modes.gallery && VIEWER_DATA.modes.gallery.table && VIEWER_DATA.modes.gallery.table.statuses) || STATUS_TAG_DEFAULT)[status];
    if(!t) return '';
    return '<span class="v-tag v-tag-status v-tone-'+escHtml(t.tone)+'">'+escHtml(t.label)+'</span>';
  }
  function renderScreenPanel(entry){
    var s = screensById.get(entry.id) || {};
    var html = '<div class="v-panel-kicker">'+escHtml(entry.id)+' ・ 画面</div>'+
      '<div class="v-panel-title">'+escHtml(s.title)+'</div>'+
      '<div class="v-tag-row"><span class="v-tag">'+escHtml(platformName(s, 'Power Apps'))+'</span>'+
      '<span class="v-tag v-tag-slate">'+escHtml(s.role)+'</span>'+statusTagHtml(s.status)+'</div>'+
      '<button class="v-open-screen-btn" type="button" data-id="'+escHtml(entry.id)+'">画面を開く（等倍プレビュー）</button>';
    // 概要（目的）：アクセント色の左ボーダーで強調する。
    html += section('概要', '<div class="v-callout">'+escHtml(s.purpose||'なし')+'</div>');
    html += opsSection(s.ops);
    html += dataAccessSection(s.reads, s.writes);
    html += tasksSection(s.tasks);
    html += specSection(s.spec, '仕様');
    html += notesSection(s.notes);
    html += transitionsSection(entry.id, 'この画面から／への遷移');
    panelBodyEl.innerHTML = html;
    attachPanelHandlers();
  }
  function renderNodePanel(entry){
    var mp = entry.modePos[state.mode] || entry.modePos[Object.keys(entry.modePos)[0]];
    var n = (mp && mp.node) || {};
    // dfd の arrange: "steps" はノードをステップごとに複製し id が「元の id@ステップ」になるので、code / baseId を見せる
    var html = '<div class="v-panel-kicker">'+escHtml(n.code||n.baseId||entry.id)+' ・ '+escHtml(KIND_LABEL_JA[entry.kind]||entry.kind)+'</div>'+
      '<div class="v-panel-title">'+escHtml(n.label||entry.id)+'</div>';
    if(n.sub){ html += '<div class="v-tag-row"><span class="v-tag v-tag-slate">'+escHtml(n.sub)+'</span></div>'; }
    var descHtml = infoBodyHtml(n.info);
    html += section('説明', descHtml || emptyHtml());
    if(n.spec && n.spec.length) html += specSection(n.spec, '仕様');
    if(entry.kind==='er') html += fieldsSection(n.fields);
    html += transitionsSection(entry.id, '関連する辺');
    panelBodyEl.innerHTML = html;
    attachPanelHandlers();
  }
  function renderBizPanel(entry){
    var mp = entry.modePos[state.mode] || entry.modePos[Object.keys(entry.modePos)[0]];
    var n = (mp && mp.node) || {};
    var modeObj = VIEWER_DATA.modes[state.mode] || {};
    // group はアクターの列（group.lane がレーン id）
    var lane = (modeObj.groups||[]).filter(function(g){ return g.lane===n.lane; })[0];
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
    html += specSection(n.spec, '仕様');
    var infoHtml = infoBodyHtml(n.info);
    if(infoHtml) html += section('補足情報', infoHtml);
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
  // パネル幅のドラッグ調整（ハンドル・localStorage 保存・レスポンシブ）
  // ---------------------------------------------------------
  var PANEL_W_DEFAULT = 560, PANEL_W_MIN = 360, PANEL_W_STORAGE_KEY = 'dv.detailPanelWidth';
  var PANEL_MOBILE_BP = 720;
  function panelIsMobile(){ return window.innerWidth<=PANEL_MOBILE_BP; }
  function panelMaxWidth(){ return Math.min(1100, window.innerWidth*0.9); }
  function clampPanelWidth(w){ return Math.max(PANEL_W_MIN, Math.min(panelMaxWidth(), w)); }
  function loadPanelWidth(){
    try{
      var v = localStorage.getItem(PANEL_W_STORAGE_KEY);
      var n = v!=null ? parseFloat(v) : NaN;
      if(!isNaN(n) && n>0) return clampPanelWidth(n);
    }catch(err){}
    return PANEL_W_DEFAULT;
  }
  function savePanelWidth(w){
    try{ localStorage.setItem(PANEL_W_STORAGE_KEY, String(Math.round(w))); }catch(err){}
  }
  function applyPanelWidth(w){ detailPanelEl.style.width = w+'px'; }
  // 現在パネルが占めている幅（非表示・モバイル幅では 0）。ツールバー・検索の
  // 中央寄せやミニマップ・ステップカードの位置調整、全体表示のフィット計算で使う。
  function currentPanelWidth(){
    if(detailPanelEl.hidden || panelIsMobile()) return 0;
    return detailPanelEl.getBoundingClientRect().width;
  }
  // body に --v-panel-w（可視領域の計算に使う CSS 変数）と v-panel-open クラスを
  // 反映する。ドラッグ中も含めて幅が変わるたびに呼び出す。
  function updatePanelCssVar(){
    var w = currentPanelWidth();
    if(w>0){
      document.body.classList.add('v-panel-open');
      document.body.style.setProperty('--v-panel-w', w+'px');
    } else {
      document.body.classList.remove('v-panel-open');
      document.body.style.removeProperty('--v-panel-w');
    }
    updateToolbarLayout();
  }
  // パネル表示中、可視領域（キャンバス左端〜パネル左端）が狭いと、中央寄せの
  // ツールバーが左下の凡例カードや右下のミニマップと重なる（1600px 幅・既定パネル幅
  // 560px 程度で発生）。実測して重なる場合だけ body.v-panel-narrow を立て、CSS 側で
  // ツールバーを凡例の右〜パネル左端の範囲に収めて折り返し、ミニマップは隠す
  // （固定の幅しきい値を決め打ちにせず、実際の重なりで判定する）。
  function updateToolbarLayout(){
    var toolbarEl = document.getElementById('toolbar');
    var legendEl = document.getElementById('legendCard');
    var minimapEl = document.getElementById('minimapCard');
    if(!toolbarEl) return;
    document.body.classList.remove('v-panel-narrow'); // 既定（中央寄せ）に戻してから実測する
    if(panelIsMobile() || currentPanelWidth()<=0) return; // モバイル・パネル非表示は対象外（既存レイアウトのまま）
    // #toolbar / #minimapCard には --v-panel-w の変化にあわせた transition (left/right) が
    // 付いている。パネルを開いた直後にそのまま measure すると、アニメ開始前の古い位置を
    // 読んでしまい判定を誤る。measure の間だけ transition を止めて最終位置を同期的に読む
    // （このタスク内では再描画が入らないため、元に戻しても見た目のアニメは損なわれない）。
    toolbarEl.style.transition = 'none';
    if(minimapEl) minimapEl.style.transition = 'none';
    void toolbarEl.offsetWidth; // reflow を強制
    var margin = 8;
    var tb = toolbarEl.getBoundingClientRect();
    var overlaps = false;
    if(legendEl && !legendEl.hidden){
      var lg = legendEl.getBoundingClientRect();
      if(tb.left < lg.right+margin && tb.top < lg.bottom+margin && tb.bottom > lg.top-margin) overlaps = true;
    }
    if(!overlaps && minimapEl && !minimapEl.hidden){
      var mm = minimapEl.getBoundingClientRect();
      if(tb.right > mm.left-margin && tb.top < mm.bottom+margin && tb.bottom > mm.top-margin) overlaps = true;
    }
    if(overlaps) document.body.classList.add('v-panel-narrow');
    toolbarEl.style.transition = '';
    if(minimapEl) minimapEl.style.transition = '';
  }
  function initPanelResize(){
    var handleEl = document.getElementById('detailResizeHandle');
    if(!handleEl) return;
    function syncForViewport(){
      if(panelIsMobile()){ detailPanelEl.style.width = ''; }
      else { applyPanelWidth(clampPanelWidth(parseFloat(detailPanelEl.style.width) || loadPanelWidth())); }
      updatePanelCssVar();
    }
    syncForViewport();
    window.addEventListener('resize', syncForViewport);

    var drag = { active:false, startX:0, startWidth:0 };
    handleEl.addEventListener('pointerdown', function(e){
      if(panelIsMobile()) return;
      if(e.pointerType==='mouse' && e.button!==0) return;
      e.preventDefault();
      drag.active = true;
      drag.startX = e.clientX;
      drag.startWidth = detailPanelEl.getBoundingClientRect().width;
      handleEl.classList.add('v-resize-active');
      document.body.classList.add('v-panel-resizing');
      try{ handleEl.setPointerCapture(e.pointerId); }catch(err){}
    });
    handleEl.addEventListener('pointermove', function(e){
      if(!drag.active) return;
      // ハンドルはパネル左端にあり、パネルは右端固定。左へドラッグ（dx<0）すると幅が増える。
      var dx = e.clientX - drag.startX;
      applyPanelWidth(clampPanelWidth(drag.startWidth - dx));
      updatePanelCssVar();
    });
    function endDrag(e){
      if(!drag.active) return;
      drag.active = false;
      handleEl.classList.remove('v-resize-active');
      document.body.classList.remove('v-panel-resizing');
      try{ handleEl.releasePointerCapture(e.pointerId); }catch(err){}
      savePanelWidth(parseFloat(detailPanelEl.style.width) || PANEL_W_DEFAULT);
      updatePanelCssVar();
      if(nudgeViewForPanel) nudgeViewForPanel();
    }
    handleEl.addEventListener('pointerup', endDrag);
    handleEl.addEventListener('pointercancel', endDrag);
    handleEl.addEventListener('dblclick', function(){
      if(panelIsMobile()) return;
      applyPanelWidth(PANEL_W_DEFAULT);
      savePanelWidth(PANEL_W_DEFAULT);
      updatePanelCssVar();
      if(nudgeViewForPanel) nudgeViewForPanel();
    });
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
  DV.updateToolbarLayout = updateToolbarLayout; DV.closePanel = closePanel; DV.selectNode = selectNode; DV.openScreenPreview = openScreenPreview; DV.setModalScale = setModalScale; DV.closeModal = closeModal; DV.initPanelResize = initPanelResize; DV.currentPanelWidth = currentPanelWidth; DV.updatePanelCssVar = updatePanelCssVar;
})();
