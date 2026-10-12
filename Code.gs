/* =========================================================================
   삼춘네 질문 도우미 — 서버 코드 (Google Apps Script)   v1.0 (2026.10.)
   -------------------------------------------------------------------------
   수업 주제와 성취기준을 입력하면 핵심 질문과 사실적·개념적·논쟁적
   탐구 질문을 만들어 주는 교사용 웹앱입니다.

   · doGet()        : 웹앱 페이지(index.html)를 보여줍니다.
   · askAI()        : 화면에서 google.script.run 으로 부르는 함수.
                      Gemini를 호출해 결과 텍스트를 돌려줍니다. (모델 자동 전환 포함)
   · getStandards() : 성취기준을 구글 시트에서 읽어 '수업 설계' 탭에 보여줍니다.
   · API 키는 서버(이 파일/스크립트 속성)에만 있고, 화면에는 노출되지 않습니다.

   라이선스: 코드 MIT License / 프롬프트·설명 글 CC BY 4.0
   만든 사람: 김수정 (한천초등학교) — 자유롭게 사용·수정·공유하되 출처를 밝혀 주세요.

   ⚙ 설치 방법 (가장 쉬운 길: 공유된 '사본 만들기' 링크로 시트+코드를 한 번에 복사)
   1) 사본 만들기 링크를 열어 내 드라이브에 복사 → 시트의 확장 프로그램 → Apps Script
      (직접 만들 때: 성취기준 시트 → 확장 프로그램 → Apps Script → Code.gs 붙여넣기
       → + 버튼 → HTML → 이름을 정확히 index 로 → index.html 붙여넣기)
   2) Google AI Studio에서 Gemini API 키 발급
      → 프로젝트 설정 → 스크립트 속성에 이름 GEMINI_KEY, 값에 키 저장
      (키를 코드에 직접 쓰지 마세요. 코드를 공유할 때 키가 함께 퍼질 수 있어요.)
   3) 성취기준 시트에 붙은 스크립트라면 STANDARDS_SHEET_ID는 비워 둡니다.
   4) 배포 → 새 배포 → 유형: 웹 앱
        - 실행 계정: 나
        - 액세스 권한: 나만 (혼자 쓸 때 권장)
          · 동료와 함께 쓰려면 '모든 사용자'로 바꿀 수 있지만,
            링크를 아는 사람 누구나 내 키와 사용량으로 AI를 호출하게 됩니다.
            링크를 공개된 곳에 올리지 마세요.
   5) 처음 배포 시 권한 승인(외부 요청, 시트 읽기) → 만들어진 웹앱 URL(/exec)로 접속
      · 학생 화면: .../exec   · 교사 화면(수업 설계 탭): .../exec?mode=teacher

   ⚠ 유의 사항
   · 교사용 도구입니다. 학생 이름·학교명 등 개인정보는 입력하지 마세요.
   · AI가 만든 질문과 성취기준은 교사가 교육과정 원문과 대조해 검토하세요.
   ========================================================================= */

// 스크립트 속성(GEMINI_KEY)을 쓰지 않을 때만 여기에 키를 넣으세요. 공유할 때는 반드시 비워 두세요.
var API_KEY = '';

// 한 번에 보낼 수 있는 글자 수 상한 (웹앱 주소가 알려졌을 때 남용을 줄이기 위함)
var MAX_PROMPT_LENGTH = 8000;

// 우선순위 후보 모델 — 위에서부터 시도해, 처음 성공하는 모델을 사용합니다.
// 모델 이름은 바뀔 수 있어요. 모두 실패하면 listModels()를 실행해 목록을 확인하고 갱신하세요.
var MODEL_CANDIDATES = [
  'gemini-3.1-flash-lite',  // 빠르고 저렴
  'gemini-3.5-flash',       // 예비용
  'gemini-flash-latest'     // 최신 flash로 연결되는 별칭(안전망)
];

// 성취기준이 들어 있는 구글 시트
// · 성취기준 시트에 붙은 스크립트(확장 프로그램 → Apps Script)라면 비워 두세요. 자동으로 그 시트를 씁니다.
// · 따로 만든 스크립트라면 시트 ID를 넣으세요.
//   (시트 주소 docs.google.com/spreadsheets/d/[이 부분이 ID]/edit)
// · 시트 형식: 1행은 머리글, A열 학년군 / B열 교과 / C열 영역 / D열 성취기준 코드 / E열 성취기준 내용
var STANDARDS_SHEET_ID = '';
var STANDARDS_SHEET_NAME = '성취기준';

/* ---------------- 웹앱 ---------------- */

// 웹앱 페이지 보여주기
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('삼춘네 질문 도우미')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/* ---------------- AI 호출 ---------------- */

