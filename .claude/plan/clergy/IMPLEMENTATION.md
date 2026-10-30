# 목사·신부·스님 테스트 구현 명세 (Claude)

`.codex/plan/clergy/DESIGN.md`·`brief.json`을 실제 코드 단위로 내린 문서다. 설계서와 충돌하면 설계서가 우선이다. 설계서에 없던 결정과 설계를 보완한 부분(본문 폰트, 동점 반올림, 가까운 결과 판정 단위)은 §9에 모았고, 2026-10-30 사용자 검토를 반영했다.

## 0. 현재 저장소 상태 점검 결과 (2026-10-30)

| 항목 | 상태 | 조치 |
| --- | --- | --- |
| `psychology-tests/clergy/data/*.json` | `.codex/plan`과 바이트 동일 | 그대로 사용 |
| `assets/*.png` (1254², 약 3MB) | 원본과 동일 | 원본 보존, 서비스에서는 쓰지 않음 |
| `assets/*.jpg` (1080², 약 500KB) | 압축본 이미 존재 | 웹·Canvas 모두 jpg 사용 |
| `vendor/qrcode-generator-1.4.4.js` | MIT, 로컬 고정 버전 | 그대로 사용 (`LICENSE` 주석 유지) |
| `shared/fonts/fonts.css` (Gowun Batang) | 400 서브셋 95개 중 70개만 존재, 700은 전부 없음 | 없는 파일을 가리키는 `@font-face` 정리. 현재 콘텐츠 글자는 모두 있는 70개 안에 들어감(확인함) |
| Noto Sans KR | 로컬 파일 없음 | §9-1 참고 |
| 루트 `index.html`, `psychology-tests/index.html` | 없음 | 새로 작성 |
| 문항 데이터 검증 | 20문항×4보기, 보기마다 합 6, 혼합 보기 PC·CM·MP 각 6개와 균형 2개, 기대점수 40/40/40 | 단위 테스트로 고정 |
| JS 실행 환경 | node 없음. macOS 내장 `jsc` 있음, 브라우저는 Safari만 | 로직 테스트는 `jsc`, 화면은 Safari와 실기기 |

## 1. 파일 구조

```
index.html                          ← 루트: psychology-tests/로 가는 목록 (새 파일)
psychology-tests/
  index.html                        ← 테스트 목록 카드 (새 파일)
  shared/fonts/…                    ← 기존 폰트 (fonts.css만 정리)
  clergy/
    index.html                      ← 화면 마크업 (intro / quiz / result 섹션 3개)
    styles.css
    js/
      scoring.js                    ← 순수 함수: 셔플·채점·비율·분류·해시 (DOM 없음)
      share-card.js                 ← Canvas 1080×1350 렌더링, QR
      app.js                        ← 상태, 화면 전환, 이벤트, 공유
    data/questions.json, results.json
    assets/*.jpg (서비스), *.png (원본 보존), og.jpg (새로 만듦, 1200×630)
    vendor/qrcode-generator-1.4.4.js
    tests/scoring.test.js           ← jsc로 실행
```

- 빌드 도구 없음. `<script defer>` 3개를 순서대로 로드한다 (ES module은 `file://`에서 막혀 로컬 확인이 번거로우므로 쓰지 않음). `scoring.js`는 `window.ClergyScoring` 하나만 노출하고, `jsc`에서도 불러올 수 있게 `globalThis`에 붙인다.
- JSON은 `fetch('data/…')`로 읽는다. 로컬 확인은 `python3 -m http.server`로 한다.
- 모든 경로는 상대 경로라서 `/toys/` 하위에서도 동작한다.

## 2. 데이터 모델과 상태

```js
state = {
  mode: 'intro' | 'quiz' | 'result',
  order: [{ qid, optionIds: [..4] }],   // 시작 시 한 번만 셔플, 진행 중 고정
  index: 0,                             // 현재 문항 위치 (0–19)
  answers: { q01: 'q01-3', … },         // 문항 ID → 보기 ID
  result: null | Result,                // 마지막 응답 이후에만 생성
  shared: false,                        // URL 해시로 복원한 결과인지
  card: { status: 'idle'|'rendering'|'ready'|'error', blob, file, url }
}
```

- 응답은 ID 기준 맵이라 답을 바꾸면 덮어쓰기만 하면 된다. 점수는 저장하지 않고 결과 시점에 `answers` 전체로 다시 계산한다 → 중복 가산이 구조적으로 생길 수 없다.
- 새로고침 시 진행 상황은 저장하지 않는다(설계 범위 밖). 필요하면 나중에 `sessionStorage`로 추가한다.

