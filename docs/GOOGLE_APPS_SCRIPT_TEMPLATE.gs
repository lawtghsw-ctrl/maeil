/**
 * LawPower v28.2 - 로펌별 Google Sheet(Raw2) -> LawPower 멀티로펌 DB 자동연동
 *
 * 로펌마다 별도 Spreadsheet를 사용합니다.
 * 같은 Raw2에 여러 Meta Instant Form/광고계정 리드가 섞여 들어와도 form_id/ad_id로 광고소스를 판별합니다.
 * 한 Sheet가 광고소스 하나만 받는 구조라면 LAWPOWER_SOURCE_KEY를 고정해도 됩니다.
 *
 * Apps Script > 프로젝트 설정 > 스크립트 속성
 * 필수:
 *   LAWPOWER_WEBHOOK_URL   = https://운영도메인/api/integrations/google-sheets/leads
 *   LAWPOWER_FIRM_CODE     = 로파워에서 발급된 10자리 로펌 ID
 *   LAWPOWER_INGEST_SECRET = Google Sheet 연동 생성 시 1회 표시되는 Secret
 * 선택:
 *   LAWPOWER_SHEET_NAME    = Raw2 (기본값)
 *   LAWPOWER_SOURCE_KEY    = 이 Sheet 전체를 광고소스 1개로 고정할 때만 입력
 *
 * 최초 1회 setupLawPowerSync()를 실행하면 현재 마지막 행까지 건너뛰고 이후 신규 행부터 1분마다 전송합니다.
 */

const LAWPOWER_HEADER_ROW = 1;
const LAWPOWER_MAX_ROWS_PER_RUN = 100;
const LAWPOWER_LAST_ROW_KEY_PREFIX = 'LAWPOWER_LAST_SYNCED_ROW_';

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
  formId: ['form_id', 'form id'],
  metaLeadId: ['leadgen_id', 'leadgen id', 'lead_id', 'lead id', 'id'],
  campaignId: ['campaign_id', 'campaign id'],
  adsetId: ['adset_id', 'adset id', 'ad_set_id', 'ad set id'],
  adId: ['ad_id', 'ad id'],
};

function lawPowerProps_() {
  return PropertiesService.getScriptProperties();
}

function lawPowerConfig_() {
  const props = lawPowerProps_();
  const webhookUrl = String(props.getProperty('LAWPOWER_WEBHOOK_URL') || '').trim();
  const firmCode = String(props.getProperty('LAWPOWER_FIRM_CODE') || '').trim();
  const secret = String(props.getProperty('LAWPOWER_INGEST_SECRET') || '').trim();
  const sheetName = String(props.getProperty('LAWPOWER_SHEET_NAME') || 'Raw2').trim() || 'Raw2';
  const sourceKey = String(props.getProperty('LAWPOWER_SOURCE_KEY') || '').trim().toUpperCase();
  if (!webhookUrl || !/^\d{10}$/.test(firmCode) || !secret) {
    throw new Error('LAWPOWER_WEBHOOK_URL / LAWPOWER_FIRM_CODE(10자리) / LAWPOWER_INGEST_SECRET을 확인해주세요.');
  }
  return { webhookUrl, firmCode, secret, sheetName, sourceKey };
}

function lawPowerSheet_() {
  const config = lawPowerConfig_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.sheetName);
  if (!sheet) throw new Error(`시트 '${config.sheetName}'을 찾을 수 없습니다.`);
  return sheet;
}

function lawPowerNormalizeHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/[：:]/g, '').replace(/\s+/g, ' ').replace(/\.+$/g, '');
}

function lawPowerHeaderIndex_(headers, aliases) {
  const normalized = headers.map(lawPowerNormalizeHeader_);
  for (const alias of aliases) {
    const index = normalized.indexOf(lawPowerNormalizeHeader_(alias));
    if (index >= 0) return index;
  }
  return -1;
}

function lawPowerColumnMap_(sheet) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(LAWPOWER_HEADER_ROW, 1, 1, lastColumn).getDisplayValues()[0];
  const map = {};
  Object.keys(LAWPOWER_RAW2_HEADERS).forEach(key => {
    map[key] = lawPowerHeaderIndex_(headers, LAWPOWER_RAW2_HEADERS[key]);
  });
  const missing = [];
  if (map.intakeAt < 0) missing.push('created_time');
  if (map.name < 0) missing.push('full_name');
  if (map.phone < 0) missing.push('phone');
  if (missing.length) throw new Error(`Raw2 필수 헤더를 찾을 수 없습니다: ${missing.join(', ')}`);
  return { headers, map, lastColumn };
}

function lawPowerCell_(row, index) {
  return index < 0 ? '' : String(row[index] || '').trim();
}

function lawPowerLastRowKey_() {
  const c = lawPowerConfig_();
  return LAWPOWER_LAST_ROW_KEY_PREFIX + c.sheetName;
}

function setupLawPowerSync() {
  lawPowerConfig_();
  const sheet = lawPowerSheet_();
  lawPowerColumnMap_(sheet);
  const lastRow = Math.max(sheet.getLastRow(), LAWPOWER_HEADER_ROW);
  lawPowerProps_().setProperty(lawPowerLastRowKey_(), String(lastRow));
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncLawPowerNewRows').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncLawPowerNewRows').timeBased().everyMinutes(1).create();
  console.log(`LawPower v28.2 연동 완료. ${lastRow + 1}행부터 신규 DB를 전송합니다.`);
}

