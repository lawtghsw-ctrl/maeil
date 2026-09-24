/**
 * LawPower v27 - Google Sheet(DB가공) -> LawPower DB 자동연동
 *
 * 시트 열 순서(고정):
 * A 인입 시기 / B 광고명 / C 성함 / D 휴대폰 / E 이메일 / F 채무규모 / G 월소득 / H 상담희망시간
 *
 * 최초 1회:
 * 1) Apps Script > 프로젝트 설정 > 스크립트 속성에 아래 2개 등록
 *    LAWPOWER_WEBHOOK_URL = https://운영도메인/api/integrations/google-sheets/leads
 *    LAWPOWER_WEBHOOK_SECRET = Vercel의 GOOGLE_SHEETS_WEBHOOK_SECRET과 동일값
 * 2) setupLawPowerSync() 수동 실행
 *
 * setupLawPowerSync()는 실행 시점의 마지막 행을 기준점으로 저장합니다.
 * 따라서 기존 DB는 가져오지 않고, 그 다음에 새로 추가되는 행부터 전송합니다.
 */

const LAWPOWER_SHEET_NAME = 'DB가공';
const LAWPOWER_HEADER_ROW = 1;
const LAWPOWER_COLUMN_COUNT = 8;
const LAWPOWER_LAST_ROW_KEY = 'LAWPOWER_LAST_SYNCED_ROW';
const LAWPOWER_MAX_ROWS_PER_RUN = 100;

function lawPowerProps_() {
  return PropertiesService.getScriptProperties();
}

function lawPowerConfig_() {
  const props = lawPowerProps_();
  const webhookUrl = String(props.getProperty('LAWPOWER_WEBHOOK_URL') || '').trim();
  const secret = String(props.getProperty('LAWPOWER_WEBHOOK_SECRET') || '').trim();
  if (!webhookUrl || !secret) {
    throw new Error('스크립트 속성 LAWPOWER_WEBHOOK_URL / LAWPOWER_WEBHOOK_SECRET을 먼저 설정해주세요.');
  }
  return { webhookUrl, secret };
}

function lawPowerSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LAWPOWER_SHEET_NAME);
  if (!sheet) throw new Error(`시트 '${LAWPOWER_SHEET_NAME}'을 찾을 수 없습니다.`);
  return sheet;
}

function setupLawPowerSync() {
  lawPowerConfig_();
  const sheet = lawPowerSheet_();
  const lastRow = Math.max(sheet.getLastRow(), LAWPOWER_HEADER_ROW);

  // 기존 행은 의도적으로 건너뜁니다.
  lawPowerProps_().setProperty(LAWPOWER_LAST_ROW_KEY, String(lastRow));

  // 중복 트리거 방지
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncLawPowerNewRows')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('syncLawPowerNewRows')
    .timeBased()
    .everyMinutes(1)
    .create();

  console.log(`LawPower 연동 설정 완료. 기존 ${lastRow}행까지는 건너뛰고 ${lastRow + 1}행부터 신규 DB로 전송합니다.`);
}

