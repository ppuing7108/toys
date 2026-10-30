// 셔플·채점·비율·분류·결과 해시. DOM에 의존하지 않아 jsc 테스트에서도 그대로 불러온다.
(function (root) {
  'use strict';

  var TYPES = ['P', 'C', 'M'];
  var TOTAL = 120;
  var MAX_SCORE = 80; // 20문항 × 보기 최대 4점
  var CLOSE_GAP = 6; // 원점수 6점 = 5%p. 표시용 반올림과 무관하게 판정한다.
  var HASH_VERSION = 1;

  function shuffle(arr, rand) {
    rand = rand || Math.random;
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // 문항 배열과 각 문항의 보기 배열을 독립적으로 섞는다. 응답은 ID로만 연결한다.
  function buildOrder(questions, rand) {
    return shuffle(questions, rand).map(function (q) {
      return {
        qid: q.id,
        optionIds: shuffle(q.options.map(function (o) { return o.id; }), rand)
      };
    });
  }

  // answers: { 문항 ID: 보기 ID }. 전체 응답에서 매번 다시 계산하므로 답을 바꿔도 중복 가산이 없다.
  function score(questions, answers) {
    var sum = { P: 0, C: 0, M: 0 };
    questions.forEach(function (q) {
      var optionId = answers[q.id];
      var option = q.options.filter(function (o) { return o.id === optionId; })[0];
      if (!option) throw new Error('응답 누락 또는 잘못된 보기: ' + q.id);
      TYPES.forEach(function (t, i) { sum[t] += option.weights[i]; });
    });
    return sum;
  }

  // 정수 비율. 합 100, 같은 원점수는 같은 퍼센트.
  // 그 조건에서 정확한 비율과의 절대 오차 합 → 제곱 오차 합 → 점수가 높은 쪽 값이 작은 벡터 순으로 고른다.
  // 세 유형이 모두 40점이면 조건을 만족하는 해가 없으므로 null(균형형 예외)을 반환한다.
  function percents(scores) {
    var exact = TYPES.map(function (t) { return scores[t] * 100 / TOTAL; });
    var raw = TYPES.map(function (t) { return scores[t]; });
    var byScoreDesc = [0, 1, 2].sort(function (a, b) { return raw[b] - raw[a]; });
    var best = null;

    for (var p = 0; p <= 100; p++) {
      for (var c = 0; c <= 100 - p; c++) {
        var v = [p, c, 100 - p - c];
        if (!sameScoreSamePercent(raw, v)) continue;
        var abs = 0, sq = 0;
        for (var i = 0; i < 3; i++) {
          var d = v[i] - exact[i];
          abs += Math.abs(d);
          sq += d * d;
        }
        var cand = { v: v, abs: abs, sq: sq };
        if (!best || isBetter(cand, best, byScoreDesc)) best = cand;
      }
    }
    if (!best) return null;
    return { P: best.v[0], C: best.v[1], M: best.v[2] };
  }

  function sameScoreSamePercent(raw, v) {
    for (var i = 0; i < 3; i++) {
      for (var j = i + 1; j < 3; j++) {
        if (raw[i] === raw[j] && v[i] !== v[j]) return false;
      }
    }
    return true;
  }

  var EPS = 1e-9;
  function isBetter(a, b, byScoreDesc) {
    if (a.abs < b.abs - EPS) return true;
    if (a.abs > b.abs + EPS) return false;
    if (a.sq < b.sq - EPS) return true;
    if (a.sq > b.sq + EPS) return false;
    for (var k = 0; k < 3; k++) {
      var i = byScoreDesc[k];
      if (a.v[i] !== b.v[i]) return a.v[i] < b.v[i];
    }
    return false;
  }

  // kind: single(단독 1·2위) / single-even(2·3위 동점) / tie2(공동 1위) / balanced(세 유형 동점)
  // types는 항상 P→C→M 표기 순서이며 우선순위를 뜻하지 않는다.
  function classify(scores) {
    var max = Math.max(scores.P, scores.C, scores.M);
    var top = TYPES.filter(function (t) { return scores[t] === max; });
    var result = { scores: scores, percents: percents(scores), types: top, close: false };

    if (top.length === 3) {
      result.kind = 'balanced';
      return result;
    }
    if (top.length === 2) {
      result.kind = 'tie2';
      return result;
    }

    var primary = top[0];
    var rest = TYPES.filter(function (t) { return t !== primary; });
    var second = Math.max(scores[rest[0]], scores[rest[1]]);
    result.primary = primary;
    result.close = max - second <= CLOSE_GAP;

    if (scores[rest[0]] === scores[rest[1]]) {
      result.kind = 'single-even';
      result.evens = rest;
    } else {
      result.kind = 'single';
      result.secondary = scores[rest[0]] > scores[rest[1]] ? rest[0] : rest[1];
    }
    return result;
  }

  function encodeHash(scores) {
    return 'v=' + HASH_VERSION + '&p=' + scores.P + '&c=' + scores.C + '&m=' + scores.M;
  }

  // 잘못된 값은 모두 null. 호출하는 쪽은 null이면 소개 화면에서 시작한다.
  function decodeHash(hash) {
    if (typeof hash !== 'string') return null;
    var body = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (!body) return null;
    var params = {};
    var parts = body.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length !== 2 || !/^\d{1,3}$/.test(kv[1])) return null;
      if (Object.prototype.hasOwnProperty.call(params, kv[0])) return null;
      params[kv[0]] = Number(kv[1]);
    }
    var keys = Object.keys(params).sort().join(',');
    if (keys !== 'c,m,p,v' || params.v !== HASH_VERSION) return null;
    var scores = { P: params.p, C: params.c, M: params.m };
    for (var t = 0; t < 3; t++) {
      if (scores[TYPES[t]] > MAX_SCORE) return null;
    }
    if (scores.P + scores.C + scores.M !== TOTAL) return null;
    return scores;
  }

  root.ClergyScoring = {
    TYPES: TYPES,
    TOTAL: TOTAL,
    CLOSE_GAP: CLOSE_GAP,
    shuffle: shuffle,
    buildOrder: buildOrder,
    score: score,
    percents: percents,
    classify: classify,
    encodeHash: encodeHash,
    decodeHash: decodeHash
  };
})(typeof window !== 'undefined' ? window : globalThis);
