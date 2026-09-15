(function(){
  'use strict';
  var DV = window.DV;
  var rt = DV.rt;
  // ノード種別（pill/concept/biz/er/dfd）ごとの図形ラスタ描画。
  // --- import ---
  var getIconPath, clamp, roundRectPath, measureCached, truncateText, wrapCharLines, state, FONT_STACK;
  DV.links.push(function(){
    getIconPath = DV.getIconPath; clamp = DV.clamp; roundRectPath = DV.roundRectPath; measureCached = DV.measureCached; truncateText = DV.truncateText; wrapCharLines = DV.wrapCharLines; state = DV.state; FONT_STACK = DV.FONT_STACK;
  });
  // --- body ---
  function drawNodeRasterContent(ctx, entry, w, h, noText){
    var mp = entry.modePos[state.mode];
    var n = (mp && mp.node) || {};
    if(entry.kind==='pill') drawPillContent(ctx, n, w, h);
    else if(entry.kind==='concept') drawConceptContent(ctx, n, w, h);
    else if(entry.kind==='biz') drawBizContent(ctx, n, w, h, noText);
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

  // biz（業務フロー）ノード。variant: start | end | task | system | decision
  var BIZ_VARIANT_COLOR = {
    task:    { bg:'#FFFFFF', border:'#CBD5E1', bar:'#2F6DFF' },
    system:  { bg:'#F3EEFF', border:'#C4B5FD', bar:'#7C3AED' },
    decision:{ bg:'#FFF7E0', border:'#F2B84B' },
    start:   { bg:'#1A2029' },
    end:     { bg:'#FFFFFF', border:'#1A2029' }
  };
  // ミニマップの塗り色（variant ごと。淡色の箱色と揃える）
  var BIZ_MINIMAP_COLOR = {
    task:'rgba(47,109,255,.55)', system:'rgba(124,58,237,.55)',
    decision:'rgba(242,184,75,.7)', start:'rgba(26,32,41,.7)', end:'rgba(26,32,41,.45)'
  };
  // 縮小時（TEXT_MIN_SCALE 未満）の単色の箱の色。variant ごとのアクセント色を代表させる
  var BIZ_DOT_COLOR = { task:'#2F6DFF', system:'#7C3AED', decision:'#F2B84B', start:'#1A2029', end:'#1A2029' };
  // variant ごとの主ラベルのワールド基準フォントサイズ（画面固定オーバーレイの
  // 表示要否をこのサイズ × k で判定する。drawBizLabelOverlay の色もここに合わせる）
  var BIZ_LABEL_WORLD_PX = { task:15, system:15, decision:13, start:15, end:15 };
  var BIZ_LABEL_OVERLAY_COLOR = { task:'#1A2029', system:'#1A2029', decision:'#1A2029', start:'#fff', end:'#1A2029' };

  // noText: true のときはラスタに文字（label / sub / 「システム」タグ / 画面バッジの
  // 文字）を焼き込まない。呼び出し側（drawCacheableNode）がこのズームでは画面固定サイズの
  // オーバーレイラベルを別途重ねて描くため、ここで描くと二重描画になる。形（枠・地色・
  // 色帯）はそのまま描く。
  function drawBizContent(ctx, n, w, h, noText){
    var variant = n.variant||'task';
    var col = BIZ_VARIANT_COLOR[variant] || BIZ_VARIANT_COLOR.task;

    if(variant==='start' || variant==='end'){
      roundRectPath(ctx,0,0,w,h,h/2);
      ctx.fillStyle = col.bg; ctx.fill();
      if(variant==='end'){ ctx.lineWidth=2.5; ctx.strokeStyle=col.border; ctx.stroke(); }
      if(!noText){
        ctx.fillStyle = variant==='start' ? '#fff' : '#1A2029';
        ctx.font = '800 15px '+FONT_STACK;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(truncateText(ctx, n.label||'', ctx.font, w-28), w/2, h/2);
      }
      return;
    }

    if(variant==='decision'){
      ctx.beginPath();
      ctx.moveTo(w/2,1.5); ctx.lineTo(w-1.5,h/2); ctx.lineTo(w/2,h-1.5); ctx.lineTo(1.5,h/2);
      ctx.closePath();
      ctx.fillStyle = col.bg; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = col.border; ctx.stroke();
      if(!noText){
        ctx.fillStyle = '#1A2029';
        ctx.font = '700 13px '+FONT_STACK;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        var dLines = wrapCharLines(ctx, n.label||'', ctx.font, w*0.62, 2);
        var dlh = 16, dTop = h/2-(dLines.length-1)*dlh/2;
        dLines.forEach(function(line,i){ ctx.fillText(line, w/2, dTop+i*dlh); });
      }
      return;
    }

    // task / system: 白（または淡紫）地・角丸・左に色帯
    roundRectPath(ctx,0,0,w,h,12);
    ctx.fillStyle = col.bg; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = col.border; ctx.stroke();
    roundRectPath(ctx,0,0,4,h,2);
    ctx.fillStyle = col.bar; ctx.fill();

    if(noText) return;

    if(variant==='system'){
      ctx.font = '700 10px '+FONT_STACK;
      ctx.fillStyle = col.bar; ctx.textAlign='right'; ctx.textBaseline='alphabetic';
      ctx.fillText('システム', w-12, 18);
      ctx.textAlign='left';
    }

    var padX = 16, maxTextW = w-padX-14;
    ctx.font = '700 15px '+FONT_STACK;
    var lines = wrapCharLines(ctx, n.label||'', ctx.font, maxTextW, 2);
    var lh = 18;
    var blockH = lines.length*lh + (n.sub? 16:0);
    var top = Math.max(14, h/2-blockH/2);
    ctx.fillStyle = '#1A2029'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    lines.forEach(function(line,i){ ctx.fillText(line, padX, top+lh*(i+1)-4); });
    if(n.sub){
      ctx.fillStyle = '#8A93A3'; ctx.font = '400 11px '+FONT_STACK;
      ctx.fillText(truncateText(ctx, n.sub, ctx.font, maxTextW), padX, top+lines.length*lh+12);
    }

    if(variant==='task' && n.screen){
      ctx.font = '800 10px '+FONT_STACK;
      var bw = Math.max(30, measureCached(ctx, n.screen, ctx.font)+14);
      var bh = 18, bx = w-12-bw, by = h-12-bh;
      roundRectPath(ctx, bx, by, bw, bh, 6);
      ctx.fillStyle = '#EAF0FF'; ctx.fill();
      ctx.fillStyle = '#2F5BEA'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(n.screen, bx+bw/2, by+bh/2+0.5);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    }
  }

  // ノードの縮小時ラベル（biz）: ラスタ内の label が画面上で読めなくなる倍率で、
  // 画面固定 10〜11px のラベルをノード中央に重ねて描く（noText ラスタとセットで使う）。
  // ノードの画面幅が 44px 未満なら描かない。
  function drawBizLabelOverlay(ctx, n, sr){
    if(sr.w<44) return;
    var variant = n.variant||'task';
    ctx.save();
    ctx.font = '800 11px '+FONT_STACK;
    ctx.fillStyle = BIZ_LABEL_OVERLAY_COLOR[variant] || '#1A2029';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    // 高さに余裕があれば 2 行に折り返す（1 行で省略すると全体表示でラベルが読めないため）。
    // ひし形は内接する幅が狭いので横幅を 7 割に絞る
    var lineH = 13;
    var maxW = (variant==='decision' ? sr.w*0.7 : sr.w-12);
    var maxLines = clamp(Math.floor((sr.h-4)/lineH), 1, 2);
    var lines = wrapCharLines(ctx, n.label||'', ctx.font, maxW, maxLines);
    var y0 = sr.y+sr.h/2 - (lines.length-1)*lineH/2;
    for(var i=0;i<lines.length;i++) ctx.fillText(lines[i], sr.x+sr.w/2, y0+i*lineH);
    ctx.restore();
  }

  // 概念図のノード種別。人（actor）・仕組み（system）・情報（entity）・外部ファイル（file）を
  // アイコンの地色だけでなく、カードの形・地色・枠線でも区別する（全体表示でも見分けられるように）。
  var CONCEPT_VARIANT_COLOR = {
    actor: { bg:'#FFF3DE', fg:'#B46C00', card:'#FFFBF3', border:'#F0C987' },
    entity:{ bg:'#EAF0FF', fg:'#2F5BEA', card:'#FFFFFF', border:'#B9CBF7' },
    system:{ bg:'#F1EAFE', fg:'#7C3AED', card:'#FAF7FF', border:'#CDB6F6' },
    file:  { bg:'#E7F5F2', fg:'#0F766E', card:'#FFFFFF', border:'#8CCBC0', dash:[6,4] }
  };
  function drawConceptContent(ctx, n, w, h){
    var variant = n.variant||'entity';
    var col = CONCEPT_VARIANT_COLOR[variant] || CONCEPT_VARIANT_COLOR.entity;
    var r = variant==='actor' ? h/2 : (variant==='file' ? 6 : 14);
    roundRectPath(ctx,0.75,0.75,w-1.5,h-1.5,r);
    ctx.fillStyle = col.card; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = col.border;
    if(col.dash) ctx.setLineDash(col.dash);
    ctx.stroke();
    ctx.setLineDash([]);
    if(variant==='system'){
      // 仕組み: 左端に色帯
      roundRectPath(ctx,5,14,4,h-28,2);
      ctx.fillStyle = col.fg; ctx.fill();
    }
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
  // --- body end ---
  // --- export ---
  DV.drawNodeRasterContent = drawNodeRasterContent; DV.BIZ_MINIMAP_COLOR = BIZ_MINIMAP_COLOR; DV.BIZ_DOT_COLOR = BIZ_DOT_COLOR; DV.BIZ_LABEL_WORLD_PX = BIZ_LABEL_WORLD_PX; DV.drawBizLabelOverlay = drawBizLabelOverlay; DV.CONCEPT_VARIANT_COLOR = CONCEPT_VARIANT_COLOR; DV.ER_TONE_GRAD = ER_TONE_GRAD; DV.topRoundRectPath = topRoundRectPath; DV.DFD_VARIANT_COLOR = DFD_VARIANT_COLOR;
})();