## 3. scoring.js — 순수 함수 명세

| 함수 | 입력 → 출력 | 규칙 |
| --- | --- | --- |
| `shuffle(arr, rand=Math.random)` | 새 배열 | Fisher–Yates, 원본 불변. 테스트용 시드 난수 주입 가능 |
| `buildOrder(questions, rand)` | `order` | 문항 배열과 각 보기 배열을 따로 셔플 |
| `score(questions, answers)` | `{P,C,M}` | 20개 모두 응답했을 때만 호출, 응답 누락·잘못된 ID면 throw |
| `percents(scores)` | `{P,C,M}` 정수, 합 100, 또는 `null` | §9-3. 셋 모두 40이면 `null`(균형형 예외) |
| `classify(scores)` | `Result` | 아래 표 |
| `encodeHash(scores)` | `'v=1&p=50&c=30&m=40'` | |
| `decodeHash(hash)` | `scores` 또는 `null` | `v===1`, 키 p·c·m 정확히, 각각 `^\d+$`인 0–80 정수, 합 120. 하나라도 어기면 `null` |

`Result` 분류:

| 조건 | `kind` | 화면 |
| --- | --- | --- |
| 1위 단독, 2위 단독 | `single` | 주 유형 + `secondary[2위]` 문구 |
| 1위 단독, 2·3위 동점 | `single-even` | 주 유형 + "{A}와 {B} 성향이 고르게 함께하는 {주 유형}" |
| 1위 2개 동점 | `tie2` | 공동 1위 배지, 두 유형 나란히 (P→C→M 고정 표기 순서. 순서만 정할 뿐 우선순위 아님) |
| 셋 모두 40 | `balanced` | 균형형, 세 이미지 |

추가 플래그 `close`: `kind`가 `single`/`single-even`이고 상위 두 유형의 **원점수** 차이가 6점 이하(= 반올림 전 5%p 이하)이면 "두 성향이 가까워요" 문구를 추가한다. 표시용 반올림 결과로 판정하지 않는다. 기준은 상수 `CLOSE_GAP = 6`.

## 4. 화면 명세

### 4-1. 소개 (`#intro`)
- 제목(Gowun Batang) / 부제 / "약 4~5분" / 시작 버튼 / 세 일러스트 작은 썸네일 / 하단 안내문.
- 해시가 유효하면 소개 대신 결과 화면(공유된 결과 모드)으로 시작한다.

### 4-2. 문항 (`#quiz`)
- 상단: `7 / 20` 텍스트와 진행 막대(`role="progressbar"`, `aria-valuenow`).
- 질문 `<h2 tabindex="-1">`. 전환 후 여기에 `focus()`.
- 보기 4개는 `<button>`, 최소 높이 48px, 이미 고른 보기는 `aria-pressed="true"`와 강조 표시.
- 선택 → 즉시 눌림 표시 → 220ms 뒤 다음 문항(마지막이면 결과). 전환 중 중복 클릭 막기. `prefers-reduced-motion`이면 애니메이션 없이 220ms 지연만 둔다.
- "이전" 버튼은 2번째 문항부터 표시. 돌아간 문항은 기존 선택이 표시되고, 다시 고르면 덮어쓴다.
- 5·10·15번째 응답 직후 다음 문항 상단에 짧은 문구를 1.5초 표시(진행은 막지 않음): "벌써 1/4 왔어요" / "절반 지났어요" / "거의 다 왔어요".

### 4-3. 결과 (`#result`)
설계서 §5의 11단계 순서를 그대로 따른다. 구현 메모:
- 상단 핵심 카드(1–6단계)와 해설 영역(7–10단계)을 시각적으로 나눈다.
- 비율 막대: 각 줄에 `목사형 42%` 텍스트와 막대를 함께 표시하고, 아래에 "이 테스트 안에서의 상대적 성향이에요" 안내.
- 사상 섹션: `heading`, `body`, 인용 박스(`reflection`), `reflectionLabel` + "근거 원문" 링크(`target=_blank rel=noopener`).
- `tie2`: 일러스트 2장을 같은 크기로 나란히 배치. 키워드·설명·잘하는 것·사상·실천은 유형별 블록 2개로 반복한다(P→C→M 순).
- `balanced`: 일러스트 3장(데스크톱 3열, 360px에서도 3열 정사각 유지). 문구는 §9-2 초안을 쓴다.
- 공유된 결과 모드: 상단 안내를 "친구가 공유한 결과예요"로 바꾸고, 공유 버튼 묶음 대신 큰 "나도 테스트하기" 버튼을 둔다. 저장·링크 복사는 그대로 제공.
- 다시 하기: `buildOrder`를 새로 돌리고 `answers`를 비운 뒤 해시를 지운다(`history.replaceState`).
- 하단 안내문은 모든 화면에 고정 표시한다.

