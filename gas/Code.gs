const SPREADSHEET_ID = '1hQKe60-qL4NlEzA_bWEXt9M9kv8JURaGDRP4IhDBMEY';
const PARTICIPANTS_SHEET = '参加者';
const SESSIONS_SHEET = 'セッション';
const LEGACY_PARTICIPANTS_SHEET = 'participants';
const LEGACY_SESSIONS_SHEET = 'sessions';
const LEGACY_RECORDS_SHEET = 'records';
const TEST_WEEK_OVERRIDE = 1;

const EVENT_WEEKS = [
  { week: 1, event: '握力測定', sheet: '握力測定', unit: 'kg', start: '2026-08-03', end: '2026-08-09', higherIsBetter: true },
  { week: 2, event: '前屈', sheet: '前屈', unit: 'cm', start: '2026-08-10', end: '2026-08-16', higherIsBetter: true },
  { week: 3, event: 'プランク', sheet: 'プランク', unit: '秒', start: '2026-08-17', end: '2026-08-23', higherIsBetter: true },
  { week: 4, event: '腕立て伏せ', sheet: '腕立て伏せ', unit: '回', start: '2026-08-24', end: '2026-08-30', higherIsBetter: true },
];

// A〜O: E列=表示名, H/I/J列=1〜3回目スコア
const PARTICIPANT_HEADERS = ['participantId', 'nickname', 'pin', 'division', 'active', 'memo', 'createdAt', 'updatedAt'];
const SESSION_HEADERS = ['token', 'participantId', 'createdAt', 'expiresAt'];
const EVENT_HEADERS = [
  'participantId', // A
  'createdAt',     // B
  'updatedAt',     // C
  'division',      // D
  'displayName',   // E
  'unit',          // F
  'attempts',      // G
  'score1',        // H
  'score2',        // I
  'score3',        // J
  'date1',         // K
  'date2',         // L
  'date3',         // M
  'inputBy',       // N
  'userAgent',     // O
];

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = String(params.action || 'list');
  try {
    if (action === 'health') return jsonResponse({ ok: true, message: 'ok' }, e);
    if (action === 'setup') return jsonResponse(setupSheets(), e);
    if (action === 'login') return jsonResponse(login(params.nickname, params.pin), e);
    if (action === 'submit') {
      const body = JSON.parse(String(params.payload || '{}'));
      return jsonResponse(upsertRecord(params.token, body, e), e);
    }
    return jsonResponse(readPublicState(), e);
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message || '処理に失敗しました。' }, e);
  }
}

function setupSheets() {
  renameLegacySheetIfNeeded(LEGACY_PARTICIPANTS_SHEET, PARTICIPANTS_SHEET);
  renameLegacySheetIfNeeded(LEGACY_SESSIONS_SHEET, SESSIONS_SHEET);

  ensureSheet(PARTICIPANTS_SHEET, PARTICIPANT_HEADERS);
  ensureSheet(SESSIONS_SHEET, SESSION_HEADERS);
  EVENT_WEEKS.forEach(week => ensureSheet(week.sheet, EVENT_HEADERS));

  const now = new Date().toISOString();
  const participants = getSheet(PARTICIPANTS_SHEET);
  if (participants.getLastRow() < 2) {
    participants.appendRow([Utilities.getUuid(), 'テスト', '1111', 'member', true, '動作確認用', now, now]);
    participants.appendRow([Utilities.getUuid(), 'STAFF', '9999', 'staff', true, 'スタッフ確認用', now, now]);
  }

  migrateLegacyRecordsIfNeeded();
  return { ok: true, message: 'シートを準備しました。' };
}

function login(nickname, pin) {
  setupSheets();
  const cleanNickname = cleanText(nickname, 16);
  const cleanPin = String(pin || '').trim();
  if (!cleanNickname) return { ok: false, message: 'ニックネームを入力してください。' };
  if (!/^[0-9]{4}$/.test(cleanPin)) return { ok: false, message: '4桁パスワードを入力してください。' };

  let participant = findParticipantByNickname(cleanNickname);
  if (!participant) participant = createParticipant(cleanNickname, cleanPin);
  if (!participant.active) return { ok: false, message: 'このニックネームは停止されています。スタッフにお声がけください。' };
  if (String(participant.pin) !== cleanPin) return { ok: false, message: '4桁パスワードが違います。' };

  const token = Utilities.getUuid() + Utilities.getUuid();
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  getSheet(SESSIONS_SHEET).appendRow([token, participant.participantId, now.toISOString(), expires.toISOString()]);

  return {
    ok: true,
    session: {
      token,
      participantId: participant.participantId,
      nickname: participant.nickname,
      division: participant.division,
      expiresAt: expires.toISOString(),
    },
  };
}

