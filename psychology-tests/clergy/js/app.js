// 화면 흐름: 소개 → 20문항 → 결과. 공유 링크(#v=1&p=..&c=..&m=..)로 들어오면 결과부터 보여 준다.
(function () {
  'use strict';

  var S = window.ClergyScoring;
  var TYPES = S.TYPES;
  var TRANSITION_MS = 220;
  var MILESTONES = { 5: '벌써 4분의 1 왔어요', 10: '절반 지났어요', 15: '거의 다 왔어요' };
  var TYPE_COLOR = { P: '#B46B2D', C: '#854653', M: '#4F7567' };
  var ALT = {
    P: '나무 아래 긴 식탁에서 사람들을 반갑게 맞이하며 머그잔을 건네는 목사 일러스트',
    C: '돌 아치가 있는 조용한 안뜰에서 화초에 물을 주며 벤치에서 쉬는 방문객을 돌보는 신부 일러스트',
    M: '소나무 아래 계곡 물가 바위에 앉아 흘러가는 나뭇잎을 바라보는 스님 일러스트'
  };
  var SHARE_TITLE = '나는 목사일까, 신부일까, 스님일까?';

  var els = {};
  var data = { questions: [], byId: {}, results: null };
  var state = {
    order: [],
    index: 0,
    answers: {},
    busy: false,
    result: null,
    shared: false,
    card: { status: 'idle', blob: null, file: null, url: null, token: 0 }
  };

  // ---------- 유틸 ----------

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 받침 유무에 따라 조사를 고른다. 예: josa('목사형', '과', '와') → '목사형과'
  function josa(word, withFinal, withoutFinal) {
    var code = word.charCodeAt(word.length - 1) - 0xAC00;
    var hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
    return word + (hasFinal ? withFinal : withoutFinal);
  }

  function name(t) { return data.results[t].name; }
  function imageSrc(t) { return data.results[t].image.replace(/\.png$/, '.jpg'); }

  var toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 2600);
  }

  function showScreen(id) {
    ['intro', 'quiz', 'result'].forEach(function (s) { $(s).hidden = s !== id; });
    var el = $(id);
    el.classList.remove('enter');
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add('enter');
    window.scrollTo(0, 0);
  }

  // 해시는 리다이렉트를 거쳐도 브라우저가 유지하므로 단축 링크 뒤에 그대로 붙인다.
  // 로컬에서는 운영 사이트로 넘어가지 않게 배포 사이트에서만 쓴다.
  function shareShortUrl() {
    var meta = document.querySelector('meta[name="share-short-url"]');
    return meta && /\.github\.io$/.test(location.hostname) ? meta.content : '';
  }
  function baseUrl() { return shareShortUrl() || location.origin + location.pathname; }
  function resultUrl(scores) { return baseUrl() + '#' + S.encodeHash(scores); }
  function shortUrl() {
    var short = shareShortUrl();
    if (short) return short.replace(/^https?:\/\//, '');
    return location.host + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '');
  }

  function clearHash() {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  // ---------- 시작 ----------

  function init() {
    els.start = $('start');
    els.toast = $('toast');
    els.question = $('question');
    els.options = $('options');
    els.prev = $('prev');
    els.progressText = $('progress-text');
    els.progressBar = $('progress-bar');
    els.progressFill = $('progress-fill');
    els.milestone = $('milestone');
    els.result = $('result');

    els.start.addEventListener('click', startQuiz);
    els.prev.addEventListener('click', prevQuestion);
    window.addEventListener('hashchange', function () {
      var scores = S.decodeHash(location.hash);
      if (scores) showResult(S.classify(scores), true);
    });

    Promise.all([
      fetch('data/questions.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/results.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    ]).then(function (res) {
      data.questions = res[0].questions;
      data.questions.forEach(function (q) { data.byId[q.id] = q; });
      data.results = res[1];
      els.start.disabled = false;
      els.start.textContent = '테스트 시작하기';

      var scores = S.decodeHash(location.hash);
      if (scores) {
        showResult(S.classify(scores), true);
      } else {
        clearHash(); // 잘못된 해시는 조용히 지우고 소개 화면에서 시작
      }
    }).catch(function () {
      els.start.textContent = '불러오지 못했어요';
      $('load-error').hidden = false;
    });
  }

  function startQuiz() {
    clearHash();
    state.order = S.buildOrder(data.questions);
    state.answers = {};
    state.index = 0;
    state.result = null;
    state.shared = false;
    state.busy = false;
    els.milestone.textContent = '';
    showScreen('quiz');
    renderQuestion();
  }

  // ---------- 문항 ----------

  function renderQuestion() {
    var entry = state.order[state.index];
    var q = data.byId[entry.qid];
    var total = state.order.length;
    var n = state.index + 1;

    els.progressText.textContent = n + ' / ' + total;
    els.progressBar.setAttribute('aria-valuenow', String(n));
    els.progressBar.setAttribute('aria-valuetext', n + '번째 문항, 전체 ' + total + '문항');
    els.progressFill.style.width = (n / total * 100) + '%';
    els.question.textContent = q.text;
    els.prev.hidden = state.index === 0;

    els.options.innerHTML = '';
    entry.optionIds.forEach(function (oid) {
      var option = q.options.filter(function (o) { return o.id === oid; })[0];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.textContent = option.text;
      btn.setAttribute('aria-pressed', state.answers[q.id] === oid ? 'true' : 'false');
      btn.addEventListener('click', function () { choose(q.id, oid, btn); });
      els.options.appendChild(btn);
    });

    els.question.focus({ preventScroll: true });
  }

  function choose(qid, oid, btn) {
    if (state.busy) return;
    state.busy = true;
    state.answers[qid] = oid; // ID 기준 덮어쓰기: 답을 바꿔도 중복 가산 없음
    Array.prototype.forEach.call(els.options.children, function (b) {
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });

    setTimeout(function () {
      state.busy = false;
      if (state.index === state.order.length - 1) {
        finishQuiz();
        return;
      }
      state.index++;
      showMilestone(state.index);
      renderQuestion();
      window.scrollTo(0, 0);
    }, TRANSITION_MS);
  }

  var milestoneTimer;
  function showMilestone(answeredCount) {
    var msg = MILESTONES[answeredCount];
    clearTimeout(milestoneTimer);
    els.milestone.classList.remove('fade');
    els.milestone.textContent = msg || '';
    if (!msg) return;
    milestoneTimer = setTimeout(function () { els.milestone.classList.add('fade'); }, 1500);
  }

  function prevQuestion() {
    if (state.busy || state.index === 0) return;
    state.index--;
    els.milestone.textContent = '';
    renderQuestion();
  }

  function finishQuiz() {
    var scores = S.score(data.questions, state.answers);
    showResult(S.classify(scores), false);
  }

  // ---------- 결과 ----------

  function showResult(result, shared) {
    state.result = result;
    state.shared = shared;
    els.result.innerHTML = resultHtml(result, shared);
    bindResult();
    showScreen('result');
    $('result-title').focus({ preventScroll: true });
    makeCard();
  }

  function figure(t, withCaption) {
    return '<figure><img src="' + imageSrc(t) + '" alt="' + esc(ALT[t]) + '" width="1080" height="1080">' +
      (withCaption ? '<figcaption class="t-' + t + '">' + esc(name(t)) + '</figcaption>' : '') + '</figure>';
  }

  function chips(list) {
    return '<ul class="keywords">' + list.map(function (k) {
      return '<li class="t-' + k.t + '">#' + esc(k.text) + '</li>';
    }).join('') + '</ul>';
  }

  function keywordsOf(t, count) {
    return data.results[t].keywords.slice(0, count).map(function (k) { return { t: t, text: k }; });
  }

  function barsHtml(result) {
    var balanced = result.kind === 'balanced';
    var rows = TYPES.map(function (t) {
      var value = balanced ? '40점' : result.percents[t] + '%';
      var width = balanced ? 100 / 3 : result.percents[t];
      return '<div class="bar-row"><dt class="t-' + t + '">' + esc(name(t)) + '</dt>' +
        '<dd><div class="bar-track"><div class="bar-fill" style="width:' + width + '%;background:' + TYPE_COLOR[t] + '"></div></div></dd>' +
        '<dd class="bar-value">' + value + '</dd></div>';
    }).join('');
    var note = balanced
      ? '세 성향 모두 40점 · 각각 3분의 1이에요. '
      : '';
    note += '이 테스트 안에서의 상대적인 성향이에요. 종교 적합도나 실제 성직자의 성격을 뜻하지 않아요.';
    var close = '';
    if (result.close) {
      var others = result.kind === 'single-even'
        ? result.evens.map(name).join('·')
        : name(result.secondary);
      var heading = result.kind === 'single-even' ? '세 성향이 서로 가까워요.' : '두 성향이 가까워요.';
      close = '<p class="close-note"><strong>' + heading + '</strong> ' +
        esc(josa(name(result.primary), '과', '와')) + ' ' + esc(others) + ' 점수 차이가 크지 않아요.</p>';
    }
    return '<dl class="bars" aria-label="세 성향 비율">' + rows + '</dl><p class="bars-note">' + note + '</p>' + close;
  }

  function philosophyHtml(t, compact) {
    var ph = data.results[t].philosophy;
    var source = '<p class="reflection-source">' + esc(ph.reflectionLabel) +
      ' · <a href="' + esc(ph.source) + '" target="_blank" rel="noopener">근거 원문</a></p>';
    if (compact) {
      return '<div class="type-block"><h3><span class="t-' + t + '">' + esc(name(t)) + '</span> · ' + esc(ph.heading) + '</h3>' +
        '<blockquote class="reflection">' + esc(ph.reflection) + '</blockquote>' + source + '</div>';
    }
    return '<div class="type-block"><h3>' + esc(ph.heading) + '</h3><p>' + esc(ph.body) + '</p>' +
      '<p class="label">나에게 건네는 한 문장</p>' +
      '<blockquote class="reflection">' + esc(ph.reflection) + '</blockquote>' + source + '</div>';
  }

  function strengthsHtml(t, withName) {
    var r = data.results[t];
    return '<div class="type-block">' + (withName ? '<h3 class="t-' + t + '">' + esc(r.name) + '</h3>' : '') +
      '<p><span class="label">잘하는 것</span>' + esc(r.strength) + '</p>' +
      '<p><span class="label">피곤해지는 순간</span>' + esc(r.watchOut) + '</p></div>';
  }

  function resultHtml(result, shared) {
    var R = data.results;
    var kind = result.kind;
    var h = '';

    h += '<p class="result-eyebrow">' + (shared ? '친구가 공유한 결과예요' : '나의 결과') + '</p>';

    // 1–2. 유형명과 별명
    if (kind === 'tie2') {
      var a = result.types[0], b = result.types[1];
      h += '<span class="badge">공동 1위</span>';
      h += '<h1 id="result-title" class="result-title" tabindex="-1"><span class="t-' + a + '">' + esc(name(a)) +
        '</span><span class="and">·</span><span class="t-' + b + '">' + esc(name(b)) + '</span></h1>';
      h += '<p class="result-subtitle">두 성향이 같은 점수로 함께 1위예요</p>';
    } else if (kind === 'balanced') {
      h += '<h1 id="result-title" class="result-title" tabindex="-1">' + esc(R.balanced.name) + '</h1>';
      h += '<p class="result-subtitle">' + esc(R.balanced.tagline) + '</p>';
    } else {
      var p = result.primary;
      h += '<h1 id="result-title" class="result-title t-' + p + '" tabindex="-1">' + esc(name(p)) + '</h1>';
      h += '<p class="result-subtitle">' + esc(R[p].title) + '</p>';
      h += '<p class="result-tagline">' + esc(R[p].tagline) + '</p>';
    }

    // 3–6. 핵심 카드
    h += '<div class="core">';
    if (kind === 'tie2') {
      h += '<div class="art n2">' + result.types.map(function (t) { return figure(t, true); }).join('') + '</div>';
      h += chips(keywordsOf(result.types[0], 3).concat(keywordsOf(result.types[1], 3)));
      var lastTitle = R[result.types[1]].title;
      var particle = josa(lastTitle, '이', '가').slice(lastTitle.length);
      h += '<p class="lead">' + esc(name(result.types[0])) + '의 ‘' + esc(R[result.types[0]].title) + '’, ' +
        esc(name(result.types[1])) + '의 ‘' + esc(lastTitle) + '’' + particle + ' 같은 무게로 함께 나타났어요.</p>';
    } else if (kind === 'balanced') {
      h += '<div class="art n3">' + TYPES.map(function (t) { return figure(t, true); }).join('') + '</div>';
      h += chips(TYPES.map(function (t) { return keywordsOf(t, 1)[0]; }));
      h += '<p class="lead">' + esc(R.balanced.description) + '</p>';
    } else {
      h += '<div class="art">' + figure(result.primary, false) + '</div>';
      h += chips(keywordsOf(result.primary, 3));
      h += '<p class="lead">' + esc(R[result.primary].description) + '</p>';
    }
    h += barsHtml(result);
    h += '</div>';

    // 7–10. 해설
    h += '<div class="details">';
    if (kind === 'tie2') {
      h += '<section><h2>두 성향 살펴보기</h2>' + result.types.map(function (t) {
        return '<div class="type-block"><h3 class="t-' + t + '">' + esc(name(t)) + ' · ' + esc(R[t].title) + '</h3><p>' + esc(R[t].description) + '</p></div>';
      }).join('') + '</section>';
      h += '<section><h2>잘하는 것과 피곤해지는 순간</h2>' + result.types.map(function (t) { return strengthsHtml(t, true); }).join('') + '</section>';
      h += '<section><h2>나와 닮은 사상</h2>' + result.types.map(function (t) { return philosophyHtml(t, false); }).join('') + '</section>';
      h += '<section><h2>오늘의 작은 실천</h2>' + result.types.map(function (t) {
        return '<p><span class="label t-' + t + '">' + esc(name(t)) + '</span>' + esc(R[t].practice) + '</p>';
      }).join('') + '</section>';
    } else if (kind === 'balanced') {
      h += '<section><h2>나와 닮은 사상</h2>' + TYPES.map(function (t) { return philosophyHtml(t, true); }).join('') + '</section>';
      h += '<section><h2>오늘의 작은 실천</h2><p>' + esc(R.balanced.practice) + '</p></section>';
    } else {
      var pr = result.primary;
      h += '<section><h2>잘하는 것과 피곤해지는 순간</h2>' + strengthsHtml(pr, false) + '</section>';
      h += '<section><h2>나와 닮은 사상</h2>' + philosophyHtml(pr, false) + '</section>';
      h += '<section><h2>2위 성향이 더해진 모습</h2>';
      if (kind === 'single') {
        h += '<p class="result-tagline">2위 · ' + esc(name(result.secondary)) + '</p>' +
          '<p class="lead">' + esc(R[pr].secondary[result.secondary]) + '</p>';
      } else {
        h += '<p class="result-tagline">2위 동점 · ' + esc(result.evens.map(name).join('·')) + '</p>' +
          '<p class="lead">' + esc(josa(name(result.evens[0]), '과', '와')) + ' ' + esc(name(result.evens[1])) +
          ' 성향이 고르게 함께하는 ' + esc(name(pr)) + '</p>';
      }
      h += '</section>';
      h += '<section><h2>오늘의 작은 실천</h2><p>' + esc(R[pr].practice) + '</p></section>';
    }

    // 11. 공유
    h += '<section class="share" aria-label="결과 공유"><h2>' + (shared ? '나도 해 보기' : '결과 공유하기') + '</h2>';
    h += '<div class="share-actions">';
    if (shared) {
      h += '<button id="restart" class="btn btn-primary" type="button">나도 테스트하기</button>';
    } else if (navigator.share) {
      h += '<button id="share" class="btn btn-primary" type="button" disabled>이미지 준비 중…</button>';
    }
    h += '<button id="save" class="btn" type="button" disabled>이미지 저장</button>';
    h += '<button id="copy" class="btn" type="button">링크 복사</button>';
    if (!shared) h += '<button id="restart" class="btn btn-ghost wide" type="button">다시 하기</button>';
    h += '</div>';
    h += '<p id="share-status" class="share-status" aria-live="polite">공유 이미지를 만드는 중이에요…</p>';
    h += '<div id="copy-fallback" class="copy-fallback" hidden><label for="copy-input">이 주소를 길게 눌러 직접 복사해 주세요</label>' +
      '<input id="copy-input" type="text" readonly></div>';
    h += '<figure id="card-preview" class="card-preview" hidden><img id="card-img" alt="공유용 결과 이미지 미리보기">' +
      '<figcaption>저장이 안 되면 이미지를 길게 눌러 저장하세요</figcaption></figure>';
    h += '</section></div>';
    return h;
  }

  function bindResult() {
    $('restart').addEventListener('click', startQuiz);
    $('copy').addEventListener('click', copyLink);
    $('save').addEventListener('click', saveImage);
    if ($('share')) $('share').addEventListener('click', shareResult);
  }

  // ---------- 공유 카드 ----------

  function cardSpec(result) {
    var R = data.results;
    var url = resultUrl(result.scores);
    var bars = TYPES.map(function (t) {
      return result.kind === 'balanced'
        ? { name: name(t), ratio: 1 / 3, value: '40점', color: TYPE_COLOR[t] }
        : { name: name(t), ratio: result.percents[t] / 100, value: result.percents[t] + '%', color: TYPE_COLOR[t] };
    });
    var quote = function (t) { return { text: R[t].philosophy.reflection, label: R[t].philosophy.reflectionLabel }; };
    var spec = { url: url, shortUrl: shortUrl(), bars: bars };

    if (result.kind === 'tie2') {
      spec.badge = '공동 1위';
      spec.names = result.types.map(function (t) { return { text: name(t), color: TYPE_COLOR[t] }; });
      spec.tagline = '두 성향이 같은 점수로 함께 1위예요';
      spec.images = result.types.map(imageSrc);
      spec.chips = [].concat(keywordsOf(result.types[0], 2), keywordsOf(result.types[1], 2))
        .map(function (k) { return { text: k.text, color: TYPE_COLOR[k.t] }; });
      spec.quotes = result.types.map(quote);
    } else if (result.kind === 'balanced') {
      spec.names = [{ text: R.balanced.name, color: '#24343B' }];
      spec.tagline = R.balanced.tagline;
      spec.images = TYPES.map(imageSrc);
      spec.chips = TYPES.map(function (t) { return { text: R[t].keywords[0], color: TYPE_COLOR[t] }; });
      spec.barsNote = '세 성향 모두 40점 · 각각 3분의 1';
      spec.quotes = [{ text: R.balanced.practice, label: '오늘의 작은 실천' }];
    } else {
      var p = result.primary;
      spec.names = [{ text: name(p), color: TYPE_COLOR[p] }];
      spec.tagline = R[p].tagline;
      spec.images = [imageSrc(p)];
      spec.chips = R[p].keywords.map(function (k) { return { text: k, color: TYPE_COLOR[p] }; });
      spec.quotes = [quote(p)];
    }
    return spec;
  }

  function fileName(result) {
    var slug = { P: 'pastor', C: 'priest', M: 'monk' };
    if (result.kind === 'balanced') return 'clergy-balanced.png';
    if (result.kind === 'tie2') return 'clergy-' + result.types.map(function (t) { return slug[t]; }).join('-') + '.png';
    return 'clergy-' + slug[result.primary] + '.png';
  }

  function makeCard() {
    var card = state.card;
    var token = ++card.token;
    if (card.url) URL.revokeObjectURL(card.url);
    card.status = 'rendering';
    card.blob = card.file = card.url = null;
    setShareStatus('공유 이미지를 만드는 중이에요…');

    window.ClergyShareCard.render(cardSpec(state.result)).then(function (blob) {
      if (token !== card.token) return; // 그 사이 다른 결과로 바뀜
      card.status = 'ready';
      card.blob = blob;
      card.file = new File([blob], fileName(state.result), { type: 'image/png' });
      card.url = URL.createObjectURL(blob);
      $('card-img').src = card.url;
      $('card-preview').hidden = false;
      $('save').disabled = false;
      var share = $('share');
      if (share) { share.disabled = false; share.textContent = '결과 공유하기'; }
      setShareStatus('');
    }).catch(function () {
      if (token !== card.token) return;
      card.status = 'error';
      var share = $('share');
      // 이미지 없이 링크만이라도 공유할 수 있게 둔다.
      if (share) { share.disabled = false; share.textContent = '링크 공유하기'; }
      setShareStatus('이미지를 만들지 못했어요.', true);
    });
  }

  function setShareStatus(msg, withRetry) {
    var el = $('share-status');
    if (!el) return;
    el.textContent = msg;
    if (withRetry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.textContent = '이미지 다시 만들기';
      btn.addEventListener('click', makeCard);
      el.appendChild(btn);
    }
  }

  function shareText() {
    var r = state.result;
    var label = r.kind === 'balanced' ? data.results.balanced.name
      : r.kind === 'tie2' ? r.types.map(name).join('·') + ' 공동 1위'
      : name(r.primary);
    return '나의 결과는 ' + label + '! 나는 목사일까, 신부일까, 스님일까?';
  }

  function shareResult() {
    var card = state.card;
    var url = resultUrl(state.result.scores);
    var payload = { title: SHARE_TITLE, text: shareText(), url: url };
    if (card.file && navigator.canShare && navigator.canShare({ files: [card.file] })) {
      payload.files = [card.file];
    }
    navigator.share(payload).then(function () {
      toast('공유 창을 열었어요');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return; // 사용자가 취소
      // 자동 재시도하지 않고 다른 방법을 안내한다.
      toast('공유를 열지 못했어요. 이미지 저장이나 링크 복사를 이용해 주세요');
    });
  }

  function saveImage() {
    var card = state.card;
    if (card.status !== 'ready') return;
    var a = document.createElement('a');
    a.href = card.url;
    a.download = card.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('저장되지 않았다면 아래 미리보기를 길게 눌러 저장하세요');
  }

  function copyLink() {
    var url = resultUrl(state.result.scores);
    var fallback = function () {
      var box = $('copy-fallback');
      var input = $('copy-input');
      input.value = url;
      box.hidden = false;
      input.focus();
      input.select();
    };
    if (!navigator.clipboard || !window.isSecureContext) { fallback(); return; }
    navigator.clipboard.writeText(url).then(function () {
      toast('링크를 복사했어요');
    }, fallback);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
