/* ============================================================
   design-viewer engine — Canvas 2D ビューア本体
   依存: window.VIEWER_DATA (viewer-data.js)
   file:// で開ける想定（ES modules 不可、fetch 不可）。
   ============================================================ */
(function(){
  'use strict';
  var DV = window.DV = {
    rt: { cssW:0, cssH:0, dprCur:1, minimapBgDirty:true, groupLabelHitRects:[] },
    links: []
  };
  // 定数・アイコン定義・汎用ユーティリティ・性能計測。
  // --- body ---
  // ---------------------------------------------------------
  // 定数
  // ---------------------------------------------------------
  var MODE_LABEL_JA = { flow:'画面遷移図', gallery:'機能一覧', concept:'概念図', biz:'業務フロー', jobflow:'ジョブフロー', er:'ER図', dfd:'データフロー', arch:'構成図' };
  var MODE_MAX_K = { flow:0.6, gallery:0.6, concept:1.4, biz:1.4, jobflow:1.4, er:1.4, dfd:1.4, arch:1.4 };
  var MIN_K = 0.02, MAX_K = 4.0;
  var EDGE_COLOR = {
    user:'#3B6FF5', system:'#8B5CF6', nav:'#A3ABB9', start:'#64748B',
    rel:'#475569', weak:'#94A3B8', flow:'#2F5BEA', ng:'#DC2626'
  };
  var EDGE_DASH = {
    system:[7,6], weak:[7,6], nav:[1.5,7], ng:[7,6]
  };
  var EDGE_ALPHA = { start:0.72 };
  var KIND_LABEL_JA = { pill:'開始点', concept:'概念', biz:'業務ステップ', job:'ジョブ', batch:'バッチ', er:'テーブル（リスト）', dfd:'処理・データストア・外部', arch:'構成要素' };
  var LOD_BUCKETS = [0.25,0.5,1,2];
  var LIVE_MIN_PX = 300;      // 画面ノードの表示幅（デバイス px）がこれ以上で「大」サムネイル
  var TEXT_MIN_SCALE = 0.3;   // concept/biz/job/er/dfd/arch: 表示倍率×DPR がこれ未満なら文字を描かず箱だけ
  var EDGE_LABEL_MIN_K = 0.14;
  var CARD_TITLE_MIN_PX = 12;  // layout: "elk" の画面カード見出しの最小文字サイズ（これ未満ならカード上に出す）
  var RASTER_CACHE_MAX = 300;
  var SETTLE_MS = 160;

  // ---------------------------------------------------------
  // アイコン（icons.js の SVG マークアップを構造化して保持。Path2D で描く）
  // ---------------------------------------------------------
  var ICONS = {
    chat: [['path','M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H9l-4 3v-3H5.5C4.67 16 4 15.33 4 14.5v-9Z']],
    bell: [['path','M12 3.5c-2.49 0-4.5 2.01-4.5 4.5v3.1c0 .5-.2 1-.55 1.35L5.5 14v1h13v-1l-1.45-1.55c-.35-.35-.55-.85-.55-1.35V8c0-2.49-2.01-4.5-4.5-4.5Z'],['path','M9.8 18a2.2 2.2 0 0 0 4.4 0']],
    team: [['circle',8.5,8,2.5],['circle',16,9,2],['path','M3.5 19c0-2.76 2.24-5 5-5s5 2.24 5 5'],['path','M13.8 14.3c1.9.4 3.3 2.1 3.3 4.1v.6']],
    cal: [['rect',4,5.5,16,14,1.5],['path','M4 9.5h16'],['path','M8 3.5v3M16 3.5v3'],['path','M7.5 13h2v2h-2zM11 13h2v2h-2zM14.5 13h2v2h-2z']],
    bot: [['rect',5,8,14,10,2.5],['path','M12 8V5'],['circle',12,4,1.1],['circle',9,13,1.2],['circle',15,13,1.2],['path','M9 16.5h6']],
    apps: [['rect',4,4,6.5,6.5,1.2],['rect',13.5,4,6.5,6.5,1.2],['rect',4,13.5,6.5,6.5,1.2],['rect',13.5,13.5,6.5,6.5,1.2]],
    search: [['circle',10.5,10.5,6],['path','M15 15l5 5']],
    inbox: [['path','M4 12l2.2-6.6A1.5 1.5 0 0 1 7.6 4.4h8.8c.65 0 1.22.42 1.4 1L20 12'],['path','M4 12v5.5C4 18.33 4.67 19 5.5 19h13c.83 0 1.5-.67 1.5-1.5V12h-4.2a2.2 2.2 0 0 1-4.6 0H4Z']],
    doc: [['path','M7 3.5h7l4 4v13H7Z'],['path','M14 3.5v4h4'],['path','M9.5 12h5M9.5 15h5M9.5 9h2']],
    check: [['path','M4.5 12.5l5 5 10-11']],
    tag: [['path','M11.5 4.5H6.5a2 2 0 0 0-2 2v5l9.6 9.6a1.5 1.5 0 0 0 2.12 0l5.38-5.38a1.5 1.5 0 0 0 0-2.12L11.5 4.5Z'],['circle',8.2,8.2,1.3]],
    user: [['circle',12,8.3,3.3],['path','M5 20c0-3.6 3.13-6.5 7-6.5s7 2.9 7 6.5']],
    flow: [['circle',6,6.5,2.2],['circle',18,6.5,2.2],['circle',12,17.5,2.2],['path','M8 7.3 10.4 15.6M16 7.3 13.6 15.6']],
    db: [['ellipse',12,6,7,2.6],['path','M5 6v12c0 1.44 3.13 2.6 7 2.6s7-1.16 7-2.6V6'],['path','M5 12c0 1.44 3.13 2.6 7 2.6s7-1.16 7-2.6']],
    spark: [['path','M12 3.5c.5 3.2 2 4.7 5.2 5.2-3.2.5-4.7 2-5.2 5.2-.5-3.2-2-4.7-5.2-5.2 3.2-.5 4.7-2 5.2-5.2Z'],['path','M18.5 15.5c.28 1.5.9 2.12 2.4 2.4-1.5.28-2.12.9-2.4 2.4-.28-1.5-.9-2.12-2.4-2.4 1.5-.28 2.12-.9 2.4-2.4Z']],
    shield: [['path','M12 3.7 18.5 6v5.3c0 4.3-2.8 7.7-6.5 9-3.7-1.3-6.5-4.7-6.5-9V6Z'],['path','M9.3 12l1.9 1.9 3.5-3.9']],
    gear: [['circle',12,12,3],['path','M12 3.5v2.1M12 18.4v2.1M20.5 12h-2.1M5.6 12H3.5M17.8 6.2l-1.5 1.5M7.7 16.3l-1.5 1.5M17.8 17.8l-1.5-1.5M7.7 7.7 6.2 6.2']],
    plus: [['path','M12 5v14M5 12h14']],
    back: [['path','M15 5l-7 7 7 7']],
    list: [['path','M9 6.5h11M9 12h11M9 17.5h11'],['circle',4.3,6.5,1.1],['circle',4.3,12,1.1],['circle',4.3,17.5,1.1]],
    send: [['path','M4.5 12 20 4.5 15 19.5 11.2 13 4.5 12Z'],['path','M11.2 13 15 19.5']],
    warn: [['path','M12 4 21 19.5H3Z'],['path','M12 10.2v4'],['circle',12,16.8,0.9]],
    clock: [['circle',12,12,8.5],['path','M12 7v5.2l3.4 2']],
    // 構成図（modes.arch）用。AWS 公式アイコンではなく、他のアイコンと同じ線画で描いた汎用の記号
    cloud: [['path','M7.6 18.5h8.9a3.9 3.9 0 0 0 .6-7.75 5.3 5.3 0 0 0-10-1.55A4.15 4.15 0 0 0 7.6 18.5Z']],
    lb: [['circle',12,5.2,2.2],['path','M12 7.4v3.6'],['path','M5.5 15.8v-2.7h13v2.7'],['circle',5.5,18,2.2],['circle',12,18,2.2],['circle',18.5,18,2.2]],
    srv: [['rect',3.5,4.5,17,6,1.4],['rect',3.5,13.5,17,6,1.4],['circle',7,7.5,0.9],['circle',7,16.5,0.9],['path','M11 7.5h6M11 16.5h6']],
    func: [['path','M13.2 3.5 6 13.8h4.9l-1.3 6.7 7.4-10.5h-5.1l1.3-6.5Z']],
    bucket: [['path','M4.8 6.6h14.4l-1.5 12a1.6 1.6 0 0 1-1.6 1.4H7.9a1.6 1.6 0 0 1-1.6-1.4L4.8 6.6Z'],['path','M3.5 6.6h17'],['path','M6.6 12.6h10.8']],
    queue: [['rect',3.4,8,4.6,8,1.2],['rect',9.7,8,4.6,8,1.2],['rect',16,8,4.6,8,1.2]],
    cdn: [['circle',12,12,8.5],['path','M3.5 12h17'],['path','M12 3.5c2.7 2.8 2.7 14.2 0 17'],['path','M12 3.5c-2.7 2.8-2.7 14.2 0 17']],
    fw: [['rect',3.5,5.5,17,13,1.4],['path','M3.5 10h17M3.5 14.5h17'],['path','M9.5 5.5V10M15 10v4.5M9.5 14.5v4']],
    key: [['circle',8.6,15.2,3.8],['path','M11.3 12.5 19.5 4.3'],['path','M16.6 7.2l2.2 2.2'],['path','M19.5 4.3l1.6 1.6']],
    monitor: [['path','M3.8 4.5v15.7h16.4'],['path','M7 16.5l3.4-4.6 2.8 2.6 3.2-5.4 2.6 3.4']],
    net: [['rect',3.5,3.5,6.8,6.8,1.3],['rect',13.7,13.7,6.8,6.8,1.3],['path','M10.3 6.9h4.4a2 2 0 0 1 2 2v4.8'],['path','M6.9 10.3v4.4a2 2 0 0 0 2 2h4.8']]
  };
  var iconPathCache = new Map();
  function getIconPath(name){
    if(iconPathCache.has(name)) return iconPathCache.get(name);
    var shapes = ICONS[name];
    var p = new Path2D();
    if(shapes){
      shapes.forEach(function(s){
        if(s[0]==='path'){ p.addPath(new Path2D(s[1])); }
        else if(s[0]==='circle'){ p.moveTo(s[1]+s[3], s[2]); p.arc(s[1],s[2],s[3],0,Math.PI*2); }
        else if(s[0]==='rect'){ addRoundRectPath(p, s[1],s[2],s[3],s[4], s[5]||0); }
        else if(s[0]==='ellipse'){ p.ellipse(s[1],s[2],s[3],s[4],0,0,Math.PI*2); }
      });
    }
    iconPathCache.set(name, p);
    return p;
  }
  function addRoundRectPath(p, x,y,w,h,r){
    r = Math.max(0, Math.min(r, w/2, h/2));
    if(r<=0.01){ p.rect(x,y,w,h); return; }
    p.moveTo(x+r,y);
    p.arcTo(x+w,y,x+w,y+h,r);
    p.arcTo(x+w,y+h,x,y+h,r);
    p.arcTo(x,y+h,x,y,r);
    p.arcTo(x,y,x+w,y,r);
    p.closePath();
  }

  // ---------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function logLerp(a,b,t){ return Math.exp(lerp(Math.log(a), Math.log(b), t)); }
  function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
  function now(){ return performance.now(); }
  function esc(v){ return v===null||v===undefined ? '' : String(v); }
  function escHtml(v){
    return esc(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function roundRectPath(ctx,x,y,w,h,r){
    r = Math.max(0, Math.min(r, Math.abs(w)/2, Math.abs(h)/2));
    ctx.beginPath();
    if(r<=0.01){ ctx.rect(x,y,w,h); return; }
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  // 文字列の省略記号付き切り詰め（measureText キャッシュ付き）
  var textWidthCache = new Map();
  function measureCached(ctx, text, font){
    var key = font+''+text;
    var w = textWidthCache.get(key);
    if(w===undefined){
      var prevFont = ctx.font;
      if(ctx.font!==font) ctx.font = font;
      w = ctx.measureText(text).width;
      if(ctx.font!==prevFont) ctx.font = prevFont;
      if(textWidthCache.size>5000) textWidthCache.clear();
      textWidthCache.set(key, w);
    }
    return w;
  }
  function truncateText(ctx, text, font, maxWidth){
    if(!text) return '';
    if(maxWidth<=4) return '';
    if(measureCached(ctx, text, font) <= maxWidth) return text;
    var ell = '…';
    var lo=0, hi=text.length;
    while(lo<hi){
      var mid = (lo+hi+1)>>1;
      var cand = text.slice(0,mid)+ell;
      if(measureCached(ctx, cand, font) <= maxWidth) lo=mid; else hi=mid-1;
    }
    return lo<=0 ? ell : text.slice(0,lo)+ell;
  }

  // 文字単位の折り返し（biz ノードの label / decision の label 用。最大 maxLines 行、
  // あふれた最終行は truncateText と同じ省略記号で切る。日本語はスペース区切りが
  // 無いことが多いため、単語単位ではなく 1 文字ずつ計測して詰める）
  function wrapCharLines(ctx, text, font, maxWidth, maxLines){
    text = esc(text);
    var prevFont = ctx.font;
    if(ctx.font!==font) ctx.font = font;
    var lines = [];
    var start = 0;
    while(start<text.length && lines.length<maxLines){
      var lo=start+1, hi=text.length, best=start+1;
      while(lo<=hi){
        var mid=(lo+hi)>>1;
        var w = measureCached(ctx, text.slice(start,mid), font);
        if(w<=maxWidth){ best=mid; lo=mid+1; } else { hi=mid-1; }
      }
      lines.push(text.slice(start,best));
      start = best;
    }
    if(start<text.length && lines.length){
      lines[lines.length-1] = truncateText(ctx, lines[lines.length-1]+text.slice(start), font, maxWidth);
    }
    if(ctx.font!==prevFont) ctx.font = prevFont;
    return lines;
  }

  // ---------------------------------------------------------
  // 性能計測（試験用。常時 ON）
  // ---------------------------------------------------------
  window.__viewerPerf = { frames: [] };
  function recordFrame(ms){
    var arr = window.__viewerPerf.frames;
    arr.push(ms);
    if(arr.length>300) arr.splice(0, arr.length-300);
  }
  // --- body end ---
  // --- export ---
  DV.MODE_LABEL_JA = MODE_LABEL_JA; DV.MODE_MAX_K = MODE_MAX_K; DV.MIN_K = MIN_K; DV.MAX_K = MAX_K; DV.EDGE_COLOR = EDGE_COLOR; DV.EDGE_DASH = EDGE_DASH; DV.EDGE_ALPHA = EDGE_ALPHA; DV.KIND_LABEL_JA = KIND_LABEL_JA; DV.LOD_BUCKETS = LOD_BUCKETS; DV.LIVE_MIN_PX = LIVE_MIN_PX; DV.TEXT_MIN_SCALE = TEXT_MIN_SCALE; DV.EDGE_LABEL_MIN_K = EDGE_LABEL_MIN_K; DV.CARD_TITLE_MIN_PX = CARD_TITLE_MIN_PX; DV.RASTER_CACHE_MAX = RASTER_CACHE_MAX; DV.SETTLE_MS = SETTLE_MS; DV.getIconPath = getIconPath; DV.clamp = clamp; DV.lerp = lerp; DV.logLerp = logLerp; DV.easeInOutCubic = easeInOutCubic; DV.now = now; DV.esc = esc; DV.escHtml = escHtml; DV.roundRectPath = roundRectPath; DV.measureCached = measureCached; DV.truncateText = truncateText; DV.wrapCharLines = wrapCharLines; DV.recordFrame = recordFrame;
})();