function upsertRecord(token, body, eventObject) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSheets();
    const participant = resolveParticipantForRecord(token, body);
    if (!participant || !participant.active) return { ok: false, message: '参加情報を確認してください。' };

    const week = getCurrentWeek();
    const score = Number(body.score);
    const inputBy = body.inputBy === 'staff' ? 'staff' : 'self';
    if (!Number.isFinite(score)) return { ok: false, message: '記録を数字で入力してください。' };
    if (score < -1000 || score > 10000) return { ok: false, message: '記録の数値を確認してください。' };

    const now = new Date();
    const dateKey = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    const sheet = getSheet(week.sheet);
    const rows = readEventRows(week);
    const existing = rows.find(r => r.participantId === participant.participantId);
    const dates = existing ? [existing.date1, existing.date2, existing.date3] : [];
    const scores = existing ? [existing.score1, existing.score2, existing.score3] : [];
    const filled = scores.filter(value => Number.isFinite(value)).length;

    if (filled >= 3) return { ok: false, message: 'この週のチャレンジはすでに3回分登録されています。' };
    if (dates.some(value => value === dateKey)) return { ok: false, message: '同じ日の登録は1回までです。' };

    const slot = filled; // 0,1,2
    const userAgent = eventObject && eventObject.parameter ? String(eventObject.parameter.userAgent || '') : '';
    const isoNow = now.toISOString();

    if (!existing) {
      const row = [
        participant.participantId,
        isoNow,
        isoNow,
        participant.division,
        participant.nickname,
        week.unit,
        1,
        score, '', '',
        dateKey, '', '',
        inputBy,
        userAgent,
      ];
      sheet.appendRow(row);
    } else {
      const nextScores = [existing.score1, existing.score2, existing.score3];
      const nextDates = [existing.date1, existing.date2, existing.date3];
      nextScores[slot] = score;
      nextDates[slot] = dateKey;
      const attempts = nextScores.filter(value => Number.isFinite(value)).length;
      sheet.getRange(existing.rowNumber, 1, existing.rowNumber, EVENT_HEADERS.length).setValues([[
        existing.participantId,
        existing.createdAt || isoNow,
        isoNow,
        participant.division,
        participant.nickname,
        week.unit,
        attempts,
        nextScores[0] == null ? '' : nextScores[0],
        nextScores[1] == null ? '' : nextScores[1],
        nextScores[2] == null ? '' : nextScores[2],
        nextDates[0] || '',
        nextDates[1] || '',
        nextDates[2] || '',
        inputBy,
        userAgent || existing.userAgent || '',
      ]]);
    }

    return {
      ok: true,
      message: '登録しました。',
      record: {
        createdAt: isoNow,
        dateKey,
        participantId: participant.participantId,
        displayName: participant.nickname,
        week: week.week,
        event: week.event,
        score,
        unit: week.unit,
        division: participant.division,
        attempt: slot + 1,
      },
    };
  } finally {
    lock.releaseLock();
  }
}

function resolveParticipantForRecord(token, body) {
  const session = findSession(token);
  if (session) return findParticipant(session.participantId);

  const cleanNickname = cleanText(body && body.nickname, 16);
  const cleanPin = String(body && body.pin || '').trim();
  if (!cleanNickname || !/^[0-9]{4}$/.test(cleanPin)) return null;

  let participant = findParticipantByNickname(cleanNickname);
  if (!participant) return createParticipant(cleanNickname, cleanPin);
  if (String(participant.pin) !== cleanPin) throw new Error('4桁パスワードが違います。');
  return participant;
}