function syncLawPowerNewRows() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;
  try {
    const config = lawPowerConfig_();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = lawPowerSheet_();
    const { map, lastColumn } = lawPowerColumnMap_(sheet);
    const props = lawPowerProps_();
    const currentLastRow = sheet.getLastRow();
    const saved = Number(props.getProperty(lawPowerLastRowKey_()) || LAWPOWER_HEADER_ROW);
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
      const rowHasAnyData = row.some(cell => String(cell || '').trim() !== '');
      if (!rowHasAnyData) { targetLastRow = rowNumber; continue; }

      const name = lawPowerCell_(row, map.name);
      const phone = lawPowerCell_(row, map.phone);
      if (!name || !phone) {
        console.log(`Raw2 ${rowNumber}행 이름/전화가 아직 완성되지 않아 다음 실행에서 재확인합니다.`);
        break;
      }

      const rawIntakeAt = map.intakeAt >= 0 ? rawRows[index][map.intakeAt] : '';
      const intakeAt = rawIntakeAt instanceof Date
        ? Utilities.formatDate(rawIntakeAt, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")
        : lawPowerCell_(row, map.intakeAt);

      rows.push({
        externalKey: `${spreadsheet.getId()}|${config.sheetName}|${rowNumber}`,
        rowNumber,
        intakeAt,
        adName: lawPowerCell_(row, map.adName),
        name,
        phone,
        email: lawPowerCell_(row, map.email),
        debtRange: lawPowerCell_(row, map.debt),
        income: lawPowerCell_(row, map.income),
        consultTime: lawPowerCell_(row, map.consultTime),
        formId: lawPowerCell_(row, map.formId),
        metaLeadId: lawPowerCell_(row, map.metaLeadId),
        campaignId: lawPowerCell_(row, map.campaignId),
        adsetId: lawPowerCell_(row, map.adsetId),
        adId: lawPowerCell_(row, map.adId),
      });
      targetLastRow = rowNumber;
    }

    if (rows.length === 0) {
      if (targetLastRow > lastSyncedRow) props.setProperty(lawPowerLastRowKey_(), String(targetLastRow));
      return;
    }

    const headers = {
      'x-lawpower-firm-code': config.firmCode,
      'x-lawpower-ingest-secret': config.secret,
    };
    if (config.sourceKey) headers['x-lawpower-source-key'] = config.sourceKey;

    const response = UrlFetchApp.fetch(config.webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      headers,
      payload: JSON.stringify({
        firmCode: config.firmCode,
        sourceKey: config.sourceKey || undefined,
        sheetId: spreadsheet.getId(),
        sheetName: config.sheetName,
        rows,
      }),
      muteHttpExceptions: true,
      followRedirects: false,
    });

    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status < 200 || status >= 300) throw new Error(`LawPower 전송 실패 (${status}): ${responseText}`);
    const result = responseText ? JSON.parse(responseText) : {};
    if (!result.ok) throw new Error(`LawPower 전송 실패: ${responseText}`);

    // 서버가 batch 전체를 정상 처리한 경우에만 커서를 전진시킵니다.
    props.setProperty(lawPowerLastRowKey_(), String(targetLastRow));
    console.log(`LawPower 동기화 ${startRow}~${targetLastRow}행 / 신규 ${result.imported || 0} / 재유입 ${result.reentries || 0} / 중복 ${result.duplicates || 0} / 건너뜀 ${result.skipped || 0}`);
  } finally {
    lock.releaseLock();
  }
}

function resetLawPowerSyncToCurrentRow() {
  const sheet = lawPowerSheet_();
  const lastRow = Math.max(sheet.getLastRow(), LAWPOWER_HEADER_ROW);
  lawPowerProps_().setProperty(lawPowerLastRowKey_(), String(lastRow));
  console.log(`연동 기준점을 ${lastRow}행으로 재설정했습니다.`);
}

function showLawPowerRaw2HeaderMap() {
  const sheet = lawPowerSheet_();
  const { headers, map } = lawPowerColumnMap_(sheet);
  const readable = {};
  Object.keys(map).forEach(key => {
    const index = map[key];
    readable[key] = index >= 0 ? `${index + 1}열 · ${headers[index]}` : '없음(선택항목)';
  });
  console.log(JSON.stringify(readable, null, 2));
  return readable;
}

function showLawPowerSyncStatus() {
  const config = lawPowerConfig_();
  const sheet = lawPowerSheet_();
  const props = lawPowerProps_();
  const status = {
    firmCode: config.firmCode,
    sheetName: config.sheetName,
    fixedSourceKey: config.sourceKey || '(행별 자동판별)',
    currentLastRow: sheet.getLastRow(),
    lastSyncedRow: Number(props.getProperty(lawPowerLastRowKey_()) || LAWPOWER_HEADER_ROW),
    webhookConfigured: Boolean(config.webhookUrl),
    secretConfigured: Boolean(config.secret),
  };
  console.log(JSON.stringify(status, null, 2));
  return status;
}

function testLawPowerWebhook() {
  const config = lawPowerConfig_();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const headers = {
    'x-lawpower-firm-code': config.firmCode,
    'x-lawpower-ingest-secret': config.secret,
  };
  if (config.sourceKey) headers['x-lawpower-source-key'] = config.sourceKey;

  const response = UrlFetchApp.fetch(config.webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    headers,
    payload: JSON.stringify({
      firmCode: config.firmCode,
      sourceKey: config.sourceKey || undefined,
      sheetId: spreadsheet.getId(),
      sheetName: config.sheetName,
      rows: [],
    }),
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) throw new Error(`webhook 테스트 실패 (${status}): ${body}`);
  const result = body ? JSON.parse(body) : {};
  if (!result.ok) throw new Error(`webhook 테스트 실패: ${body}`);
  console.log('LawPower webhook 정상. 실제 DB는 생성하지 않았습니다.');
  return result;
}
