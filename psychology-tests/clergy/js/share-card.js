// 1080×1350 공유 카드. 로컬 Gowun Batang, 같은 출처 일러스트, 로컬 QR만 사용해 Canvas가 오염되지 않게 한다.
(function (root) {
  'use strict';

  var W = 1080, H = 1350, PAD = 72;
  var INNER = W - PAD * 2;
  var FONT = '"Gowun Batang", serif';
  var COLORS = { bg: '#F6F1E8', paper: '#FFFDF8', ink: '#24343B', muted: '#65716F', line: '#E4DCCD' };
  var TITLE = '나는 목사일까, 신부일까, 스님일까?';
  var FOOTER_TOP = H - PAD - 150; // QR·안내 영역 시작

  function font(size) { return '400 ' + size + 'px ' + FONT; }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () { resolve(img); });
      };
      img.onerror = function () { reject(new Error('이미지 로드 실패: ' + src)); };
      img.src = src;
    });
  }

  // 카드에 쓰는 글자의 unicode-range 서브셋을 모두 받아 둔다. 대체 글꼴로 그려지는 것을 막는다.
  function loadFonts(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return document.fonts.load(font(40), text).then(function () { return document.fonts.ready; });
  }

  // 어절 단위로 줄바꿈하고, 한 어절이 너무 길면 글자 단위로 나눈다.
  function wrap(ctx, text, maxWidth) {
    var lines = [];
    var line = '';
    text.split(/\s+/).forEach(function (word) {
      var test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxWidth) { line = test; return; }
      if (line) lines.push(line);
      line = '';
      Array.from(word).forEach(function (ch) {
        if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ''; }
        line += ch;
      });
    });
    if (line) lines.push(line);
    return lines;
  }

  // 지정한 줄 수 안에 들어갈 때까지 글자 크기를 줄인다.
  function fit(ctx, text, maxWidth, size, minSize, maxLines) {
    var lines;
    for (; size >= minSize; size -= 2) {
      ctx.font = font(size);
      lines = wrap(ctx, text, maxWidth);
      if (lines.length <= maxLines) break;
    }
    size = Math.max(size, minSize);
    ctx.font = font(size);
    return { size: size, lines: wrap(ctx, text, maxWidth).slice(0, maxLines) };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCentered(ctx, parts, y) {
    // parts: [{text, color}] — 한 줄에 색을 나눠 가운데 정렬
    var total = parts.reduce(function (s, p) { return s + ctx.measureText(p.text).width; }, 0);
    var x = (W - total) / 2;
    ctx.textAlign = 'left';
    parts.forEach(function (p) {
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
      x += ctx.measureText(p.text).width;
    });
  }

  function drawChips(ctx, chips, y) {
    var size = 30, padX = 22, gap = 14, h = 54, widths, total;
    for (; size >= 22; size -= 2) {
      ctx.font = font(size);
      widths = chips.map(function (c) { return ctx.measureText('#' + c.text).width + padX * 2; });
      total = widths.reduce(function (a, b) { return a + b; }, 0) + gap * (chips.length - 1);
      if (total <= INNER) break;
    }
    var x = (W - total) / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    chips.forEach(function (c, i) {
      roundRect(ctx, x, y, widths[i], h, h / 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = c.color;
      ctx.stroke();
      ctx.fillStyle = c.color;
      ctx.fillText('#' + c.text, x + widths[i] / 2, y + h / 2 + 2);
      x += widths[i] + gap;
    });
    ctx.textBaseline = 'alphabetic';
    return h;
  }

  function drawBars(ctx, bars, note, y) {
    var rowH = 46, labelW = 130, valueW = 110;
    var trackX = PAD + labelW, trackW = INNER - labelW - valueW;
    bars.forEach(function (b, i) {
      var cy = y + i * rowH + rowH / 2;
      ctx.font = font(30);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(b.name, PAD, cy);
      roundRect(ctx, trackX, cy - 9, trackW, 18, 9);
      ctx.fillStyle = COLORS.line;
      ctx.fill();
      roundRect(ctx, trackX, cy - 9, Math.max(18, trackW * b.ratio), 18, 9);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(b.value, W - PAD, cy);
    });
    ctx.textBaseline = 'alphabetic';
    var h = bars.length * rowH;
    if (note) {
      ctx.font = font(24);
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(note, W / 2, y + h + 30);
      h += 40;
    }
    return h;
  }

  function quoteHeight(quotes) {
    // 문장 한 줄 + 출처 한 줄 기준. 실제 그릴 때와 같은 크기 규칙을 쓴다.
    var each = quotes.length > 1 ? 30 + 8 + 22 + 18 : 38 + 10 + 24;
    return quotes.length * each;
  }

  function drawQuotes(ctx, quotes, y) {
    var multi = quotes.length > 1;
    ctx.textAlign = 'center';
    quotes.forEach(function (q) {
      var f = fit(ctx, '“' + q.text + '”', INNER, multi ? 30 : 38, 24, 1);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(f.lines[0], W / 2, y + f.size);
      y += f.size + (multi ? 8 : 10);
      var g = fit(ctx, q.label, INNER, multi ? 22 : 24, 18, 1);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(g.lines[0], W / 2, y + g.size);
      y += g.size + (multi ? 18 : 0);
    });
  }

  function drawQR(ctx, url, x, y, size) {
    // 단축 링크라 Q 단계로 올려도 150px 안에 칸 4px가 나온다. 메신저 압축에 덜 깨진다
    var qr = root.qrcode(0, 'Q');
    qr.addData(url);
    qr.make();
    var count = qr.getModuleCount();
    var quiet = 2;
    var cell = Math.floor(size / (count + quiet * 2));
    var actual = cell * (count + quiet * 2);
    var ox = x + (size - actual) / 2 + cell * quiet;
    var oy = y + (size - actual) / 2 + cell * quiet;
    roundRect(ctx, x, y, size, size, 12);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      }
    }
  }

  // spec: { names:[{text,color}], badge, tagline, images:[src], chips:[{text,color}],
  //         bars:[{name,ratio,value,color}], barsNote, quotes:[{text,label}], url, shortUrl }
  function render(spec) {
    var allText = [TITLE, spec.badge || '', spec.tagline, spec.barsNote || '', '나도 테스트하기 →', spec.shortUrl, '#']
      .concat(spec.names.map(function (n) { return n.text; }))
      .concat(spec.chips.map(function (c) { return c.text; }))
      .concat(spec.bars.map(function (b) { return b.name + b.value; }))
      .concat(spec.quotes.map(function (q) { return q.text + q.label + '“”'; }))
      .join('');

    return Promise.all([loadFonts(allText), Promise.all(spec.images.map(loadImage))]).then(function (res) {
      var images = res[1];
      var canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext('2d');

      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);
      roundRect(ctx, 28, 28, W - 56, H - 56, 28);
      ctx.fillStyle = COLORS.paper;
      ctx.fill();

      var y = PAD;
      ctx.textAlign = 'center';
      ctx.font = font(30);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(TITLE, W / 2, y + 30);
      y += 30 + 26;

      if (spec.badge) {
        ctx.font = font(24);
        var bw = ctx.measureText(spec.badge).width + 36;
        roundRect(ctx, (W - bw) / 2, y, bw, 40, 20);
        ctx.fillStyle = COLORS.ink;
        ctx.fill();
        ctx.fillStyle = COLORS.paper;
        ctx.textBaseline = 'middle';
        ctx.fillText(spec.badge, W / 2, y + 21);
        ctx.textBaseline = 'alphabetic';
        y += 40 + 10;
      }

      var nameSize = spec.names.length > 1 ? 64 : 76;
      ctx.font = font(nameSize);
      var nameParts = [];
      spec.names.forEach(function (n, i) {
        if (i) nameParts.push({ text: ' · ', color: COLORS.muted });
        nameParts.push(n);
      });
      drawCentered(ctx, nameParts, y + nameSize);
      y += nameSize + 14;

      var tag = fit(ctx, spec.tagline, INNER, 34, 26, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(tag.lines[0], W / 2, y + tag.size);
      y += tag.size + 30;

      // 일러스트는 아래 요소 높이를 먼저 계산하고 남는 공간에 맞춘다.
      var below = 28 + 54 + 32 + spec.bars.length * 46 + (spec.barsNote ? 40 : 0) + 32 + quoteHeight(spec.quotes) + 40;
      var avail = FOOTER_TOP - y - below;
      var n = images.length;
      var gap = n > 1 ? 24 : 0;
      var size = Math.min(n === 1 ? 480 : n === 2 ? 440 : 290, avail, (INNER - gap * (n - 1)) / n);
      var x = (W - (size * n + gap * (n - 1))) / 2;
      // 가로 폭 때문에 일러스트가 작아지면(균형형) 남는 높이를 일러스트 위아래로 나눈다.
      var spare = Math.max(0, avail - size) / 2;
      y += spare;
      images.forEach(function (img) {
        ctx.save();
        roundRect(ctx, x, y, size, size, 24);
        ctx.clip();
        ctx.drawImage(img, x, y, size, size);
        ctx.restore();
        x += size + gap;
      });
      y += size + 28 + spare;

      y += drawChips(ctx, spec.chips, y) + 32;
      y += drawBars(ctx, spec.bars, spec.barsNote, y) + 32;
      drawQuotes(ctx, spec.quotes, y);

      // 하단: 안내, 짧은 주소, QR
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, FOOTER_TOP - 20);
      ctx.lineTo(W - PAD, FOOTER_TOP - 20);
      ctx.stroke();
      var qrSize = 150;
      drawQR(ctx, spec.url, W - PAD - qrSize, FOOTER_TOP, qrSize);
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.ink;
      ctx.font = font(38);
      ctx.fillText('나도 테스트하기 →', PAD, FOOTER_TOP + 66);
      var u = fit(ctx, spec.shortUrl, INNER - qrSize - 30, 24, 16, 1);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(u.lines[0], PAD, FOOTER_TOP + 66 + 26 + u.size);

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('PNG 생성 실패'));
        }, 'image/png');
      });
    });
  }

  root.ClergyShareCard = { render: render, WIDTH: W, HEIGHT: H };
})(window);