function readPublicState() {
  setupSheets();
  return {
    ok: true,
    weeks: EVENT_WEEKS,
    currentWeek: getCurrentWeek(),
    records: publicRecords(),
    rankings: buildAllRankings(),
    stats: buildStats(),
  };
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function renameLegacySheetIfNeeded(legacyName, nextName) {
  const ss = getSpreadsheet();
  const legacy = ss.getSheetByName(legacyName);
  const next = ss.getSheetByName(nextName);
  if (legacy && !next) legacy.setName(nextName);
}

function getSheet(name) {
  if (name === PARTICIPANTS_SHEET) return ensureSheet(PARTICIPANTS_SHEET, PARTICIPANT_HEADERS);
  if (name === SESSIONS_SHEET) return ensureSheet(SESSIONS_SHEET, SESSION_HEADERS);
  const week = EVENT_WEEKS.find(item => item.sheet === name);
  if (week) return ensureSheet(week.sheet, EVENT_HEADERS);
  throw new Error('Unknown sheet');
}

function ensureSheet(name, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const width = Math.max(sheet.getLastColumn(), headers.length);
  const values = sheet.getRange(1, 1, 1, width).getValues()[0];
  const needsHeader = headers.some((header, index) => values[index] !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getParticipants() {
  return readRows(getSheet(PARTICIPANTS_SHEET), PARTICIPANT_HEADERS)
    .map(r => ({
      participantId: String(r.participantId || '').trim(),
      nickname: String(r.nickname || '').trim(),
      pin: String(r.pin || '').trim(),
      division: r.division === 'staff' ? 'staff' : 'member',
      active: r.active === true || String(r.active).toUpperCase() === 'TRUE' || String(r.active) === '1',
    }))
    .filter(r => r.participantId && r.nickname);
}

function findParticipant(participantId) {
  const id = String(participantId || '').trim();
  return getParticipants().find(p => p.participantId === id);
}

function findParticipantByNickname(nickname) {
  const key = cleanText(nickname, 16).toLowerCase();
  return getParticipants().find(p => p.nickname.toLowerCase() === key);
}

function createParticipant(nickname, pin) {
  const now = new Date().toISOString();
  const participant = {
    participantId: Utilities.getUuid(),
    nickname,
    pin,
    division: 'member',
    active: true,
  };
  getSheet(PARTICIPANTS_SHEET).appendRow([participant.participantId, nickname, pin, 'member', true, '自動登録', now, now]);
  return participant;
}

function findSession(token) {
  const value = String(token || '').trim();
  if (!value) return null;
  const rows = readRows(getSheet(SESSIONS_SHEET), SESSION_HEADERS);
  const now = new Date();
  const session = rows.reverse().find(r => String(r.token) === value);
  if (!session) return null;
  if (new Date(session.expiresAt) < now) return null;
  return session;
}

function readEventRows(week) {
  const sheet = getSheet(week.sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow, EVENT_HEADERS.length).getValues().map((row, index) => {
    const item = {};
    EVENT_HEADERS.forEach((header, col) => item[header] = row[col]);
    return {
      rowNumber: index + 2,
      participantId: String(item.participantId || '').trim(),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      division: item.division === 'staff' ? 'staff' : 'member',
      displayName: String(item.displayName || '').trim(),
      unit: item.unit || week.unit,
      attempts: Number(item.attempts) || 0,
      score1: toOptionalNumber(item.score1),
      score2: toOptionalNumber(item.score2),
      score3: toOptionalNumber(item.score3),
      date1: normalizeDateKey(item.date1),
      date2: normalizeDateKey(item.date2),
      date3: normalizeDateKey(item.date3),
      inputBy: item.inputBy,
      userAgent: item.userAgent,
      week: week.week,
      event: week.event,
    };
  }).filter(row => row.participantId);
}

function getAllEventRows() {
  return EVENT_WEEKS.reduce((all, week) => all.concat(readEventRows(week)), []);
}

function flattenRecords(rows) {
  const records = [];
  rows.forEach(row => {
    [
      { score: row.score1, dateKey: row.date1, attempt: 1 },
      { score: row.score2, dateKey: row.date2, attempt: 2 },
      { score: row.score3, dateKey: row.date3, attempt: 3 },
    ].forEach(slot => {
      if (!Number.isFinite(slot.score)) return;
      records.push({
        createdAt: row.updatedAt || row.createdAt,
        dateKey: slot.dateKey,
        participantId: row.participantId,
        displayName: row.displayName,
        week: row.week,
        event: row.event,
        score: slot.score,
        unit: row.unit,
        division: row.division,
        attempt: slot.attempt,
      });
    });
  });
  return records;
}

function publicRecords() {
  return flattenRecords(getAllEventRows());
}

function readRows(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow, headers.length).getValues().map(row => {
    const item = {};
    headers.forEach((header, index) => item[header] = row[index]);
    return item;
  });
}

function buildStats() {
  const records = publicRecords();
  const current = getCurrentWeek();
  const currentRecords = records.filter(r => Number(r.week) === current.week);
  const participants = {};
  currentRecords.forEach(r => participants[r.participantId] = true);
  return {
    currentWeek: current.week,
    participants: Object.keys(participants).length,
    attempts: currentRecords.length,
    tickets: records.length,
  };
}

function buildAllRankings() {
  return EVENT_WEEKS.reduce((all, week) => {
    all[week.week] = buildRanking(readEventRows(week), week);
    return all;
  }, {});
}

function buildRanking(rows, week) {
  const ranked = rows.map(row => {
    const scores = [row.score1, row.score2, row.score3].filter(value => Number.isFinite(value));
    return {
      displayName: row.displayName,
      week: week.week,
      event: week.event,
      unit: week.unit,
      division: row.division,
      attempts: scores.length,
      total: scores.reduce((sum, value) => sum + value, 0),
      score1: row.score1,
      score2: row.score2,
      score3: row.score3,
    };
  }).filter(row => row.attempts > 0);

  ranked.sort((a, b) => week.higherIsBetter ? b.total - a.total : a.total - b.total);
  return ranked.slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));
}

