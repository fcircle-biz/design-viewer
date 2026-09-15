(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // ヒットテスト・パン／ズーム・イベント登録。
  // --- import ---
  var MIN_K, MAX_K, clamp, stageEl, minimapEl, searchInputEl, searchResultsEl, toggleListEl, stepListEl, stepPlayEl, closePanelBtn, zoomPctEl, modeSegEl, zoomOutBtn, zoomInBtn, zoomFitBtn, neighborToggleBtn, modalCloseBtn, previewModalEl, modalScale100Btn, modalBodyEl, modalScaleFitBtn, registry, state, resizeStage, worldRectToScreen, setMode, fitCurrentMode, focusNode, fitGroup, setDfdStep, toggleAutoplay, runSearch, minimapToWorld, panToWorldCenter, visibleNodeIdSet, invalidate, onViewChanged, closePanel, selectNode, openScreenPreview, setModalScale, closeModal, visibleModeKeys;
  DV.links.push(function(){
    MIN_K = DV.MIN_K; MAX_K = DV.MAX_K; clamp = DV.clamp; stageEl = DV.stageEl; minimapEl = DV.minimapEl; searchInputEl = DV.searchInputEl; searchResultsEl = DV.searchResultsEl; toggleListEl = DV.toggleListEl; stepListEl = DV.stepListEl; stepPlayEl = DV.stepPlayEl; closePanelBtn = DV.closePanelBtn; zoomPctEl = DV.zoomPctEl; modeSegEl = DV.modeSegEl; zoomOutBtn = DV.zoomOutBtn; zoomInBtn = DV.zoomInBtn; zoomFitBtn = DV.zoomFitBtn; neighborToggleBtn = DV.neighborToggleBtn; modalCloseBtn = DV.modalCloseBtn; previewModalEl = DV.previewModalEl; modalScale100Btn = DV.modalScale100Btn; modalBodyEl = DV.modalBodyEl; modalScaleFitBtn = DV.modalScaleFitBtn; registry = DV.registry; state = DV.state; resizeStage = DV.resizeStage; worldRectToScreen = DV.worldRectToScreen; setMode = DV.setMode; fitCurrentMode = DV.fitCurrentMode; focusNode = DV.focusNode; fitGroup = DV.fitGroup; setDfdStep = DV.setDfdStep; toggleAutoplay = DV.toggleAutoplay; runSearch = DV.runSearch; minimapToWorld = DV.minimapToWorld; panToWorldCenter = DV.panToWorldCenter; visibleNodeIdSet = DV.visibleNodeIdSet; invalidate = DV.invalidate; onViewChanged = DV.onViewChanged; closePanel = DV.closePanel; selectNode = DV.selectNode; openScreenPreview = DV.openScreenPreview; setModalScale = DV.setModalScale; closeModal = DV.closeModal; visibleModeKeys = DV.visibleModeKeys;
  });
  // --- body ---
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
    for(var i=0;i<rt.groupLabelHitRects.length;i++){
      var r = rt.groupLabelHitRects[i];
      if(sx>=r.x && sx<=r.x+r.w && sy>=r.y && sy<=r.y+r.h) return r.group;
    }
    return null;
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
  function zoomStep(dir){ zoomAt(rt.cssW/2, rt.cssH/2, dir>0?1.2:1/1.2); }
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
      rt.minimapBgDirty = true;
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
      if(e.key>='1' && e.key<='9'){ var mk = visibleModeKeys()[Number(e.key)-1]; if(mk) setMode(mk); return; }
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
  // --- body end ---
  // --- export ---
  DV.updateSegActive = updateSegActive; DV.attachListeners = attachListeners;
})();
