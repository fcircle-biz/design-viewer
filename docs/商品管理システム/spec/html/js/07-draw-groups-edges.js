(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // グループ・スイムレーン・フェーズ・辺の描画。
  // --- import ---
  var EDGE_COLOR, EDGE_DASH, EDGE_ALPHA, EDGE_LABEL_MIN_K, clamp, esc, roundRectPath, measureCached, truncateText, wrapCharLines, registry, state, worldToScreen, worldRectToScreen, topRoundRectPath, rectIntersects, FONT_STACK, scaledFont, measureScaled;
  DV.links.push(function(){
    EDGE_COLOR = DV.EDGE_COLOR; EDGE_DASH = DV.EDGE_DASH; EDGE_ALPHA = DV.EDGE_ALPHA; EDGE_LABEL_MIN_K = DV.EDGE_LABEL_MIN_K; clamp = DV.clamp; esc = DV.esc; roundRectPath = DV.roundRectPath; measureCached = DV.measureCached; truncateText = DV.truncateText; wrapCharLines = DV.wrapCharLines; registry = DV.registry; state = DV.state; worldToScreen = DV.worldToScreen; worldRectToScreen = DV.worldRectToScreen; topRoundRectPath = DV.topRoundRectPath; rectIntersects = DV.rectIntersects; FONT_STACK = DV.FONT_STACK; scaledFont = DV.scaledFont; measureScaled = DV.measureScaled;
  });
  // --- body ---
  function drawGroups(ctx, cull){
    rt.groupLabelHitRects = [];
    // フェーズのブロックカードはレーンの下地（背景）なので先に描く
    drawPhases(ctx, cull);
    var groups = state.currentGroups || [];
    ctx.save();
    for(var i=0;i<groups.length;i++){
      var g = groups[i];
      var r = { x:g.x, y:g.y, w:g.w, h:g.h };
      if(!rectIntersects(r, cull)) continue;
      if(g.style==='swimlane') drawSwimlaneGroup(ctx, g, r);
      else drawDashedGroup(ctx, g, r);
    }
    ctx.restore();
  }

  // 既存の破線グループ枠（画面遷移・画面イメージのグルーピング用）
  function drawDashedGroup(ctx, g, r){
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
      var padX=10, th=20;
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
      rt.groupLabelHitRects.push({ x:lx, y:ly, w:tw, h:th, group:g });
    }
  }

  // フェーズ・レーンの見出し文字サイズ（画面 px）。ワールド基準 × 倍率だが、
  // 縮小しても 11px を下回らず（消さない）、拡大しても 16px で頭打ちにする。
  // 見出し欄の幅に収まらない分は truncateText が省略記号で切る。
  function headerFontPx(worldBase){ return clamp(worldBase*state.view.k, 11, 16); }

  // スイムレーン（biz モード）。帯を交互の淡色で塗り、境界に実線。
  // 左端の見出し欄（headerW）は少し濃い地に label（太字）と sub（小さく灰色）。
  function drawSwimlaneGroup(ctx, g, r){
    var sr = worldRectToScreen(r);
    var idx = g.index!=null ? g.index : 0;
    ctx.fillStyle = idx%2===0 ? '#F7F8FB' : '#EFF2F7';
    ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
    ctx.strokeStyle = '#D8DEE8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sr.x, Math.round(sr.y)+0.5); ctx.lineTo(sr.x+sr.w, Math.round(sr.y)+0.5);
    ctx.moveTo(sr.x, Math.round(sr.y+sr.h)+0.5); ctx.lineTo(sr.x+sr.w, Math.round(sr.y+sr.h)+0.5);
    ctx.stroke();

    var headerW = (g.headerW||150)*state.view.k;
    ctx.fillStyle = '#E7EAF1';
    ctx.fillRect(sr.x, sr.y, headerW, sr.h);
    ctx.strokeStyle = '#C7D0DC';
    ctx.beginPath();
    ctx.moveTo(Math.round(sr.x+headerW)+0.5, sr.y); ctx.lineTo(Math.round(sr.x+headerW)+0.5, sr.y+sr.h);
    ctx.stroke();

    var labelPx = headerFontPx(15), subPx = headerFontPx(11), gap = 4*state.view.k;
    var padX = 14;
    var maxTextW = Math.max(4, headerW-padX*2);
    ctx.font = '700 '+labelPx.toFixed(2)+'px '+FONT_STACK;
    // 見出し欄の幅に label が収まらない場合は 1 行で省略せず 2 行に折り返す
    // （読める字数を確保するため）。sub はそれでも空きがあるときだけ下に添える。
    var rawLabel = g.label||'';
    var lines = measureCached(ctx, esc(rawLabel), ctx.font) <= maxTextW
      ? [esc(rawLabel)]
      : wrapCharLines(ctx, rawLabel, ctx.font, maxTextW, 2);
    var lineH = labelPx*1.15;
    var labelBlockH = lines.length*lineH;
    var availH = Math.max(0, sr.h-16);
    var showSub = !!g.sub && (labelBlockH+gap+subPx) <= availH;
    var blockH = labelBlockH + (showSub ? gap+subPx : 0);
    var top = sr.y + sr.h/2 - blockH/2;
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillStyle = '#1A2029';
    for(var li=0; li<lines.length; li++){
      ctx.fillText(lines[li], sr.x+padX, top+li*lineH);
    }
    if(showSub){
      ctx.font = '400 '+subPx.toFixed(2)+'px '+FONT_STACK;
      ctx.fillStyle = '#8A93A3';
      ctx.fillText(truncateText(ctx, g.sub, ctx.font, maxTextW), sr.x+padX, top+labelBlockH+gap);
    }
    ctx.textBaseline = 'alphabetic';
    rt.groupLabelHitRects.push({ x:sr.x, y:sr.y, w:headerW, h:sr.h, group:g });
  }

  // フェーズのブロックカード（biz モード v2。phases が無ければ何もしない）。
  // 各 phases[].block を白地半透明・角丸のカードとして描き、その上端に見出し帯を重ねる。
  // レーンはこのカードの内側に別途 drawSwimlaneGroup で描かれる。
  var PHASE_CARD_RADIUS = 14;
  function drawPhases(ctx, cull){
    var phases = state.currentPhases || [];
    if(!phases.length) return;
    ctx.save();
    for(var i=0;i<phases.length;i++){
      var ph = phases[i];
      var block = ph.block || { x:ph.x, y:ph.y, w:ph.w, h:ph.h };
      if(!rectIntersects(block, cull)) continue;
      var sb = worldRectToScreen(block);
      roundRectPath(ctx, sb.x, sb.y, sb.w, sb.h, PHASE_CARD_RADIUS);
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#D5DDE7';
      ctx.stroke();

      if(ph.h>0){
        var sr = worldRectToScreen({ x:ph.x, y:ph.y, w:ph.w, h:ph.h });
        topRoundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, PHASE_CARD_RADIUS);
        ctx.fillStyle = '#F1F3F7';
        ctx.fill();
        if(ph.label){
          var labelPx = headerFontPx(14);
          ctx.font = '700 '+labelPx.toFixed(2)+'px '+FONT_STACK;
          ctx.fillStyle = '#5B6472';
          ctx.textAlign='left'; ctx.textBaseline='middle';
          ctx.fillText(truncateText(ctx, ph.label, ctx.font, Math.max(4,sr.w-16)), sr.x+8, sr.y+sr.h/2);
          ctx.textBaseline='alphabetic';
        }
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
        // 多重度ラベルは接続点（テーブルの枠）にそのまま置くと枠に食い込んで欠けるため、
        // 辺の向きに沿ってテーブルから離れる方向へ少し逃がして描く（drawMultLabel 側で
        // ラベル幅に応じたギャップを取るので、テーブルとは重ならない）。
        drawMultLabel(ctx, pts[0], unitDir(pts[0], pts[1]), e.fromLabel, opacity);
        drawMultLabel(ctx, pts[pts.length-1], unitDir(pts[pts.length-1], pts[pts.length-2]), e.toLabel, opacity);
      }
    }
  }
  function unitDir(from, to){
    var dx = to.x-from.x, dy = to.y-from.y, len = Math.hypot(dx,dy)||1;
    return { x:dx/len, y:dy/len };
  }
  // p: テーブルの枠上にある接続点。dir: そこからテーブルの外へ向かう単位ベクトル。
  // ラベルの近い端が p から ER_MULT_LABEL_GAP だけ離れるように中心を置く（テーブルの枠と重ならない）。
  var ER_MULT_LABEL_GAP = 6;
  function drawMultLabel(ctx, p, dir, text, opacity){
    if(!text) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = '800 10.5px '+FONT_STACK;
    var w = measureCached(ctx,text,ctx.font)+6;
    var halfW = w/2;
    var cx = p.x + dir.x*(ER_MULT_LABEL_GAP+halfW);
    var cy = p.y + dir.y*(ER_MULT_LABEL_GAP+halfW);
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx-halfW, cy-8, w, 14);
    ctx.fillStyle = '#5B6472';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(text, cx, cy-1);
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
  // --- body end ---
  // --- export ---
  DV.drawGroups = drawGroups; DV.drawEdges = drawEdges;
})();
