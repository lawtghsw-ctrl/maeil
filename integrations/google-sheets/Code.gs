/**
 * LawPower v27.8 - Google Sheet(Raw2) -> LawPower DB 자동연동
 *
 * Raw2 원본 시트는 Meta 인스턴트양식 CRM 연동이 직접 적재합니다.
 * LawPower는 아래 필요한 값만 읽고, 광고/캠페인 ID 같은 운영용 원본 컬럼은 전송하지 않습니다.
 *
 * 사용 컬럼(헤더명 기준 - 열 위치가 바뀌어도 동작):
 * - created_time -> 접수일
 * - ad_name -> 리드정보 / 광고명
 * - full_name -> 이름
 * - phone -> 연락처
 * - email -> 리드정보 / 이메일
 * - 청산_해야하는_총액수 -> 리드정보 / 채무 총금액
 * - 월수익 -> 리드정보 / 실 월소득
 * - 빚_청산을_위한_상담_가능_시간대를_알려주세요. -> 리드정보 / 상담가능시간
 *
 * LawPower에서 자동으로 채워지는 값:
 * - 상담후방향: 미지정
 * - 최초 담당자: 박형원(v27.7 DB 총괄 담당 설정)
 * - 진행단계: 신규디비
 * - 예약일시: 미지정
 * - 유입경로: 메타
 *
 * 최초 1회:
 * 1) Apps Script > 프로젝트 설정 > 스크립트 속성에 아래 2개 등록
 *    LAWPOWER_WEBHOOK_URL = https://운영도메인/api/integrations/google-sheets/leads
 *    LAWPOWER_WEBHOOK_SECRET = Vercel의 GOOGLE_SHEETS_WEBHOOK_SECRET과 동일값
 * 2) setupLawPowerSync() 수동 실행
 *
 * setupLawPowerSync()는 실행 시점의 Raw2 마지막 행을 기준점으로 저장합니다.
 * 따라서 기존 Raw2 행은 가져오지 않고, 그 다음에 새로 추가되는 행부터 전송합니다.
 */

const LAWPOWER_SHEET_NAME = 'Raw2';
const LAWPOWER_HEADER_ROW = 1;
const LAWPOWER_LAST_ROW_KEY = 'LAWPOWER_LAST_SYNCED_ROW_RAW2';
const LAWPOWER_MAX_ROWS_PER_RUN = 100;

const LAWPOWER_RAW2_HEADERS = {
  intakeAt: ['created_time', 'created time'],
  adName: ['ad_name', 'ad name'],
  name: ['full_name', 'full name', 'name'],
  phone: ['phone', 'phone_number', 'phone number'],
  email: ['email', 'e-mail'],
  debt: ['청산_해야하는_총액수', '청산 해야하는 총액수'],
  income: ['월수익', '월 수익'],
  consultTime: [
    '빚_청산을_위한_상담_가능_시간대를_알려주세요.',
    '빚_청산을_위한_상담_가능_시간대를_알려주세요',
    '빚 청산을 위한 상담 가능 시간대를 알려주세요.',
    '빚 청산을 위한 상담 가능 시간대를 알려주세요',
  ],
};

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

function lawPowerNormalizeHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[：:]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '');
}

function lawPowerHeaderIndex_(headers, aliases) {
  const normalizedHeaders = headers.map(lawPowerNormalizeHeader_);
  for (const alias of aliases) {
    const normalizedAlias = lawPowerNormalizeHeader_(alias);
    const index = normalizedHeaders.indexOf(normalizedAlias);
    if (index >= 0) return index;
  }
  return -1;
}

function lawPowerRaw2ColumnMap_(sheet) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(LAWPOWER_HEADER_ROW, 1, 1, lastColumn).getDisplayValues()[0];
  const map = {
    intakeAt: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.intakeAt),
    adName: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.adName),
    name: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.name),
    phone: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.phone),
    email: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.email),
    debt: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.debt),
    income: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.income),
    consultTime: lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS.consultTime),
  };

  const missingRequired = [];
  if (map.intakeAt < 0) missingRequired.push('created_time');
  if (map.name < 0) missingRequired.push('full_name');
  if (map.phone < 0) missingRequired.push('phone');

  if (missingRequired.length > 0) {
    throw new Error(`Raw2 필수 헤더를 찾을 수 없습니다: ${missingRequired.join(', ')}`);
  }

  return { headers, map, lastColumn };
}

function lawPowerCell_(row, index) {
  if (index < 0) return '';
  return String(row[index] || '').trim();
}

function setupLawPowerSync() {
  lawPowerConfig_();
  const sheet = lawPowerSheet_();
  lawPowerRaw2ColumnMap_(sheet); // 헤더가 정상인지 먼저 검증
  const lastRow = Math.max(sheet.getLastRow(), LAWPOWER_HEADER_ROW);

  // 기존 Raw2 행은 의도적으로 건너뜁니다.
  lawPowerProps_().setProperty(LAWPOWER_LAST_ROW_KEY, String(lastRow));

  // 이전 LawPower 동기화 트리거가 있다면 같은 함수명 기준으로 정리한 뒤 1개만 만듭니다.
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncLawPowerNewRows')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('syncLawPowerNewRows')
    .timeBased()
    .everyMinutes(1)
    .create();

  console.log(`LawPower Raw2 연동 설정 완료. 기존 ${lastRow}행까지는 건너뛰고 ${lastRow + 1}행부터 신규 DB로 전송합니다.`);
}