## 5. 공유

### 5-1. 결과 링크
`location.origin + location.pathname + '#' + encodeHash(scores)`. 내 결과에서는 주소창을 바꾸지 않는다(새로고침 시 "공유된 결과"로 잘못 보이는 것을 막기 위함).

### 5-2. 공유 카드 생성 (share-card.js)
- 결과 화면을 그린 직후 `renderCard(result, url)`를 자동으로 실행한다.
  1. `await document.fonts.load('400 48px "Gowun Batang"', <카드에 쓸 전체 문자열>)` 후 `document.fonts.ready`
  2. 필요한 일러스트 jpg를 `new Image()`로 로드하고 `decode()`. 같은 출처라 Canvas가 오염되지 않는다.
  3. QR: `qrcode(0,'M')`에 결과 URL을 넣어 모듈을 Canvas에 직접 그린다(외부 서버 없음). 현재 URL 길이면 version 4–5 정도다.
  4. `canvas.toBlob('image/png')` → `new File([blob], 'clergy-result-<type>.png', {type})`.
- 상태 `rendering` 동안 공유·저장 버튼에 "이미지 준비 중…" 표시와 `disabled`. `error`면 "다시 만들기" 버튼.
- 레이아웃 (1080×1350, 안전 여백 72):

```
 72 ┌──────────────────────────────┐
    │ 나는 목사일까, 신부일까, 스님일까?│  테스트 제목 30px muted
    │ 목사형                         │  유형명 84px, 유형 색
    │ 단톡방에 불을 켜는 사람          │  별명 40px
    │ ┌──────────────┐               │
    │ │  일러스트 560² │  (tie2: 2×440², balanced: 3×290²)
    │ └──────────────┘               │
    │ #연결  #격려  #실행             │  키워드 칩
    │ 목사형 ███████ 42%              │  비율 막대 3줄
    │ “내가 잘하는 일이 …”            │  한 문장 + 출처 라벨 22px
    │ ───────────────────────────── │
    │ 나도 테스트하기 →   [QR 180²]   │
    │ ppuing7108.github.io/toys/…    │
1278└──────────────────────────────┘
```

- 한글 줄바꿈: Canvas에는 자동 줄바꿈이 없으므로 `measureText`로 어절(공백) 단위 줄바꿈 후 넘치면 글자 단위로 나누는 `wrapText`를 만든다. 최대 줄 수를 넘기면 글자 크기를 2px씩 줄인다(하한 있음).
- 이 PNG를 결과 화면에도 축소 미리보기로 보여 준다 → iOS에서 길게 눌러 저장하는 대안이 된다.

### 5-3. 버튼 동작

| 버튼 | 동작 |
| --- | --- |
| 결과 공유하기 | `navigator.canShare?.({files:[file]})`이면 `navigator.share({files:[file], title, text, url})`. 아니면 `navigator.share({title,text,url})`(링크만), 그것도 없으면 버튼을 숨긴다. `AbortError`는 조용히 무시하고, 다른 오류는 "공유를 열지 못했어요. 이미지 저장이나 링크 복사를 이용해 주세요" 토스트. 자동 재시도 없음 |
| 이미지 저장 | `<a download>` + `URL.createObjectURL(blob)` 클릭. 안내 문구 "저장이 안 되면 위 이미지를 길게 눌러 저장하세요" 상시 표시 |
| 링크 복사 | `navigator.clipboard.writeText`. 실패하면 읽기 전용 `<input>`에 URL을 넣고 선택 상태로 "직접 복사해 주세요" |
| 다시 하기 / 나도 테스트하기 | 4-3 참고 |

공유 성공은 "공유 창을 열었어요" 정도로만 표시한다.

### 5-4. OG
`clergy/index.html`에 공통 `og:title`, `og:description`, `og:image`(1200×630 og.jpg, 세 일러스트 가로 배치, 이미지에서 1회 생성). `og:image`는 절대 URL이 필요하므로 배포 주소로 고정한다.