function syncLawPowerNewRows() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;

  try {
    const { webhookUrl, secret } = lawPowerConfig_();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = lawPowerSheet_();
    const props = lawPowerProps_();
    const currentLastRow = sheet.getLastRow();
    const saved = Number(props.getProperty(LAWPOWER_LAST_ROW_KEY) || LAWPOWER_HEADER_ROW);
    const lastSyncedRow = Number.isFinite(saved) ? Math.max(saved, LAWPOWER_HEADER_ROW) : LAWPOWER_HEADER_ROW;

    if (currentLastRow <= lastSyncedRow) return;

    const startRow = lastSyncedRow + 1;
    const targetLastRow = Math.min(currentLastRow, lastSyncedRow + LAWPOWER_MAX_ROWS_PER_RUN);
    const count = targetLastRow - lastSyncedRow;
    const displayRows = sheet.getRange(startRow, 1, count, LAWPOWER_COLUMN_COUNT).getDisplayValues();
    const rawRows = sheet.getRange(startRow, 1, count, LAWPOWER_COLUMN_COUNT).getValues();
    const timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Seoul';

    const rows = displayRows.map((row, index) => {
      const rowNumber = startRow + index;
      const rawIntakeAt = rawRows[index][0];
      const intakeAt = rawIntakeAt instanceof Date
        ? Utilities.formatDate(rawIntakeAt, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")
        : String(row[0] || '').trim();

      return {
        externalKey: `${spreadsheet.getId()}|${LAWPOWER_SHEET_NAME}|${rowNumber}`,
        rowNumber,
        intakeAt,
        adName: String(row[1] || '').trim(),
        name: String(row[2] || '').trim(),
        phone: String(row[3] || '').trim(),
        email: String(row[4] || '').trim(),
        debtRange: String(row[5] || '').trim(),
        income: String(row[6] || '').trim(),
        consultTime: String(row[7] || '').trim(),
      };
    });

    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-lawpower-webhook-secret': secret },
      payload: JSON.stringify({
        sheetId: spreadsheet.getId(),
        sheetName: LAWPOWER_SHEET_NAME,
        rows,
      }),
      muteHttpExceptions: true,
      followRedirects: false,
    });

    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status < 200 || status >= 300) {
      throw new Error(`LawPower 전송 실패 (${status}): ${responseText}`);
    }

    const result = responseText ? JSON.parse(responseText) : {};
    if (!result.ok) throw new Error(`LawPower 전송 실패: ${responseText}`);

    // 전체 batch가 성공했을 때만 커서를 앞으로 이동합니다.
    // 재시도되어도 서버의 externalKey 중복방지로 같은 DB가 두 번 생성되지 않습니다.
    props.setProperty(LAWPOWER_LAST_ROW_KEY, String(targetLastRow));
    console.log(`LawPower 동기화 완료: ${startRow}~${targetLastRow}행 / 신규 ${result.imported || 0} / 중복 ${result.duplicates || 0} / 건너뜀 ${result.skipped || 0}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 연동 기준점을 "현재 마지막 행"으로 다시 맞춥니다.
 * 기존 누락행을 일부러 건너뛰어야 할 때만 사용하세요.
 */
function resetLawPowerSyncToCurrentRow() {
  const sheet = lawPowerSheet_();
  const lastRow = Math.max(sheet.getLastRow(), LAWPOWER_HEADER_ROW);
  lawPowerProps_().setProperty(LAWPOWER_LAST_ROW_KEY, String(lastRow));
  console.log(`연동 기준점을 ${lastRow}행으로 재설정했습니다. ${lastRow + 1}행부터 다시 수집합니다.`);
}

/** 현재 연동 상태 확인용 */
function showLawPowerSyncStatus() {
  const sheet = lawPowerSheet_();
  const props = lawPowerProps_();
  const status = {
    sheetName: LAWPOWER_SHEET_NAME,
    currentLastRow: sheet.getLastRow(),
    lastSyncedRow: Number(props.getProperty(LAWPOWER_LAST_ROW_KEY) || LAWPOWER_HEADER_ROW),
    webhookConfigured: Boolean(props.getProperty('LAWPOWER_WEBHOOK_URL')),
    secretConfigured: Boolean(props.getProperty('LAWPOWER_WEBHOOK_SECRET')),
  };
  console.log(JSON.stringify(status, null, 2));
  return status;
}


/**
 * webhook 연결만 점검합니다. 실제 DB 행은 생성하지 않습니다.
 * Apps Script에서 이 함수를 수동 실행하고 실행 로그에 HTTP 200 / ok:true가 뜨는지 확인하세요.
 */
function testLawPowerWebhook() {
  const { webhookUrl, secret } = lawPowerConfig_();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-lawpower-webhook-secret': secret },
    payload: JSON.stringify({
      sheetId: spreadsheet ? spreadsheet.getId() : 'diagnostic',
      sheetName: LAWPOWER_SHEET_NAME,
      rows: [],
    }),
    muteHttpExceptions: true,
    followRedirects: false,
  });

  const status = response.getResponseCode();
  const body = response.getContentText();
  const location = String(response.getHeaders()['Location'] || response.getHeaders()['location'] || '');
  console.log(`LawPower webhook 테스트: HTTP ${status}${location ? ` / redirect=${location}` : ''} / ${body}`);

  if (status >= 300 && status < 400) {
    throw new Error(`webhook이 ${location || '다른 주소'}로 리다이렉트되었습니다. 운영 코드에서 integration API가 로그인 middleware를 우회하는지 확인해주세요.`);
  }
  if (status < 200 || status >= 300) {
    throw new Error(`webhook 테스트 실패 (${status}): ${body}`);
  }

  let result;
  try {
    result = body ? JSON.parse(body) : {};
  } catch (error) {
    throw new Error(`webhook 응답이 JSON이 아닙니다: ${body.slice(0, 500)}`);
  }
  if (!result.ok) throw new Error(`webhook 테스트 실패: ${body}`);

  console.log('LawPower webhook 연결 정상: 실제 DB를 생성하지 않는 빈 요청 테스트가 성공했습니다.');
  return result;
}
