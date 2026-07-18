const SPREADSHEET_ID = '1hQKe60-qL4NlEzA_bWEXt9M9kv8JURaGDRP4IhDBMEY';
const PARTICIPANTS_SHEET = 'participants';
const RECORDS_SHEET = 'records';
const SESSIONS_SHEET = 'sessions';
const TEST_WEEK_OVERRIDE = 1;

const EVENT_WEEKS = [
  { week: 1, event: '握力測定', unit: 'kg', start: '2026-08-03', end: '2026-08-09', higherIsBetter: true },
  { week: 2, event: '前屈', unit: 'cm', start: '2026-08-10', end: '2026-08-16', higherIsBetter: true },
  { week: 3, event: 'プランク', unit: '秒', start: '2026-08-17', end: '2026-08-23', higherIsBetter: true },
  { week: 4, event: '腕立て伏せ', unit: '回', start: '2026-08-24', end: '2026-08-30', higherIsBetter: true },
];

const PARTICIPANT_HEADERS = ['participantId', 'fullName', 'nickname', 'pin', 'division', 'active', 'memo', 'createdAt', 'updatedAt'];
const RECORD_HEADERS = ['id', 'createdAt', 'dateKey', 'participantId', 'displayName', 'week', 'event', 'score', 'unit', 'division', 'inputBy', 'userAgent'];
const SESSION_HEADERS = ['token', 'participantId', 'createdAt', 'expiresAt'];

function doGet(e) {
  const action = String((e.parameter && e.parameter.action) || 'list');
  try {
    if (action === 'health') return jsonResponse({ ok: true, message: 'ok' }, e);
    if (action === 'setup') return jsonResponse(setupSheets(), e);
    if (action === 'login') return jsonResponse(login(e.parameter.nickname, e.parameter.pin), e);
    if (action === 'submit') {
      const body = JSON.parse(String(e.parameter.payload || '{}'));
      return jsonResponse(appendRecord(e.parameter.token, body, e), e);
    }
    return jsonResponse({
      ok: true,
      weeks: EVENT_WEEKS,
      currentWeek: getCurrentWeek(),
      records: publicRecords(),
      rankings: buildAllRankings(),
      stats: buildStats(),
    }, e);
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message || '処理に失敗しました。' }, e);
  }
}

function setupSheets() {
  ensureSheet(PARTICIPANTS_SHEET, PARTICIPANT_HEADERS);
  ensureSheet(RECORDS_SHEET, RECORD_HEADERS);
  ensureSheet(SESSIONS_SHEET, SESSION_HEADERS);
  const participants = getSheet(PARTICIPANTS_SHEET);
  if (participants.getLastRow() < 2) {
    const now = new Date().toISOString();
    participants.appendRow([Utilities.getUuid(), '', 'タロウ', '1234', 'member', true, 'サンプル会員', now, now]);
    participants.appendRow([Utilities.getUuid(), '', 'STAFF', '9999', 'staff', true, 'スタッフ確認用', now, now]);
  }
  return { ok: true, message: 'シートを準備しました。participantsに参加者が自動登録されます。' };
}

