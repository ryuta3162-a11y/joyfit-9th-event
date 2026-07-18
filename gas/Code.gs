const SHEET_NAME = 'records';

const EVENT_WEEKS = [
  { week: 1, event: '握力測定', unit: 'kg', start: '2026-08-03', end: '2026-08-09', higherIsBetter: true },
  { week: 2, event: '前屈', unit: 'cm', start: '2026-08-10', end: '2026-08-16', higherIsBetter: true },
  { week: 3, event: 'プランク', unit: '秒', start: '2026-08-17', end: '2026-08-23', higherIsBetter: true },
  { week: 4, event: '腕立て伏せ', unit: '回', start: '2026-08-24', end: '2026-08-30', higherIsBetter: true },
];

const HEADERS = [
  'id',
  'createdAt',
  'dateKey',
  'displayName',
  'participantKey',
  'week',
  'event',
  'score',
  'unit',
  'division',
  'proxyInput',
  'userAgent',
];

function doGet(e) {
  const action = String((e.parameter && e.parameter.action) || 'list');
  if (action === 'health') return jsonResponse({ ok: true, message: 'ok' }, e);
  if (action === 'submit') {
    try {
      const body = JSON.parse(String(e.parameter.payload || '{}'));
      return jsonResponse(appendRecord(body, e), e);
    } catch (error) {
      return jsonResponse({ ok: false, message: error.message || '登録に失敗しました。' }, e);
    }
  }
  return jsonResponse({
    ok: true,
    weeks: EVENT_WEEKS,
    currentWeek: getCurrentWeek(),
    records: getRecords(),
    rankings: buildAllRankings(),
    stats: buildStats(),
  }, e);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const result = appendRecord(body, e);
    return jsonResponse(result, e);
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message || '登録に失敗しました。' }, e);
  }
}

function appendRecord(body, eventObject) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const week = getCurrentWeek();
    const displayName = cleanText(body.displayName, 12);
    const participantKey = cleanText(body.participantKey, 24);
    const score = Number(body.score);
    const division = body.division === 'staff' ? 'staff' : 'member';
    const proxyInput = Boolean(body.proxyInput);

    if (!displayName) throw new Error('イニシャルを入力してください。');
    if (!Number.isFinite(score)) throw new Error('記録を数字で入力してください。');
    if (score < -1000 || score > 10000) throw new Error('記録の数値を確認してください。');

    const sheet = getSheet();
    const now = new Date();
    const dateKey = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    const participantId = makeParticipantId(displayName, participantKey);
    const records = getRecords();
    const samePersonWeek = records.filter(r => Number(r.week) === week.week && makeParticipantId(r.displayName, r.participantKey) === participantId);

    if (samePersonWeek.length >= 3) {
      return { ok: false, message: 'この週のチャレンジはすでに3回分登録されています。' };
    }
    if (samePersonWeek.some(r => r.dateKey === dateKey)) {
      return { ok: false, message: '同じ日の登録は1回までです。' };
    }

    const row = [
      Utilities.getUuid(),
      now.toISOString(),
      dateKey,
      displayName,
      participantKey,
      week.week,
      week.event,
      score,
      week.unit,
      division,
      proxyInput,
      eventObject && eventObject.parameter ? String(eventObject.parameter.userAgent || '') : '',
    ];
    sheet.appendRow(row);

    return {
      ok: true,
      message: '登録しました。',
      currentWeek: week,
      stats: buildStats(),
      rankings: buildAllRankings(),
    };
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  const values = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
  const needsHeader = HEADERS.some((header, index) => values[index] !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getRecords() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues()
    .filter(row => row[0])
    .map(row => ({
      id: row[0],
      createdAt: row[1],
      dateKey: row[2],
      displayName: row[3],
      participantKey: row[4],
      week: Number(row[5]),
      event: row[6],
      score: Number(row[7]),
      unit: row[8],
      division: row[9],
      proxyInput: row[10] === true || row[10] === 'TRUE',
    }));
}

function buildStats() {
  const records = getRecords();
  const current = getCurrentWeek();
  const currentRecords = records.filter(r => Number(r.week) === current.week);
  const participants = {};
  currentRecords.forEach(r => {
    participants[makeParticipantId(r.displayName, r.participantKey)] = true;
  });
  return {
    currentWeek: current.week,
    participants: Object.keys(participants).length,
    attempts: currentRecords.length,
    tickets: records.length,
  };
}

function buildAllRankings() {
  const records = getRecords();
  return EVENT_WEEKS.reduce((all, week) => {
    all[week.week] = buildRanking(records, week);
    return all;
  }, {});
}

function buildRanking(records, week) {
  const grouped = {};
  records.filter(r => Number(r.week) === week.week).forEach(record => {
    const key = makeParticipantId(record.displayName, record.participantKey);
    if (!grouped[key]) {
      grouped[key] = {
        displayName: record.displayName,
        week: week.week,
        event: week.event,
        unit: week.unit,
        division: record.division,
        attempts: 0,
        total: 0,
      };
    }
    grouped[key].attempts += 1;
    grouped[key].total += Number(record.score);
    if (record.division === 'staff') grouped[key].division = 'staff';
  });

  const rows = Object.keys(grouped).map(key => grouped[key]);
  rows.sort((a, b) => week.higherIsBetter ? b.total - a.total : a.total - b.total);
  return rows.slice(0, 10).map((row, index) => {
    row.rank = index + 1;
    return row;
  });
}

function getCurrentWeek() {
  const now = new Date();
  const active = EVENT_WEEKS.find(week => {
    const start = new Date(`${week.start}T00:00:00+09:00`);
    const end = new Date(`${week.end}T23:59:59+09:00`);
    return now >= start && now <= end;
  });
  if (active) return active;
  if (now < new Date(`${EVENT_WEEKS[0].start}T00:00:00+09:00`)) return EVENT_WEEKS[0];
  return EVENT_WEEKS[EVENT_WEEKS.length - 1];
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, maxLength);
}

function makeParticipantId(displayName, participantKey) {
  return `${cleanText(displayName, 12).toUpperCase()}::${cleanText(participantKey, 24).toUpperCase()}`;
}

function jsonResponse(payload, e) {
  const callback = e && e.parameter ? cleanCallbackName(e.parameter.callback) : '';
  const body = callback ? `${callback}(${JSON.stringify(payload)});` : JSON.stringify(payload);
  const mimeType = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService
    .createTextOutput(body)
    .setMimeType(mimeType);
}

function cleanCallbackName(value) {
  const callback = String(value || '');
  return /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(callback) ? callback : '';
}