// 화면(index.html)에서 google.script.run 으로 부르는 서버 함수
function askAI(prompt) {
  if (!prompt) throw new Error('질문 내용이 비어 있어요.');
  if (String(prompt).length > MAX_PROMPT_LENGTH) {
    throw new Error('입력이 너무 길어요. ' + MAX_PROMPT_LENGTH + '자 이내로 줄여 주세요.');
  }

  var key = getApiKey_();
  var lastError = '';

  // 모델 자동 전환: 후보를 순서대로 호출해, 처음 성공하는 응답을 사용
  for (var i = 0; i < MODEL_CANDIDATES.length; i++) {
    var model = MODEL_CANDIDATES[i];
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              model + ':generateContent';
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },   // 키를 주소(URL)가 아닌 헤더로 보냄
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true               // 실패해도 예외 대신 응답코드로 받기
    };
    try {
      var res = UrlFetchApp.fetch(url, options);
      var code = res.getResponseCode();
      if (code !== 200) { lastError = model + ' → ' + code; continue; }  // 다음 후보로

      var data = JSON.parse(res.getContentText());
      var parts = (data.candidates && data.candidates[0] &&
                   data.candidates[0].content && data.candidates[0].content.parts) || [];
      var text = parts.map(function (p) { return p.text || ''; }).join('');
      if (text) return text;                 // 성공!
      lastError = model + ' → 빈 응답';
    } catch (e) {
      lastError = model + ' → ' + e;
    }
  }
  throw new Error('모든 모델 호출에 실패했어요. (' + lastError + ')');
}

// 키 읽기: 스크립트 속성 GEMINI_KEY 를 먼저 쓰고, 없으면 위 API_KEY 를 사용
function getApiKey_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  var key = fromProps || API_KEY;
  if (!key) throw new Error('API 키가 없어요. 프로젝트 설정 → 스크립트 속성에 GEMINI_KEY 를 저장해 주세요.');
  return key;
}

/* ---------------- 성취기준 ---------------- */

// 화면에서 google.script.run 으로 부르는 함수: 성취기준 목록 반환
function getStandards() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('standards');
  if (hit) return JSON.parse(hit);

  var sh;
  try {
    // 시트 ID를 넣었으면 그 시트를, 비워 두었으면 이 스크립트가 붙어 있는 시트를 사용
    // (성취기준 시트의 '확장 프로그램 → Apps Script'에 코드를 넣고 사본을 공유하면 ID를 바꿀 필요가 없어요)
    var ss = STANDARDS_SHEET_ID ? SpreadsheetApp.openById(STANDARDS_SHEET_ID)
                                : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return [];                      // 연결된 시트 없음
    sh = ss.getSheetByName(STANDARDS_SHEET_NAME);
  } catch (e) {
    // 시트 ID가 틀렸거나 접근 권한이 없을 때 화면이 멈추지 않도록 빈 목록 반환
    Logger.log('성취기준 시트를 열 수 없어요: ' + e);
    return [];
  }
  if (!sh) return [];

  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {  // 0행은 머리글이라 건너뜀
    var r = values[i];
    if (!r[3] && !r[4]) continue;            // 코드·내용 모두 비면 건너뜀
    out.push({
      band: String(r[0]).trim(),
      subject: String(r[1]).trim(),
      domain: String(r[2]).trim(),
      code: String(r[3]).trim(),
      text: String(r[4]).trim()
    });
  }
  try {
    cache.put('standards', JSON.stringify(out), 21600);  // 6시간 캐시
  } catch (e) {
    // 캐시 한도(100KB)를 넘으면 캐시 없이 그대로 사용
  }
  return out;
}

/* ---------------- 점검용 (편집기에서 실행) ---------------- */

// 시트를 고친 뒤 바로 반영하고 싶을 때 실행 (캐시 비우기)
function clearStandardsCache() {
  CacheService.getScriptCache().remove('standards');
  Logger.log('캐시를 비웠어요. 화면을 새로고침하면 최신 성취기준이 보입니다.');
}

// 키·모델 연결 확인
function testAskAI() {
  Logger.log(askAI("초등 3학년 사회 수업에서 '변화' 개념으로 개념 질문 하나 만들어줘"));
}

// 성취기준 시트 연결 확인
function testStandards() {
  var list = getStandards();
  Logger.log('불러온 성취기준 개수: ' + list.length);
  if (list.length) Logger.log('첫 줄: ' + JSON.stringify(list[0]));
}

// 이 키로 쓸 수 있는 모델 목록 출력 (MODEL_CANDIDATES 가 모두 실패할 때 실행)
function listModels() {
  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models',
    { headers: { 'x-goog-api-key': getApiKey_() }, muteHttpExceptions: true });
  Logger.log('응답코드: ' + res.getResponseCode());
  var data = JSON.parse(res.getContentText());
  (data.models || []).forEach(function (m) {
    if (m.supportedGenerationMethods &&
        m.supportedGenerationMethods.indexOf('generateContent') !== -1) {
      Logger.log(m.name);  // 예: models/gemini-3.1-flash-lite → 'models/' 뒷부분을 사용
    }
  });
}
