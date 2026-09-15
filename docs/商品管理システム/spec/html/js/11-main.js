(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // MODE_KEYS・メタ適用・初期化 (init)・起動。
  // --- import ---
  var MODE_LABEL_JA, titleTextEl, subtitleTextEl, statusNoteEl, modeSegEl, minimapCardEl, buildRegistry, resizeStage, setMode, invalidate, attachListeners;
  DV.links.push(function(){
    MODE_LABEL_JA = DV.MODE_LABEL_JA; titleTextEl = DV.titleTextEl; subtitleTextEl = DV.subtitleTextEl; statusNoteEl = DV.statusNoteEl; modeSegEl = DV.modeSegEl; minimapCardEl = DV.minimapCardEl; buildRegistry = DV.buildRegistry; resizeStage = DV.resizeStage; setMode = DV.setMode; invalidate = DV.invalidate; attachListeners = DV.attachListeners;
  });
  // --- body ---
  var MODE_KEYS = ['concept','biz','gallery','flow','er','dfd'];
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
  // モード切替ボタンの並び・表示名を model.json に合わせる。
  // meta.modeOrder（任意）に書いたモードをその順で先頭に置き、残りは既定順で後ろに続ける。
  // ボタン名は modes.<key>.label（無ければ既定名）。データの無いモードのボタンは隠す。
  // 数字キー 1〜n は、表示されているボタンの並び順に対応させる。
  function applyModeOrder(){
    var meta = VIEWER_DATA.meta || {};
    var order = [];
    (Array.isArray(meta.modeOrder) ? meta.modeOrder : []).forEach(function(k){
      if(MODE_KEYS.indexOf(k)>=0 && order.indexOf(k)<0) order.push(k);
    });
    MODE_KEYS.forEach(function(k){ if(order.indexOf(k)<0) order.push(k); });
    MODE_KEYS = order;
    order.forEach(function(k){
      var btn = modeSegEl.querySelector('.v-seg-btn[data-mode="'+k+'"]');
      if(!btn) return;
      var modeObj = VIEWER_DATA.modes[k];
      btn.textContent = (modeObj && modeObj.label) || MODE_LABEL_JA[k];
      btn.hidden = !modeObj;
      modeSegEl.appendChild(btn);
    });
  }
  function visibleModeKeys(){
    return MODE_KEYS.filter(function(k){ return VIEWER_DATA.modes[k]; });
  }
  function renderFatalError(msg){
    if(titleTextEl) titleTextEl.textContent = '読み込みエラー';
    if(subtitleTextEl) subtitleTextEl.textContent = msg;
  }

  function init(){
    DV.cacheDom();                                                        // [split]
    for(var li=0; li<DV.links.length; li++){ DV.links[li](); }            // [split]
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
    applyModeOrder();

    var hashMode = (location.hash||'').replace('#','');
    var initMode = MODE_KEYS.indexOf(hashMode)>=0 && VIEWER_DATA.modes[hashMode] ? hashMode : visibleModeKeys()[0];
    if(!initMode){ renderFatalError('表示できるモードがありません。'); return; }
    setMode(initMode, { noAnim:true });
    invalidate();
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
  // --- body end ---
  // --- export ---
  DV.visibleModeKeys = visibleModeKeys;
})();
