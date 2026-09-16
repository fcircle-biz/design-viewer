(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // グループ・構成図の枠・スイムレーン（アクターの列・フェーズの行・見出し）・辺の描画。
  // --- import ---
  var EDGE_COLOR, EDGE_DASH, EDGE_ALPHA, EDGE_LABEL_MIN_K, clamp, roundRectPath, measureCached, truncateText, wrapCharLines, registry, state, worldToScreen, worldRectToScreen, rectIntersects, FONT_STACK, scaledFont, measureScaled, getIconPath;
  DV.links.push(function(){
    EDGE_COLOR = DV.EDGE_COLOR; EDGE_DASH = DV.EDGE_DASH; EDGE_ALPHA = DV.EDGE_ALPHA; EDGE_LABEL_MIN_K = DV.EDGE_LABEL_MIN_K; clamp = DV.clamp; roundRectPath = DV.roundRectPath; measureCached = DV.measureCached; truncateText = DV.truncateText; wrapCharLines = DV.wrapCharLines; registry = DV.registry; state = DV.state; worldToScreen = DV.worldToScreen; worldRectToScreen = DV.worldRectToScreen; rectIntersects = DV.rectIntersects; FONT_STACK = DV.FONT_STACK; scaledFont = DV.scaledFont; measureScaled = DV.measureScaled; getIconPath = DV.getIconPath;
  });
  // --- body ---
  function drawGroups(ctx, cull){
    rt.groupLabelHitRects = [];
    if(state.currentTable) drawTableBody(ctx, cull, state.currentTable);
    var groups = state.currentGroups || [];
    ctx.save();
    // スイムレーン（biz）: 列の地 → フェーズの行の帯 → 列の境界線 の順に下地を描く。
    // 見出し（アクター・フェーズ）はノードより手前に出すため drawGroupHeaders で最後に描く。
    var swim = groups.filter(function(g){ return g.style==='swimlane'; });
    for(var s=0;s<swim.length;s++) if(rectIntersects(swim[s], cull)) drawSwimlaneColumn(ctx, swim[s]);
    drawPhaseRows(ctx, cull);
    for(var t=0;t<swim.length;t++) if(rectIntersects(swim[t], cull)) drawSwimlaneColumnLines(ctx, swim[t]);
    // 構成図の枠（入れ子）は外側から描く（layout.js が depth の昇順に並べてある）。
    // 内側の枠の地色・見出しが外側の枠の上に重なる。
    for(var i=0;i<groups.length;i++){
      var g = groups[i];
      if(g.style==='swimlane') continue;
      var r = { x:g.x, y:g.y, w:g.w, h:g.h };
      if(!rectIntersects(r, cull)) continue;
      if(g.style==='arch') drawArchContainer(ctx, g, r);
      else drawDashedGroup(ctx, g, r);
    }
    ctx.restore();
  }

  // 構成図（modes.arch）の枠。kind ごとに枠線の色・線種と地色を変え、左上に見出しの札を描く。
  // 札はクリックでその枠に寄れる（drawDashedGroup と同じく groupLabelHitRects に登録する）。
  var ARCH_CONTAINER_STYLE = {
    cloud:            { color:'#D9531E', tint:'rgba(217,83,30,.035)',  icon:'cloud' },
    region:           { color:'#147EBA', tint:'rgba(20,126,186,.035)', dash:[8,5], icon:'net' },
    vpc:              { color:'#7C3AED', tint:'rgba(124,58,237,.035)', icon:'net' },
    az:               { color:'#5B6472', tint:'rgba(91,100,114,.03)',  dash:[8,5] },
    'subnet-public':  { color:'#0E9F6E', tint:'rgba(14,159,110,.05)' },
    'subnet-private': { color:'#2F5BEA', tint:'rgba(47,91,234,.045)' },
    onprem:           { color:'#B46C00', tint:'rgba(180,108,0,.035)',  icon:'srv' },
    group:            { color:'#8A93A3', tint:'rgba(138,147,163,.03)', dash:[6,5] }
  };
  var ARCH_CHIP_H = 24, ARCH_CHIP_MIN_H = 14;
  function drawArchContainer(ctx, g, r){
    var st = ARCH_CONTAINER_STYLE[g.kind] || ARCH_CONTAINER_STYLE.group;
    var sr = worldRectToScreen(r);
    roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, 16);
    ctx.fillStyle = st.tint; ctx.fill();
    ctx.strokeStyle = st.color;
    ctx.lineWidth = g.depth ? 1.2 : 1.6;
    if(st.dash) ctx.setLineDash(st.dash);
    ctx.stroke();
    ctx.setLineDash([]);
    if(!g.label) return;
    if(sr.w < 64 || sr.h < 28) return;   // 枠が画面上で小さすぎるときは見出しを出さない

    // 見出しの札。枠の上端に確保した余白（headerH）の中に納まる大きさで描く。
    // 入れ子が深いと縮小時に札どうしが重なるので、余白が足りないときは
    // 一番外側の枠だけ枠の外（上）に出し、内側の枠の札は描かない。
    var band = (g.headerH||56)*state.view.k;
    var chipH = ARCH_CHIP_H, inside = true;
    if(band < ARCH_CHIP_H+8){
      if(band >= ARCH_CHIP_MIN_H+6) chipH = clamp(band-6, ARCH_CHIP_MIN_H, ARCH_CHIP_H);
      else if(g.depth===0) inside = false;    // 一番外側の枠は、枠の上に場所がある
      else return;                            // 内側の枠は札を描かない（重なるため）
    }
    var fontPx = clamp(chipH*0.54, 9, 12.5);
    var iconPx = Math.round(chipH*0.6);
    var iconW = st.icon ? iconPx+6 : 0;
    var labelFont = '700 '+fontPx.toFixed(2)+'px '+FONT_STACK;
    var subFont = '400 '+(fontPx*0.88).toFixed(2)+'px '+FONT_STACK;
    var labelW = measureCached(ctx, g.label, labelFont);
    var subW = g.sub ? measureCached(ctx, g.sub, subFont)+9 : 0;   // 8px の間隔 ＋ 丸め誤差の 1px
    var padX = Math.round(chipH*0.42);
    var chipW = Math.min(Math.max(40, padX*2+iconW+labelW+subW), Math.max(40, sr.w-16));
    var cx = sr.x+8, cy = inside ? sr.y+Math.max(3,(band-chipH)/2) : sr.y-chipH-5;
    roundRectPath(ctx, cx, cy, chipW, chipH, Math.min(8, chipH/3));
    ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fill();
    ctx.strokeStyle = st.color; ctx.lineWidth = 1; ctx.stroke();

    var tx = cx+padX;
    if(st.icon){
      ctx.save();
      ctx.strokeStyle = st.color; ctx.lineWidth = 1.8; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.translate(tx, cy+chipH/2-iconPx/2);
      ctx.scale(iconPx/24, iconPx/24);
      ctx.stroke(getIconPath(st.icon));
      ctx.restore();
      tx += iconW;
    }
    var textMaxW = Math.max(4, cx+chipW-padX-tx);
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.font = labelFont;
    ctx.fillStyle = st.color;
    var lw = Math.min(labelW, textMaxW);
    ctx.fillText(truncateText(ctx, g.label, labelFont, textMaxW), tx, cy+chipH/2+0.5);
    if(g.sub && textMaxW-lw > 24){
      ctx.font = subFont;
      ctx.fillStyle = '#8A93A3';
      ctx.fillText(truncateText(ctx, g.sub, subFont, textMaxW-lw-8), tx+lw+8, cy+chipH/2+0.5);
    }
    ctx.textBaseline='alphabetic';
    rt.groupLabelHitRects.push({ x:cx, y:cy, w:chipW, h:chipH, group:g });
  }

  // 既存の破線グループ枠（画面遷移図・機能一覧・データフローのステップのグルーピング用）
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

  // フェーズ・アクターの見出し文字サイズ（画面 px）。ワールド基準 × 倍率だが、
  // 縮小しても 11px を下回らず（消さない）、拡大しても 16px で頭打ちにする。
  function headerFontPx(worldBase){ return clamp(worldBase*state.view.k, 11, 16); }

  // スイムレーン（biz モード）: 横軸がアクターの列（groups。style: "swimlane"・上端に headerH の見出し）、
  // 縦軸が業務内容の行（phases。左端に headerW の見出し）の 1 枚の表。
  // 列の地は交互の淡色（縦に長い表でも自分の列を目で追えるように）。
  function drawSwimlaneColumn(ctx, g){
    var sr = worldRectToScreen(g);
    ctx.fillStyle = (g.index||0)%2===0 ? '#F8F9FC' : '#F1F4F8';
    ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
  }
  function drawSwimlaneColumnLines(ctx, g){
    var sr = worldRectToScreen(g);
    ctx.strokeStyle = '#D8DEE8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(sr.x)+0.5, sr.y); ctx.lineTo(Math.round(sr.x)+0.5, sr.y+sr.h);
    ctx.moveTo(Math.round(sr.x+sr.w)+0.5, sr.y); ctx.lineTo(Math.round(sr.x+sr.w)+0.5, sr.y+sr.h);
    ctx.stroke();
  }
  // フェーズの行: 奇数行に薄い帯、行の境界に実線（業務内容の区切りなので列の境界より濃く）
  function drawPhaseRows(ctx, cull){
    var phases = state.currentPhases || [];
    for(var i=0;i<phases.length;i++){
      var ph = phases[i];
      if(!rectIntersects(ph, cull)) continue;
      var sr = worldRectToScreen(ph);
      if((ph.index||0)%2===1){ ctx.fillStyle = 'rgba(30,41,59,.035)'; ctx.fillRect(sr.x, sr.y, sr.w, sr.h); }
      ctx.strokeStyle = '#C3CCD9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sr.x, Math.round(sr.y)+0.5); ctx.lineTo(sr.x+sr.w, Math.round(sr.y)+0.5);
      ctx.moveTo(sr.x, Math.round(sr.y+sr.h)+0.5); ctx.lineTo(sr.x+sr.w, Math.round(sr.y+sr.h)+0.5);
      ctx.stroke();
    }
  }

  // 見出しの画面上の箱。表の端に貼り付く（スクロールしても画面の上端・左端に残る）が、
  // 列・行の反対側の端より先には出ない。縮小して見出し欄が文字より狭くなったときは、
  // 表の外側（上・左）へ広げて文字が収まる大きさを保つ。見出しは表の内側の端（見出し欄と本体の境）に揃える。
  // 拡大しても見出しは一定の大きさで頭打ちにする（貼り付いた見出しが画面を覆わないように）。
  var LANE_HEADER_MIN_PX = 44, LANE_HEADER_MAX_PX = 88, PHASE_HEADER_MIN_PX = 132, PHASE_HEADER_MAX_PX = 220;
  function laneHeaderBox(g){
    var sr = worldRectToScreen(g);
    var nat = (g.headerH||72)*state.view.k;
    var h = clamp(nat, LANE_HEADER_MIN_PX, LANE_HEADER_MAX_PX);
    var y = Math.min(Math.max(sr.y+nat-h, 0), sr.y+sr.h-h);
    return { x:sr.x, y:y, w:sr.w, h:h };
  }
  function phaseHeaderBox(ph){
    var sr = worldRectToScreen(ph);
    var nat = (ph.headerW||0)*state.view.k;
    var w = clamp(nat, PHASE_HEADER_MIN_PX, PHASE_HEADER_MAX_PX);
    var x = Math.min(Math.max(sr.x+nat-w, 0), sr.x+sr.w-w);
    return { x:x, y:sr.y, w:w, h:sr.h };
  }

  // 見出し（ノード・辺より手前に描く）。フェーズ見出しのクリックでその行へ寄る。
  function drawGroupHeaders(ctx){
    if(state.currentTable) drawTableHeader(ctx, state.currentTable);
    var groups = (state.currentGroups || []).filter(function(g){ return g.style==='swimlane'; });
    var phases = (state.currentPhases || []).filter(function(p){ return p.headerW>0; });
    if(!groups.length && !phases.length) return;
    var view = { x:0, y:0, w:rt.cssW, h:rt.cssH };
    var inView = function(b){ return b.x < view.w && b.x+b.w > 0 && b.y < view.h && b.y+b.h > 0; };
    var laneBottom = groups.length ? laneHeaderBox(groups[0]) : null;
    ctx.save();
    for(var i=0;i<phases.length;i++){
      var pb = phaseHeaderBox(phases[i]);
      if(!inView(pb)) continue;
      drawPhaseHeader(ctx, phases[i], pb, laneBottom ? Math.max(0, laneBottom.y+laneBottom.h) : 0);
      rt.groupLabelHitRects.push({ x:pb.x, y:pb.y, w:pb.w, h:pb.h, group:phases[i] });
    }
    for(var j=0;j<groups.length;j++){
      var lb = laneHeaderBox(groups[j]);
      if(!inView(lb)) continue;
      drawLaneHeader(ctx, groups[j], lb);
    }
    // 左上の角（フェーズ見出し欄とアクター見出し欄の交点）
    if(groups.length && phases.length){
      var cb = phaseHeaderBox(phases[0]);
      var cl = laneHeaderBox(groups[0]);
      ctx.fillStyle = '#DDE2EB';
      ctx.fillRect(cb.x, cl.y, cb.w, cl.h);
      ctx.strokeStyle = '#C3CCD9'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(cb.x)+0.5, Math.round(cl.y)+0.5, Math.round(cb.w), Math.round(cl.h));
    }
    ctx.restore();
  }
  function drawLaneHeader(ctx, g, b){
    ctx.fillStyle = (g.index||0)%2===0 ? '#E7EAF1' : '#E0E5ED';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#C3CCD9'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(b.x)+0.5, Math.round(b.y)+0.5, Math.round(b.w), Math.round(b.h));
    var labelPx = headerFontPx(15), subPx = headerFontPx(11), gap = 3;
    var padX = 10, maxTextW = Math.max(4, b.w-padX*2);
    ctx.font = '700 '+labelPx.toFixed(2)+'px '+FONT_STACK;
    var lineH = labelPx*1.15;
    // 列幅に収まらない label は 2 行に折り返す。sub は高さに空きがあるときだけ 1 行で添える
    var maxLines = b.h-12 >= lineH*2 ? 2 : 1;
    var lines = wrapCharLines(ctx, g.label||'', ctx.font, maxTextW, maxLines);
    var labelBlockH = lines.length*lineH;
    var showSub = !!g.sub && (labelBlockH+gap+subPx) <= b.h-10;
    var blockH = labelBlockH + (showSub ? gap+subPx : 0);
    var top = b.y + b.h/2 - blockH/2;
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillStyle = '#1A2029';
    for(var li=0; li<lines.length; li++) ctx.fillText(lines[li], b.x+b.w/2, top+li*lineH);
    if(showSub){
      ctx.font = '400 '+subPx.toFixed(2)+'px '+FONT_STACK;
      ctx.fillStyle = '#8A93A3';
      ctx.fillText(truncateText(ctx, g.sub, ctx.font, maxTextW), b.x+b.w/2, top+labelBlockH+gap);
    }
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  }
  // minTop: アクター見出しの下端（貼り付いた見出しに隠れる部分を避けて、行の見えている範囲の中央に文字を置く）
  function drawPhaseHeader(ctx, ph, b, minTop){
    ctx.fillStyle = '#E7EAF1';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#C3CCD9'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(b.x)+0.5, Math.round(b.y)+0.5, Math.round(b.w), Math.round(b.h));
    if(!ph.label) return;
    var labelPx = headerFontPx(14), lineH = labelPx*1.25, padX = 12;
    var visTop = Math.max(b.y, minTop), visBottom = Math.min(b.y+b.h, rt.cssH);
    var availH = visBottom-visTop-12;
    if(availH < lineH) return;
    ctx.font = '700 '+labelPx.toFixed(2)+'px '+FONT_STACK;
    var lines = wrapCharLines(ctx, ph.label, ctx.font, Math.max(4, b.w-padX*2), clamp(Math.floor(availH/lineH), 1, 5));
    var top = (visTop+visBottom)/2 - lines.length*lineH/2;
    ctx.fillStyle = '#374151';
    ctx.textAlign='left'; ctx.textBaseline='top';
    for(var i=0;i<lines.length;i++) ctx.fillText(lines[i], b.x+padX, top+i*lineH);
    ctx.textBaseline='alphabetic';
  }

  // 表（機能一覧の arrange: "table"）: 1 画面 1 行。サムネイルは画面ノードとして drawNodes が上に描く。
  // 文字はワールド座標の大きさ（ズームに比例）。折り返しは 100px の基準フォントで 1 回だけ計算して行に
  // キャッシュする（列幅も文字サイズもワールド座標で固定なので、倍率が変わっても行の分け方は同じ）。
  var TABLE_STATUS_TONE = {
    green:{ bg:'#E7F6EC', fg:'#1E7B3A', border:'#A7DDB6' },
    blue: { bg:'#EAF0FF', fg:'#2F5BEA', border:'#B9CBF7' },
    amber:{ bg:'#FFF4DE', fg:'#B46C00', border:'#F0C987' },
    slate:{ bg:'#F1F3F7', fg:'#5B6472', border:'#D5DBE4' }
  };
  var TABLE_TEXT_MIN_PX = 4.5; // 画面上でこれ未満の文字は描かない（読めず、描画コストだけかかる）
  function tableRowText(row, key){ return key==='id' ? row.id : (row[key]||''); }
  function drawTableCellText(ctx, row, col, sx, sy, k, maxWorldH){
    var px = col.px*k;
    if(px < TABLE_TEXT_MIN_PX) return;
    var cache = row.__lines || (row.__lines = {});
    if(!cache[col.key]){
      var maxLines = Math.max(1, Math.floor(maxWorldH/col.lineH));
      var baseFont = col.weight+' 100px '+FONT_STACK;
      cache[col.key] = wrapCharLines(ctx, tableRowText(row, col.key), baseFont, (col.w-state.currentTable.padX*2)*100/col.px, maxLines);
    }
    var lines = cache[col.key];
    ctx.font = scaledFont(col.weight, px);
    ctx.textAlign='left'; ctx.textBaseline='top';
    for(var i=0;i<lines.length;i++) ctx.fillText(lines[i], sx, sy+i*col.lineH*k);
  }
  function drawStatusBadge(ctx, statuses, status, x, y, k, align){
    var st = status && statuses[status];
    if(!st) return;
    var tone = TABLE_STATUS_TONE[st.tone] || TABLE_STATUS_TONE.slate;
    var px = 13*k, h = 28*k;
    var w = (px >= TABLE_TEXT_MIN_PX ? measureScaled(ctx, st.label, '700', px) : st.label.length*px) + 24*k;
    var bx = align==='right' ? x-w : x;
    roundRectPath(ctx, bx, y, w, h, h/2);
    ctx.fillStyle = tone.bg; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = tone.border; ctx.stroke();
    if(px < TABLE_TEXT_MIN_PX) return;
    ctx.font = scaledFont('700', px);
    ctx.fillStyle = tone.fg; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(st.label, bx+w/2, y+h/2+0.5*k);
    return w;
  }
  function drawTableBody(ctx, cull, t){
    var k = state.view.k;
    ctx.save();
    var tr = worldRectToScreen(t);
    ctx.fillStyle = '#fff';
    ctx.fillRect(tr.x, tr.y, tr.w, tr.h);
    // セクション（グループ）の見出し行: グループ名・画面数・実装状況の内訳
    for(var si=0; si<t.sections.length; si++){
      var sec = t.sections[si];
      var srect = { x:t.x, y:sec.y, w:t.w, h:sec.h };
      if(!rectIntersects(srect, cull)) continue;
      var ss = worldRectToScreen(srect);
      ctx.fillStyle = '#EEF2F8';
      ctx.fillRect(ss.x, ss.y, ss.w, ss.h);
      var lpx = 16*k;
      if(lpx >= TABLE_TEXT_MIN_PX){
        ctx.font = scaledFont('800', lpx);
        ctx.fillStyle = '#1A2029'; ctx.textAlign='left'; ctx.textBaseline='middle';
        var lx = ss.x + t.padX*k, ly = ss.y + ss.h/2;
        ctx.fillText(sec.label, lx, ly);
        lx += measureScaled(ctx, sec.label, '800', lpx) + 12*k + 4; // 小さい文字は基準フォントの比例より幅が出るので固定の余白を足す
        ctx.font = scaledFont('600', 13*k);
        ctx.fillStyle = '#6B7482';
        var cnt = sec.count+' '+(sec.unit||'画面');
        ctx.fillText(cnt, lx, ly);
        lx += measureScaled(ctx, cnt, '600', 13*k) + 16*k + 4;
        Object.keys(t.statuses).forEach(function(key){
          var n = sec.counts[key];
          if(!n) return;
          var st = t.statuses[key];
          var w = drawStatusBadge(ctx, { x:{ label: st.label+' '+n, tone: st.tone } }, 'x', lx, ly-14*k, k);
          lx += (w||0) + 8*k;
        });
      }
    }
    // 画面の行
    var cols = t.columns;
    for(var ri=0; ri<t.rows.length; ri++){
      var row = t.rows[ri];
      var rrect = { x:t.x, y:row.y, w:t.w, h:row.h };
      if(!rectIntersects(rrect, cull)) continue;
      var rs = worldRectToScreen(rrect);
      var active = state.selected===row.id ? '#EAF0FF' : (state.hovered===row.id ? '#F4F7FF' : null);
      if(active){ ctx.fillStyle = active; ctx.fillRect(rs.x, rs.y, rs.w, rs.h); }
      ctx.strokeStyle = '#E3E8EF'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(rs.x, Math.round(rs.y+rs.h)+0.5); ctx.lineTo(rs.x+rs.w, Math.round(rs.y+rs.h)+0.5); ctx.stroke();
      var top = rs.y + t.padY*k;
      for(var ci=0; ci<cols.length; ci++){
        var col = cols[ci];
        var cx = tr.x + (col.x + t.padX)*k;
        if(col.key==='thumb') continue;
        if(col.key==='status'){ drawStatusBadge(ctx, t.statuses, row.status, cx, top, k); continue; }
        ctx.fillStyle = col.key==='id' ? '#6B7482' : (col.key==='title' ? '#1A2029' : '#374151');
        drawTableCellText(ctx, row, col, cx, top, k, row.h - t.padY*2);
      }
    }
    // 列の区切り線
    ctx.strokeStyle = '#E3E8EF'; ctx.lineWidth = 1;
    ctx.beginPath();
    for(var cj=1; cj<cols.length; cj++){
      var lxs = Math.round(tr.x + cols[cj].x*k)+0.5;
      ctx.moveTo(lxs, tr.y + t.headerH*k); ctx.lineTo(lxs, tr.y+tr.h);
    }
    ctx.stroke();
    ctx.strokeStyle = '#D5DDE7';
    ctx.strokeRect(Math.round(tr.x)+0.5, Math.round(tr.y)+0.5, Math.round(tr.w), Math.round(tr.h));
    ctx.restore();
  }
  // 列見出し: 表の上端に置き、スクロールしても画面の上端に貼り付く（表の下端より先には出ない）
  function drawTableHeader(ctx, t){
    var k = state.view.k;
    var tr = worldRectToScreen(t);
    var h = clamp(t.headerH*k, 30, 48);
    var y = Math.min(Math.max(tr.y + t.headerH*k - h, 0), tr.y+tr.h-h);
    if(y > rt.cssH || y+h < 0 || tr.x > rt.cssW || tr.x+tr.w < 0) return;
    ctx.save();
    ctx.fillStyle = '#E7EAF1';
    ctx.fillRect(tr.x, y, tr.w, h);
    ctx.strokeStyle = '#C3CCD9'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(tr.x)+0.5, Math.round(y)+0.5, Math.round(tr.w), Math.round(h));
    var px = clamp(13*k, 11, 14);
    ctx.font = '700 '+px.toFixed(2)+'px '+FONT_STACK;
    ctx.fillStyle = '#374151'; ctx.textAlign='left'; ctx.textBaseline='middle';
    for(var i=0;i<t.columns.length;i++){
      var col = t.columns[i];
      var cx = tr.x + col.x*k, cw = col.w*k;
      if(i>0){ ctx.beginPath(); ctx.moveTo(Math.round(cx)+0.5, y); ctx.lineTo(Math.round(cx)+0.5, y+h); ctx.stroke(); }
      var pad = Math.min(t.padX*k, 12);
      ctx.fillText(truncateText(ctx, col.label, ctx.font, Math.max(4, cw-pad*2)), cx+pad, y+h/2);
    }
    ctx.restore();
  }
  // 表の行のヒットテスト（サムネイル以外の行の上をクリック・ホバーしたときにその画面を返す）
  function hitTestTableRow(sx, sy, visSet){
    var t = state.currentTable;
    if(!t) return null;
    var k = state.view.k;
    var wx = (sx-state.view.x)/k, wy = (sy-state.view.y)/k;
    if(wx < t.x || wx > t.x+t.w) return null;
    // 貼り付いた列見出しの上は行として扱わない
    var tr = worldRectToScreen(t);
    var hh = clamp(t.headerH*k, 30, 48);
    var hy = Math.min(Math.max(tr.y + t.headerH*k - hh, 0), tr.y+tr.h-hh);
    if(sy >= hy && sy <= hy+hh) return null;
    for(var i=0;i<t.rows.length;i++){
      var r = t.rows[i];
      if(wy >= r.y && wy < r.y+r.h) return (visSet && !visSet.has(r.id)) ? null : r.id;
    }
    return null;
  }

  // 辺ラベルの枠・文字の色（線の色に合わせる type だけ。ほかは灰色）
  var EDGE_LABEL_TONE = { system:{ border:'#DCCBFB', fg:'#6D28D9' }, ng:{ border:'#FECACA', fg:'#B91C1C' } };
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
          ctx.lineWidth=1; ctx.strokeStyle = EDGE_LABEL_TONE[e.type] ? EDGE_LABEL_TONE[e.type].border : '#E2E6ED';
          ctx.stroke();
          ctx.fillStyle = EDGE_LABEL_TONE[e.type] ? EDGE_LABEL_TONE[e.type].fg : '#5B6472';
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
  DV.drawGroups = drawGroups; DV.drawGroupHeaders = drawGroupHeaders; DV.hitTestTableRow = hitTestTableRow; DV.drawEdges = drawEdges;
})();