function login(nickname, pin) {
  const cleanNickname = cleanText(nickname, 16);
  const cleanPin = String(pin || '').trim();
  if (!cleanNickname) return { ok: false, message: 'ニックネームを入力してください。' };
  if (!/^[0-9]{4}$/.test(cleanPin)) return { ok: false, message: '4桁パスワードを入力してください。' };

  let participant = findParticipantByNickname(cleanNickname);
  if (!participant) participant = createParticipant(cleanNickname, cleanPin);
  if (!participant.active) return { ok: false, message: 'このアカウントは停止されています。' };
  if (String(participant.pin) !== String(pin)) return { ok: false, message: 'PINが違います。' };

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

function appendRecord(token, body, eventObject) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = findSession(token);
    if (!session) return { ok: false, message: 'ログインし直してください。' };
    const participant = findParticipant(session.participantId);
    if (!participant || !participant.active) return { ok: false, message: '参加者情報を確認してください。' };

    const week = getCurrentWeek();
    const score = Number(body.score);
    const inputBy = body.inputBy === 'staff' ? 'staff' : 'self';
    if (!Number.isFinite(score)) throw new Error('記録を数字で入力してください。');
    if (score < -1000 || score > 10000) throw new Error('記録の数値を確認してください。');

    const now = new Date();
    const dateKey = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    const records = getRecords();
    const samePersonWeek = records.filter(r => Number(r.week) === week.week && r.participantId === participant.participantId);
    if (samePersonWeek.length >= 3) return { ok: false, message: 'この週のチャレンジはすでに3回分登録されています。' };
    if (samePersonWeek.some(r => r.dateKey === dateKey)) return { ok: false, message: '同じ日の登録は1回までです。' };

    getSheet(RECORDS_SHEET).appendRow([
      Utilities.getUuid(),
      now.toISOString(),
      dateKey,
      participant.participantId,
      participant.nickname,
      week.week,
      week.event,
      score,
      week.unit,
      participant.division,
      inputBy,
      eventObject && eventObject.parameter ? String(eventObject.parameter.userAgent || '') : '',
    ]);

    return { ok: true, message: '登録しました。', rankings: buildAllRankings(), stats: buildStats() };
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  if (name === PARTICIPANTS_SHEET) return ensureSheet(PARTICIPANTS_SHEET, PARTICIPANT_HEADERS);
  if (name === RECORDS_SHEET) return ensureSheet(RECORDS_SHEET, RECORD_HEADERS);
  if (name === SESSIONS_SHEET) return ensureSheet(SESSIONS_SHEET, SESSION_HEADERS);
  throw new Error('Unknown sheet');
}

function ensureSheet(name, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const values = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  const needsHeader = headers.some((header, index) => values[index] !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getParticipants() {
  const rows = readRows(getSheet(PARTICIPANTS_SHEET), PARTICIPANT_HEADERS);
  return rows.map(r => ({
    participantId: String(r.participantId || '').trim(),
    fullName: String(r.fullName || '').trim(),
    nickname: String(r.nickname || '').trim(),
    pin: String(r.pin || '').trim(),
    division: r.division === 'staff' ? 'staff' : 'member',
    active: r.active === true || String(r.active).toUpperCase() === 'TRUE' || String(r.active) === '1',
  })).filter(r => r.participantId);
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
  getSheet(PARTICIPANTS_SHEET).appendRow([participant.participantId, '', nickname, pin, 'member', true, '自動登録', now, now]);
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

function getRecords() {
  return readRows(getSheet(RECORDS_SHEET), RECORD_HEADERS)
    .filter(row => row.id)
    .map(row => ({
      id: row.id,
      createdAt: row.createdAt,
      dateKey: row.dateKey,
      participantId: row.participantId,
      displayName: row.displayName,
      week: Number(row.week),
      event: row.event,
      score: Number(row.score),
      unit: row.unit,
      division: row.division,
      inputBy: row.inputBy,
    }));
}

function publicRecords() {
  return getRecords().map(r => ({
    createdAt: r.createdAt,
    dateKey: r.dateKey,
    participantId: r.participantId,
    displayName: r.displayName,
    week: r.week,
    event: r.event,
    score: r.score,
    unit: r.unit,
    division: r.division,
  }));
}

function readRows(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map(row => {
    const item = {};
    headers.forEach((header, index) => item[header] = row[index]);
    return item;
  });
}

function buildStats() {
  const records = getRecords();
  const current = getCurrentWeek();
  const currentRecords = records.filter(r => Number(r.week) === current.week);
  const participants = {};
  currentRecords.forEach(r => participants[r.participantId] = true);
  return { currentWeek: current.week, participants: Object.keys(participants).length, attempts: currentRecords.length, tickets: records.length };
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
    const key = record.participantId;
    if (!grouped[key]) {
      grouped[key] = { displayName: record.displayName, week: week.week, event: week.event, unit: week.unit, division: record.division, attempts: 0, total: 0 };
    }
    grouped[key].attempts += 1;
    grouped[key].total += Number(record.score);
    if (record.division === 'staff') grouped[key].division = 'staff';
  });
  const rows = Object.keys(grouped).map(key => grouped[key]);
  rows.sort((a, b) => week.higherIsBetter ? b.total - a.total : a.total - b.total);
  return rows.slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));
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