## 6. 스타일

- CSS 변수: 설계 팔레트 6개 + `--paper-2`(카드 배경 #FFFDF8) + `--line`.
- 명도 대비: 유형 색을 흰/종이 배경 위 텍스트로 쓸 때 4.5:1 이상인지 확인한다(P #B46B2D는 #F6F1E8 위에서 아슬아슬할 수 있어 측정 후 필요하면 텍스트용 짙은 변형 `--P-ink`를 둔다).
- 레이아웃: `max-width:560px; margin-inline:auto; padding-inline:20px`. 일러스트는 `aspect-ratio:1; object-fit:contain`.
- `word-break: keep-all; overflow-wrap: anywhere;`로 한글 어절 단위 줄바꿈.
- 다크 모드는 설계에 없어 지원하지 않는다(`color-scheme: light` 고정).

## 7. 테스트와 검수

### 7-1. 자동 (`jsc tests/scoring.test.js`)
- 데이터: 20문항, 보기 4개, ID 중복 없음, 보기 합 6, 기대점수 40/40/40.
- 셔플: 같은 시드면 같은 결과, 원소 보존, 1만 회 셔플에서 위치 분포가 균등(카이제곱 대략치).
- 순서 불변: 같은 `answers`를 다른 `order`로 채점해도 같은 결과.
- 답 바꾸기: 같은 문항에 두 번 답해도 합계 120.
- `percents`: 0–80 범위의 모든 (p,c,m) 조합(합 120) 중 균형형 외 전부에서 합 100, 같은 원점수는 같은 퍼센트, 정확한 비율과의 오차는 동점이 없으면 1 미만·동점이 있으면 1 이하(예: `45/45/30`의 25 → 26). 대표 사례 `44/44/32 → 37/37/26`, `45/45/30 → 37/37/26`, `40/40/40 → null`.
- `close`: 원점수 차 6이면 true, 7이면 false.
- `classify`: 4가지 `kind` 대표 사례와 `close` 경계(5%p 이하/초과).
- 해시: 정상, `v=2`, 소수, 음수, 81, 합 119, 키 누락·추가, 빈 해시 → `null`.

### 7-2. 수동 (Safari + 실기기)
설계서 §10 체크리스트를 그대로 따른다. 특히 다음을 직접 확인한다.
- 4종 결과(single·single-even·tie2·balanced)를 해시로 직접 열어 화면과 카드 PNG 확인. 예: `#v=1&p=50&c=40&m=30`, `#v=1&p=50&c=35&m=35`, `#v=1&p=45&c=45&m=30`, `#v=1&p=40&c=40&m=40`
- 360px에서 문항 중 가장 긴 보기, 카드의 가장 긴 별명과 한 문장이 잘리지 않는지
- iOS Safari, Android Chrome에서 파일 공유, 취소, 저장, 복사 동작 (실기기는 사용자 확인 필요)

### 7-3. 배포 확인
push 후 `https://ppuing7108.github.io/toys/psychology-tests/clergy/`가 실제로 열리는지 `curl -I`로 확인한 뒤에만 배포 완료라고 보고한다. Pages가 꺼져 있으면 저장소 Settings → Pages에서 `main` / root를 켜야 한다(`gh` CLI가 없어 사용자 작업 필요).

## 8. 작업 순서

1. `fonts.css` 정리, 루트·목록 `index.html` 작성
2. `scoring.js` 작성과 `jsc` 테스트 통과
3. `index.html`/`styles.css`/`app.js`: 소개 → 문항 → 결과(single) 흐름
4. 결과 변형 3종(single-even, tie2, balanced)과 해시 복원
5. `share-card.js`, 공유 버튼, 미리보기
6. OG 이미지, 접근성·명도 점검
7. Safari 수동 검수 → 커밋 → push → 배포 주소 확인

## 9. 설계서를 보완하거나 새로 정한 것 (2026-10-30 사용자 검토 반영)

1. **본문 폰트 (보완)**: Noto Sans KR 파일이 없다. 웹 UI는 시스템 한글 산세리프 스택(`"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`)을 쓰고, **공유 카드는 로컬 Gowun Batang 하나로만 조판**한다. `shared/fonts/fonts.css`는 현재 clergy 외에 쓰는 페이지가 없음을 확인했고, 실제 파일이 없는 `@font-face`(400 서브셋 25개, 700 전체)를 지운다.
2. **균형형 문구** (results.json 서비스 사본에 `balanced` 키로 추가):
   - 이름: 균형형 / 별명: "세 마음을 고루 쓰는 사람"
   - 설명: "사람을 잇는 온기, 곁을 지키는 성실함, 한 발 물러나 보는 여유가 이번 응답에 고르게 나타났어요. 어느 한 성향이 두드러지기보다, 세 가지 마음 씀씀이가 비슷한 비중을 차지합니다."
   - 오늘의 작은 실천: "오늘 가장 많이 꺼내 쓴 마음이 무엇이었는지 하루 끝에 한 번 떠올려 보세요."
   - 사상 섹션: 세 유형의 `heading`, `reflection`, `reflectionLabel`(의역·창작 표시), 근거 원문 링크를 짧게 모아 보여 준다. 줄이더라도 의역·창작 표시와 출처 링크는 빼지 않는다.
   - 공유 카드의 한 문장 자리: 별명이 이미 제목 아래에 있으므로 "오늘의 작은 실천" 문구를 그 라벨과 함께 쓴다. `tie2`는 두 유형의 `reflection`과 `reflectionLabel`을 각각 작은 글씨로 표시한다.
3. **비율 반올림 (보완)**: 단순 최대 잔여법은 `45/45/30` → 38/37/25처럼 같은 점수를 다른 퍼센트로 보여 P 우선 편향을 만든다. `percents`는 다음 조건을 만족하는 정수 벡터 중 하나를 고른다.
   - 제약: 합 100, 같은 원점수는 같은 퍼센트
   - 목표: 정확한 비율(점수/120×100)과의 절대 오차 합 최소 → 같으면 제곱 오차 합 최소 → 그래도 같으면 점수가 높은 쪽 값이 작은 벡터(유형 이름이 아닌 점수로만 정하므로 유형 편향 없음)
   - 구현: 합 100인 (p,c,m) 5,151개를 전부 확인한다. 비용이 작아 정확성을 우선했다.
   - 예: `44/44/32` → 37/37/26 (36/36/28보다 오차가 작음), `45/45/30` → 37/37/26 (38/38/24와 오차가 같아 셋째 규칙 적용)
   - 균형형(40/40/40)은 제약을 만족하는 해가 없으므로 `null`을 반환하고, 화면과 카드에 "각 40점 · 각각 3분의 1"로 표시한다.
4. **가까운 결과**: 기준은 5%p를 유지하고, 원점수 차이 6점 이하로 판정한다(§3). 무작위 응답 시뮬레이션(20만 회)에서 단독 1위의 약 43%가 이 기준에 걸렸고, 공동 1위는 14.0%, 균형형은 1.5%, 2·3위 동점은 15.4%였다. 실제 빈도는 플레이테스트로 확인한다.
5. **브라우저 뒤로 가기**: 문항마다 history를 쌓지 않는다(앱 안 "이전" 버튼만). 해시 복원 화면에서 "나도 테스트하기"를 누르면 해시를 지운다.
6. **텍스트용 목사형 색**: #B46B2D는 배경 #F6F1E8 위에서 명도 대비가 3.67:1이라 본문 텍스트 기준(4.5:1)에 못 미친다. 막대·장식에는 원래 색을 쓰고, 텍스트와 버튼에는 `--P-ink: #9A5A24`(4.83:1)를 쓴다.

## 10. 구현 현황 (2026-10-30)

§8의 1–6단계 완료, 7단계는 Safari(WebKit) 자동 확인까지 완료. 커밋·push·배포 확인은 하지 않았다.

- `jsc tests/scoring.test.js`: 248개 확인 통과
- WebKit 화면 확인(Swift WKWebView 임시 하네스, 360px): 소개, 문항(가장 긴 보기), 결과 4종(single·single-even·tie2·balanced), 내 결과와 공유된 결과, 목록 페이지
- 공유 카드 4종 PNG 생성 확인. QR은 macOS CIDetector로 디코딩해 각 결과 URL과 일치함을 확인
- 20문항 전체 진행, 이전 문항 후 답 바꾸기, 전환 중 중복 클릭 무시, 5문항 진행 문구, 다시 하기 시 재셔플 확인
- 잘못된 해시 4종(합 불일치, v=2, 범위 초과, 형식 오류) → 소개 화면, 해시 제거 확인
- 남은 확인: iOS Safari·Android Chrome 실기기의 파일 공유·취소·저장·복사, GitHub Pages 배포 주소