function migrateLegacyRecordsIfNeeded() {
  const ss = getSpreadsheet();
  const legacy = ss.getSheetByName(LEGACY_RECORDS_SHEET);
  if (!legacy || legacy.getLastRow() < 2) return;

  const hasAnyEventData = EVENT_WEEKS.some(week => getSheet(week.sheet).getLastRow() >= 2);
  if (hasAnyEventData) return;

  const legacyHeaders = ['id', 'createdAt', 'dateKey', 'participantId', 'displayName', 'week', 'event', 'score', 'unit', 'division', 'inputBy', 'userAgent'];
  const legacyRows = readRows(legacy, legacyHeaders).filter(row => row.participantId && Number.isFinite(Number(row.score)));
  if (!legacyRows.length) return;

  const grouped = {};
  legacyRows.forEach(row => {
    const weekNo = Number(row.week);
    const week = EVENT_WEEKS.find(item => item.week === weekNo);
    if (!week) return;
    const key = `${weekNo}::${row.participantId}`;
    if (!grouped[key]) {
      grouped[key] = {
        week,
        participantId: String(row.participantId).trim(),
        displayName: String(row.displayName || '').trim(),
        division: row.division === 'staff' ? 'staff' : 'member',
        unit: row.unit || week.unit,
        createdAt: row.createdAt || new Date().toISOString(),
        scores: [],
        dates: [],
        inputBy: row.inputBy || 'self',
        userAgent: row.userAgent || '',
      };
    }
    if (grouped[key].scores.length >= 3) return;
    grouped[key].scores.push(Number(row.score));
    grouped[key].dates.push(normalizeDateKey(row.dateKey));
  });

  Object.keys(grouped).forEach(key => {
    const item = grouped[key];
    const sheet = getSheet(item.week.sheet);
    sheet.appendRow([
      item.participantId,
      item.createdAt,
      item.createdAt,
      item.division,
      item.displayName,
      item.unit,
      item.scores.length,
      item.scores[0] != null ? item.scores[0] : '',
      item.scores[1] != null ? item.scores[1] : '',
      item.scores[2] != null ? item.scores[2] : '',
      item.dates[0] || '',
      item.dates[1] || '',
      item.dates[2] || '',
      item.inputBy,
      item.userAgent,
    ]);
  });
}

function getCurrentWeek() {
  if (TEST_WEEK_OVERRIDE) {
    return EVENT_WEEKS.find(week => week.week === TEST_WEEK_OVERRIDE) || EVENT_WEEKS[0];
  }
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

function toOptionalNumber(value) {
  if (value === '' || value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeDateKey(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(value).slice(0, 10);
}

function jsonResponse(payload, e) {
  const callback = e && e.parameter ? cleanCallbackName(e.parameter.callback) : '';
  const body = callback ? `${callback}(${JSON.stringify(payload)});` : JSON.stringify(payload);
  const mimeType = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(body).setMimeType(mimeType);
}

function cleanCallbackName(value) {
  const callback = String(value || '');
  return /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(callback) ? callback : '';
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, maxLength);
}