function syncLawPowerNewRows() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(25000)) return;

  try {
    const { webhookUrl, secret } = lawPowerConfig_();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = lawPowerSheet_();
    const { map, lastColumn } = lawPowerRaw2ColumnMap_(sheet);
    const props = lawPowerProps_();
    const currentLastRow = sheet.getLastRow();
    const saved = Number(props.getProperty(LAWPOWER_LAST_ROW_KEY) || LAWPOWER_HEADER_ROW);
    const lastSyncedRow = Number.isFinite(saved) ? Math.max(saved, LAWPOWER_HEADER_ROW) : LAWPOWER_HEADER_ROW;

    if (currentLastRow <= lastSyncedRow) return;

    const startRow = lastSyncedRow + 1;
    const scanLastRow = Math.min(currentLastRow, lastSyncedRow + LAWPOWER_MAX_ROWS_PER_RUN);
    const count = scanLastRow - lastSyncedRow;
    const displayRows = sheet.getRange(startRow, 1, count, lastColumn).getDisplayValues();
    const rawRows = sheet.getRange(startRow, 1, count, lastColumn).getValues();
    const timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Seoul';

    const rows = [];
    let targetLastRow = lastSyncedRow;

    for (let index = 0; index < displayRows.length; index++) {
      const row = displayRows[index];
      const rowNumber = startRow + index;
      const name = lawPowerCell_(row, map.name);
      const phone = lawPowerCell_(row, map.phone);
      const rowHasAnyData = row.some(cell => String(cell || '').trim() !== '');

      // 완전히 빈 행은 지나갑니다.
      if (!rowHasAnyData) {
        targetLastRow = rowNumber;
        continue;
      }

      // Meta가 아직 한 행을 쓰는 중이라 이름/전화가 비어있다면 이번 회차에서는 멈춥니다.
      // 커서를 넘기지 않으므로 다음 1분 실행에서 다시 읽습니다.
      if (!name || !phone) {
        console.log(`Raw2 ${rowNumber}행은 아직 이름/전화가 완성되지 않아 다음 실행에서 재확인합니다.`);
        break;
      }

      const rawIntakeAt = map.intakeAt >= 0 ? rawRows[index][map.intakeAt] : '';
      const intakeAt = rawIntakeAt instanceof Date
        ? Utilities.formatDate(rawIntakeAt, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")
        : lawPowerCell_(row, map.intakeAt);

      rows.push({
            // id/ad_id/form_id 등의 Meta 원본 식별자는 LawPower 고객정보에 저장하지 않습니다.
        // 중복방지에는 별도 내부키(스프레드시트 ID + Raw2 + 행번호)만 사용합니다.
        externalKey: `${spreadsheet.getId()}|${LAWPOWER_SHEET_NAME}|${rowNumber}`,
        rowNumber,
        intakeAt,
        adName: lawPowerCell_(row, map.adName),
        name,
        phone,
        email: lawPowerCell_(row, map.email),
        debtRange: lawPowerCell_(row, map.debt),
        income: lawPowerCell_(row, map.income),
        consultTime: lawPowerCell_(row, map.consultTime),
      });
      targetLastRow = rowNumber;
    }

    // 처리 가능한 신규 행이 없으면 커서만 빈 행까지 이동시키고 종료합니다.
    if (rows.length === 0) {
      if (targetLastRow > lastSyncedRow) {
        props.setProperty(LAWPOWER_LAST_ROW_KEY, String(targetLastRow));
      }
      return;
    }

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
    props.setProperty(LAWPOWER_LAST_ROW_KEY, String(targetLastRow));
    console.log(`LawPower Raw2 동기화 완료: ${startRow}~${targetLastRow}행 / 신규 ${result.imported || 0} / 중복 ${result.duplicates || 0} / 건너뜀 ${result.skipped || 0}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 연동 기준점을 "현재 Raw2 마지막 행"으로 다시 맞춥니다.
 * 기존 누락행을 일부러 건너뛰어야 할 때만 사용하세요.
 */
function resetLawPowerSyncToCurrentRow() {
  const sheet = lawPowerSheet_();
  const lastRow = Math.max(sheet.getLastRow(), LAWPOWER_HEADER_ROW);
  lawPowerProps_().setProperty(LAWPOWER_LAST_ROW_KEY, String(lastRow));
  console.log(`Raw2 연동 기준점을 ${lastRow}행으로 재설정했습니다. ${lastRow + 1}행부터 다시 수집합니다.`);
}

/** Raw2 헤더가 어떤 컬럼으로 인식됐는지 확인용 */
function showLawPowerRaw2HeaderMap() {
  const sheet = lawPowerSheet_();
  const { headers, map } = lawPowerRaw2ColumnMap_(sheet);
  const readable = {};
  Object.keys(map).forEach(key => {
    const index = map[key];
    readable[key] = index >= 0 ? `${index + 1}열 · ${headers[index]}` : '없음(선택항목)';
  });
  console.log(JSON.stringify(readable, null, 2));
  return readable;
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
    throw new Error(`webhook이 ${location || '다른 주소'}로 리다이렉트되었습니다. integration API가 로그인 middleware를 우회하는지 확인해주세요.`);
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

  console.log('LawPower Raw2 webhook 연결 정상: 실제 DB를 생성하지 않는 빈 요청 테스트가 성공했습니다.');
  return result;
}
