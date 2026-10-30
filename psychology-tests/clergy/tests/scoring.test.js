// 실행: cd psychology-tests/clergy && /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/scoring.test.js
load('js/scoring.js');
var S = globalThis.ClergyScoring;
var questions = JSON.parse(readFile('data/questions.json')).questions;
var results = JSON.parse(readFile('data/results.json'));

var failed = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  print('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function seeded(seed) {
  return function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// 데이터
check('20문항', questions.length === 20);
var ids = {};
var expected = [0, 0, 0];
questions.forEach(function (q) {
  check(q.id + ' 보기 4개', q.options.length === 4);
  check(q.id + ' ID 중복 없음', !ids[q.id]);
  ids[q.id] = true;
  q.options.forEach(function (o) {
    check(o.id + ' ID 중복 없음', !ids[o.id]);
    ids[o.id] = true;
    check(o.id + ' 점수 합 6', o.weights[0] + o.weights[1] + o.weights[2] === 6);
    for (var i = 0; i < 3; i++) expected[i] += o.weights[i] / 4;
  });
});
check('균등 선택 기대점수 40/40/40', eq(expected, [40, 40, 40]), expected);
['P', 'C', 'M'].forEach(function (t) {
  check('결과 문구 ' + t, results[t] && results[t].keywords.length === 3 && results[t].philosophy.source);
});
check('균형형 문구', results.balanced && results.balanced.description && results.balanced.practice);

// 셔플
var arr = [0, 1, 2, 3, 4, 5, 6, 7];
check('같은 시드 같은 셔플', eq(S.shuffle(arr, seeded(7)), S.shuffle(arr, seeded(7))));
check('원본 불변', eq(arr, [0, 1, 2, 3, 4, 5, 6, 7]));
check('원소 보존', eq(S.shuffle(arr, seeded(3)).slice().sort(), arr));
var counts = [0, 0, 0, 0];
var rand = seeded(42);
for (var n = 0; n < 40000; n++) counts[S.shuffle([0, 1, 2, 3], rand).indexOf(0)]++;
check('셔플 위치 균등(±3%)', counts.every(function (c) { return Math.abs(c - 10000) < 300; }), counts);

var order = S.buildOrder(questions, seeded(9));
check('buildOrder 20문항', order.length === 20);
check('buildOrder 보기 4개씩', order.every(function (o) { return o.optionIds.length === 4; }));
check('buildOrder 문항 보존', eq(order.map(function (o) { return o.qid; }).sort(), questions.map(function (q) { return q.id; }).sort()));

// 채점: 순서 불변, 덮어쓰기
function randomAnswers(r) {
  var a = {};
  questions.forEach(function (q) { a[q.id] = q.options[Math.floor(r() * 4)].id; });
  return a;
}
var r2 = seeded(11);
for (var k = 0; k < 200; k++) {
  var answers = randomAnswers(r2);
  var s1 = S.score(questions, answers);
  var reordered = S.buildOrder(questions, r2).map(function (o) {
    return questions.filter(function (q) { return q.id === o.qid; })[0];
  });
  var s2 = S.score(reordered, answers);
  if (!eq(s1, s2) || s1.P + s1.C + s1.M !== 120) { check('순서 불변·합 120', false, [s1, s2]); break; }
}
check('순서 불변·합 120', true);
var a1 = randomAnswers(seeded(5));
a1.q01 = 'q01-1';
a1.q01 = 'q01-3';
var sc = S.score(questions, a1);
check('답 바꾸기 후 합 120', sc.P + sc.C + sc.M === 120);
var missing = randomAnswers(seeded(6));
delete missing.q07;
var threw = false;
try { S.score(questions, missing); } catch (e) { threw = true; }
check('응답 누락이면 throw', threw);

// 비율
check('44/44/32 → 37/37/26', eq(S.percents({ P: 44, C: 44, M: 32 }), { P: 37, C: 37, M: 26 }), S.percents({ P: 44, C: 44, M: 32 }));
check('45/45/30 → 37/37/26', eq(S.percents({ P: 45, C: 45, M: 30 }), { P: 37, C: 37, M: 26 }), S.percents({ P: 45, C: 45, M: 30 }));
check('30/45/45 → 26/37/37 (유형 무관)', eq(S.percents({ P: 30, C: 45, M: 45 }), { P: 26, C: 37, M: 37 }));
check('50/30/40 → 42/25/33', eq(S.percents({ P: 50, C: 30, M: 40 }), { P: 42, C: 25, M: 33 }), S.percents({ P: 50, C: 30, M: 40 }));
check('40/40/40 → null (균형형 예외)', S.percents({ P: 40, C: 40, M: 40 }) === null);
var combos = 0;
for (var p = 0; p <= 80; p++) {
  for (var c = 0; c <= 80; c++) {
    var m = 120 - p - c;
    if (m < 0 || m > 80) continue;
    var sc3 = { P: p, C: c, M: m };
    var pc = S.percents(sc3);
    if (p === 40 && c === 40) { check('균형형만 null', pc === null); continue; }
    combos++;
    var ok = pc && pc.P + pc.C + pc.M === 100 &&
      // 동점이 없으면 각 값은 내림 또는 올림(오차 < 1), 동점이 있으면 같게 맞추느라 최대 1까지 허용
      ['P', 'C', 'M'].every(function (t) {
        var err = Math.abs(pc[t] - sc3[t] * 100 / 120);
        return (p !== c && c !== m && p !== m) ? err < 1 : err <= 1 + 1e-9;
      }) &&
      (p !== c || pc.P === pc.C) && (c !== m || pc.C === pc.M) && (p !== m || pc.P === pc.M);
    if (!ok) { check('비율 전수 조건', false, [sc3, pc]); }
  }
}
check('비율 전수 확인 조합 수', combos > 2000, combos);

// 분류
var r;
r = S.classify({ P: 50, C: 40, M: 30 });
check('single', r.kind === 'single' && r.primary === 'P' && r.secondary === 'C' && !r.close, r);
r = S.classify({ P: 30, C: 40, M: 50 });
check('single M', r.kind === 'single' && r.primary === 'M' && r.secondary === 'C', r);
r = S.classify({ P: 35, C: 50, M: 35 });
check('single-even', r.kind === 'single-even' && r.primary === 'C' && eq(r.evens, ['P', 'M']), r);
r = S.classify({ P: 45, C: 30, M: 45 });
check('tie2', r.kind === 'tie2' && eq(r.types, ['P', 'M']) && !r.primary, r);
r = S.classify({ P: 40, C: 40, M: 40 });
check('balanced', r.kind === 'balanced' && r.percents === null && r.types.length === 3, r);
check('close 차 6 → true', S.classify({ P: 46, C: 40, M: 34 }).close === true);
check('close 차 7 → false', S.classify({ P: 47, C: 40, M: 33 }).close === false);
check('close single-even', S.classify({ P: 44, C: 38, M: 38 }).close === true);

// 해시
check('encode', S.encodeHash({ P: 50, C: 30, M: 40 }) === 'v=1&p=50&c=30&m=40');
check('decode 정상', eq(S.decodeHash('#v=1&p=50&c=30&m=40'), { P: 50, C: 30, M: 40 }));
check('decode 키 순서 무관', eq(S.decodeHash('#m=40&v=1&c=30&p=50'), { P: 50, C: 30, M: 40 }));
['', '#', '#v=2&p=50&c=30&m=40', '#v=1&p=50.5&c=29.5&m=40', '#v=1&p=-10&c=90&m=40',
  '#v=1&p=81&c=0&m=39', '#v=1&p=50&c=30&m=39', '#v=1&p=50&c=30', '#v=1&p=50&c=30&m=40&x=1',
  '#v=1&p=50&p=50&c=30&m=40', '#v=1&p=&c=30&m=40', '#v=1&p=5e1&c=30&m=40', '#hello', null
].forEach(function (h) {
  check('decode 거부 ' + h, S.decodeHash(h) === null, S.decodeHash(h));
});

print((failed ? 'FAILED' : 'OK') + ' — ' + passed + ' passed, ' + failed + ' failed');
if (failed) throw new Error('tests failed');
