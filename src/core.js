(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuizCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  function uid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  function createState() { return { version: 1, banks: [], settings: { minutes: 25, sound: false }, activeBankId: null, timer: null }; }
  function normalizeQuestion(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('题目格式无效');
    const question = copy(raw);
    question.id = String(raw.id || raw.originalId || uid());
    question.originalId = String(raw.originalId || raw.id || question.id);
    question.type = String(raw.type || '待确认').replace('计算 / 综合填空（原类型：分录题）', '分录题');
    question.stem = String(raw.stem || '');
    question.options = Array.isArray(raw.options) ? raw.options.map((o, i) => typeof o === 'string' ? { label: String.fromCharCode(65 + i), text: o } : { ...o, label: String(o.label || String.fromCharCode(65 + i)), text: String(o.text || '') }) : [];
    question.answer = raw.answer == null ? '' : copy(raw.answer);
    question.answerText = String(raw.answerText || '');
    question.analysis = String(raw.analysis || '');
    question.topic = String(raw.topic || '未分类');
    question.source = String(raw.source || raw.task || '');
    question.images = Array.isArray(raw.images) ? copy(raw.images) : [];
    return question;
  }
  function createBank(name, parsed) {
    const source = Array.isArray(parsed) ? { questions: parsed } : (parsed || {});
    const questions = (source.questions || []).map(normalizeQuestion);
    const seen = new Set();
    for (const q of questions) {
      if (seen.has(q.id)) throw new Error(`题目 ID 重复：${q.id}`);
      seen.add(q.id);
    }
    const bank = { id: uid(), name: String(name || source.name || '未命名题库'), createdAt: nowIso(), questions, knowledge: copy(source.knowledge || {}), records: {}, rounds: [], activeRoundId: null };
    startRound(bank, questions.map(q => q.id), '普通练习');
    return bank;
  }
  function currentRound(bank) { return (bank.rounds || []).find(r => r.id === bank.activeRoundId) || null; }
  function questionOf(bank, qid) { const q = bank.questions.find(x => x.id === qid); if (!q) throw new Error(`找不到题目：${qid}`); return q; }
  function getRecord(bank, qid) { return bank.records[qid] || null; }
  function ensureRecord(bank, qid) {
    questionOf(bank, qid);
    if (!bank.records[qid]) bank.records[qid] = { bookmark: false, currentWrong: false, attempts: [] };
    if (!Array.isArray(bank.records[qid].attempts)) bank.records[qid].attempts = [];
    return bank.records[qid];
  }
  function getDraft(bank, qid) { const round = currentRound(bank); return round && Object.hasOwn(round.answers || {}, qid) ? copy(round.answers[qid]) : null; }
  function getResult(bank, qid) { const round = currentRound(bank); return round && round.results ? round.results[qid] || null : null; }
  function setDraft(bank, qid, value) {
    questionOf(bank, qid);
    const round = currentRound(bank); if (!round) throw new Error('没有当前练习轮次');
    round.answers[qid] = copy(value); return copy(value);
  }
  function toggleBookmark(bank, qid) { const record = ensureRecord(bank, qid); record.bookmark = !record.bookmark; return record.bookmark; }
  function normalizedLabels(value) {
    if (Array.isArray(value)) return [...new Set(value.flatMap(normalizedLabels))].sort();
    return [...new Set(String(value ?? '').toUpperCase().replace(/[^A-Z]/g, '').split(''))].sort();
  }
  function normalizedBoolean(value, question) {
    const v = String(value ?? '').trim().toLowerCase();
    if (['对', '正确', 'true', 't', '√', '✓', '是'].includes(v)) return 'true';
    if (['错', '错误', 'false', 'f', '×', '✗', '否'].includes(v)) return 'false';
    const option = (question.options || []).find(o => o.label.toUpperCase() === v.toUpperCase());
    if (option && String(option.text).trim().toLowerCase() !== v) return normalizedBoolean(option.text, { options: [] });
    return null;
  }
  function grade(question, raw) {
    const type = question.type;
    const answer = question.answer;
    const missing = answer == null || (Array.isArray(answer) ? answer.length === 0 : String(answer).trim() === '');
    if (missing) return { result: 'missing', answer: copy(raw) };
    if (['填空题', '简答题', '计算题', '分录题'].includes(type)) return { result: 'review', answer: copy(raw) };
    if (type === '判断题') {
      const expected = normalizedBoolean(answer, question), actual = normalizedBoolean(raw, question);
      if (expected == null) return { result: 'missing', answer: copy(raw) };
      return { result: actual === expected ? 'correct' : 'wrong', answer: copy(raw) };
    }
    if (type === '单选题' || type === '多选题') {
      const expected = normalizedLabels(answer), actual = normalizedLabels(raw);
      const choices = new Set((question.options || []).map(o => String(o.label).toUpperCase()));
      if (!expected.length || expected.some(x => !choices.has(x)) || (type === '单选题' && expected.length !== 1)) return { result: 'missing', answer: copy(raw) };
      return { result: actual.length === expected.length && actual.every((x, i) => x === expected[i]) ? 'correct' : 'wrong', answer: copy(raw) };
    }
    return { result: 'review', answer: copy(raw) };
  }
  function submit(bank, qid, answer, options = {}) {
    const q = questionOf(bank, qid), round = currentRound(bank);
    if (!round || !round.questionIds.includes(qid)) throw new Error('题目不属于当前练习');
    const raw = answer === undefined ? getDraft(bank, qid) : copy(answer);
    if (raw == null || (Array.isArray(raw) ? raw.length === 0 : String(raw).trim() === '')) throw new Error('请先作答');
    setDraft(bank, qid, raw);
    const evaluation = grade(q, raw);
    if (evaluation.result === 'missing') return { result: 'missing', record: getRecord(bank, qid), attempt: null };
    let result = evaluation.result;
    if (options.manualResult !== undefined) {
      if (result !== 'review' || !['correct', 'wrong'].includes(options.manualResult)) throw new Error('无效自评结果');
      result = options.manualResult;
    }
    const record = ensureRecord(bank, qid);
    const last = record.attempts[record.attempts.length - 1];
    let attempt;
    if (options.manualResult && last && last.roundId === round.id && JSON.stringify(last.answer) === JSON.stringify(raw)) {
      last.result = result; last.at = nowIso(); attempt = last;
    } else {
      attempt = { id: uid(), at: nowIso(), answer: copy(raw), result, roundId: round.id };
      record.attempts.push(attempt);
    }
    round.results[qid] = result;
    if (result === 'wrong') record.currentWrong = true;
    if (result === 'correct') record.currentWrong = false;
    return { result, record, attempt };
  }
  function stats(bank) {
    const round = currentRound(bank);
    const counts = { total: round ? round.questionIds.length : 0, correct: 0, wrong: 0, review: 0, unanswered: 0, graded: 0, accuracy: null, currentWrong: 0, bookmarks: 0 };
    if (round) for (const id of round.questionIds) { const result = round.results[id]; if (result === 'correct' || result === 'wrong' || result === 'review') counts[result]++; else counts.unanswered++; }
    counts.graded = counts.correct + counts.wrong;
    counts.accuracy = counts.graded ? counts.correct / counts.graded : null;
    for (const r of Object.values(bank.records || {})) { if (r.currentWrong) counts.currentWrong++; if (r.bookmark) counts.bookmarks++; }
    return counts;
  }
  function startRound(bank, ids, name) {
    const seen = new Set(), valid = new Set(bank.questions.map(q => q.id));
    const questionIds = (ids || []).filter(id => valid.has(id) && !seen.has(id) && seen.add(id));
    const round = { id: uid(), name: String(name || '练习'), questionIds, answers: {}, results: {}, createdAt: nowIso(), endedAt: null };
    bank.rounds.push(round); bank.activeRoundId = round.id; return round;
  }
  function startWrongRound(bank, ids) {
    const include = ids == null ? null : new Set(ids);
    const wrong = bank.questions.filter(q => bank.records[q.id]?.currentWrong && (!include || include.has(q.id))).map(q => q.id);
    return startRound(bank, wrong, '重刷错题');
  }
  function getTimerRemaining(timer, now = Date.now()) {
    if (!timer) return 0;
    if (timer.status === 'running') return Math.max(0, Number(timer.deadline) - Number(now));
    return Math.max(0, Number(timer.remainingMs) || 0);
  }
  function createTimer(bankId, roundId, minutes, now = Date.now()) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new Error('专注时间应为 1 至 180 分钟的整数');
    const remainingMs = minutes * 60000;
    return { bankId, roundId, status: 'running', remainingMs, deadline: Number(now) + remainingMs };
  }
  function pauseTimer(timer, now = Date.now()) {
    if (!timer || timer.status !== 'running') return timer;
    timer.remainingMs = getTimerRemaining(timer, now); timer.deadline = null; timer.status = timer.remainingMs > 0 ? 'paused' : 'expired'; return timer;
  }
  function resumeTimer(timer, now = Date.now()) {
    if (!timer || timer.status !== 'paused') return timer;
    if (timer.remainingMs <= 0) { timer.status = 'expired'; timer.deadline = null; return timer; }
    timer.deadline = Number(now) + timer.remainingMs; timer.status = 'running'; return timer;
  }
  function finishTimer(timer, now = Date.now()) {
    if (!timer) return timer; timer.remainingMs = getTimerRemaining(timer, now); timer.deadline = null; timer.status = 'finished'; return timer;
  }
  function backup(state, now = Date.now()) {
    const out = copy(state);
    if (out.timer && (out.timer.status === 'running' || out.timer.status === 'paused')) {
      out.timer.remainingMs = getTimerRemaining(state.timer, now);
      out.timer.status = out.timer.remainingMs > 0 ? 'paused' : 'expired';
      out.timer.deadline = null;
    }
    return { format: 'local-quiz-backup', version: 1, exportedAt: new Date(now).toISOString(), state: out };
  }
  function validateBackup(raw) {
    const errors = [];
    const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const resultTypes = new Set(['correct', 'wrong', 'review']);
    if (!object(raw) || raw.format !== 'local-quiz-backup' || raw.version !== 1 || !object(raw.state) || raw.state.version !== 1 || !Array.isArray(raw.state.banks)) return { valid: false, errors: ['备份格式或版本无效'] };
    const state = raw.state;
    if (!object(state.settings) || !Number.isInteger(state.settings.minutes) || state.settings.minutes < 1 || state.settings.minutes > 180 || typeof state.settings.sound !== 'boolean') errors.push('设置格式无效');
    const banks = new Set();
    function checkTimer(timer, expectedBank, label) {
      if (!object(timer)) { errors.push(`${label}格式无效`); return; }
      const bank = state.banks.find(b => object(b) && b.id === timer.bankId);
      const round = bank && Array.isArray(bank.rounds) ? bank.rounds.find(r => object(r) && r.id === timer.roundId) : null;
      if (!bank || !round || (expectedBank && timer.bankId !== expectedBank)) errors.push(`${label}对应的题库或轮次不存在`);
      if (!['running', 'paused', 'expired', 'finished', 'untimed'].includes(timer.status) || !Number.isFinite(timer.remainingMs) || timer.remainingMs < 0 || (timer.status === 'running' && !Number.isFinite(timer.deadline))) errors.push(`${label}状态无效`);
      if (timer.questionIds !== undefined) {
        if (!Array.isArray(timer.questionIds) || timer.questionIds.some(id => typeof id !== 'string' || !round || !Array.isArray(round.questionIds) || !round.questionIds.includes(id))) errors.push(`${label}的题目不属于对应轮次`);
      }
      if (timer.index !== undefined && (!Number.isInteger(timer.index) || timer.index < 0 || (Array.isArray(timer.questionIds) && timer.questionIds.length > 0 && timer.index >= timer.questionIds.length))) errors.push(`${label}的题目位置无效`);
    }
    for (const bank of state.banks) {
      if (!object(bank) || typeof bank.id !== 'string' || !bank.id || banks.has(bank.id)) { errors.push('题库 ID 缺失或重复'); continue; }
      banks.add(bank.id);
      if (!Array.isArray(bank.questions) || !Array.isArray(bank.rounds) || !object(bank.records) || !object(bank.knowledge)) { errors.push(`题库 ${bank.id} 的结构无效`); continue; }
      if (typeof bank.name !== 'string') errors.push(`题库 ${bank.id} 的名称无效`);
      const ids = new Set();
      for (const q of bank.questions) {
        if (!object(q) || typeof q.id !== 'string' || !q.id || ids.has(q.id)) { errors.push(`题库 ${bank.id} 的题目 ID 缺失或重复`); continue; }
        ids.add(q.id);
        if (typeof q.stem !== 'string' || typeof q.type !== 'string' || !Array.isArray(q.options) || q.options.some(o => !object(o) || typeof o.label !== 'string' || typeof o.text !== 'string') || (q.images !== undefined && !Array.isArray(q.images))) errors.push(`题库 ${bank.id} 的题目 ${q.id} 结构无效`);
      }
      const rounds = new Set();
      for (const round of bank.rounds) {
        if (!object(round) || typeof round.id !== 'string' || !round.id || rounds.has(round.id) || !Array.isArray(round.questionIds) || !object(round.answers) || !object(round.results)) { errors.push(`题库 ${bank.id} 的轮次结构无效`); continue; }
        rounds.add(round.id);
        if (round.questionIds.some(id => typeof id !== 'string' || !ids.has(id)) || Object.keys(round.answers).some(id => !ids.has(id)) || Object.keys(round.results).some(id => !ids.has(id))) errors.push(`题库 ${bank.id} 的轮次包含未知题目`);
        if (Object.values(round.results).some(value => !resultTypes.has(value))) errors.push(`题库 ${bank.id} 的轮次结果无效`);
      }
      if (bank.activeRoundId && !rounds.has(bank.activeRoundId)) errors.push(`题库 ${bank.id} 的活动轮次不存在`);
      for (const [qid, rec] of Object.entries(bank.records)) {
        if (!ids.has(qid) || !object(rec) || !Array.isArray(rec.attempts) || rec.attempts.some(a => !object(a) || typeof a.id !== 'string' || !a.id || !resultTypes.has(a.result) || (a.roundId != null && !rounds.has(a.roundId))) || (rec.bookmark !== undefined && typeof rec.bookmark !== 'boolean') || (rec.currentWrong !== undefined && typeof rec.currentWrong !== 'boolean')) errors.push(`题库 ${bank.id} 的作答记录无效`);
      }
      if (bank.restoredTimer != null) checkTimer(bank.restoredTimer, bank.id, `题库 ${bank.id} 的恢复计时器`);
    }
    if (state.activeBankId && !banks.has(state.activeBankId)) errors.push('当前题库不存在');
    if (state.timer != null) checkTimer(state.timer, null, '计时器');
    return { valid: !errors.length, errors };
  }
  function mergeBackup(state, incoming, policy = 'current') {
    if (!['current', 'backup', 'copy'].includes(policy)) throw new Error('未知恢复方式');
    const check = validateBackup(incoming); if (!check.valid) throw new Error(check.errors.join('；'));
    const out = copy(state), source = copy(incoming.state);
    const report = { addedBanks: 0, copiedBanks: 0, conflictedBanks: 0, addedQuestions: 0, addedAttempts: 0, conflicts: [], timerConflict: null };
    const remapped = new Map();
    const different = (x, y) => JSON.stringify(x) !== JSON.stringify(y);
    const mergeFields = (current, backup) => policy === 'backup' ? { ...current, ...backup } : { ...backup, ...current };
    for (const old of source.banks) {
      const target = out.banks.find(b => b.id === old.id);
      if (!target || policy === 'copy') {
        if (target) { const oldId = old.id; old.id = uid(); old.name += '（恢复副本）'; if (old.restoredTimer && old.restoredTimer.bankId === oldId) old.restoredTimer.bankId = old.id; remapped.set(oldId, old.id); report.copiedBanks++; }
        else report.addedBanks++;
        out.banks.push(old); continue;
      }
      report.conflictedBanks++;
      const issues = { bankId: old.id, name: old.name, questions: 0, records: 0, rounds: 0, attempts: 0, details: [] };
      if (target.name !== old.name) issues.details.push({ kind: 'bankName', current: target.name, backup: old.name });
      if (target.activeRoundId !== old.activeRoundId) issues.details.push({ kind: 'activeRound', current: target.activeRoundId, backup: old.activeRoundId });
      const qmap = new Map(target.questions.map((q, i) => [q.id, i]));
      for (const q of old.questions) {
        if (!qmap.has(q.id)) { qmap.set(q.id, target.questions.length); target.questions.push(q); report.addedQuestions++; }
        else {
          const index = qmap.get(q.id), current = target.questions[index];
          if (different(current, q)) {
            issues.questions++;
            issues.details.push({ kind: 'question', qid: q.id, current: copy(current), backup: copy(q) });
            if (policy === 'backup') target.questions[index] = q;
          }
        }
      }
      for (const [key, value] of Object.entries(old.knowledge || {})) {
        if (!Object.hasOwn(target.knowledge, key)) target.knowledge[key] = copy(value);
        else if (different(target.knowledge[key], value)) {
          issues.details.push({ kind: 'knowledge', topic: key, current: copy(target.knowledge[key]), backup: copy(value) });
          if (policy === 'backup') target.knowledge[key] = copy(value);
        }
      }
      for (const [qid, rec] of Object.entries(old.records || {})) {
        if (!Object.hasOwn(target.records, qid)) { target.records[qid] = rec; report.addedAttempts += rec.attempts.length; continue; }
        const dest = target.records[qid];
        const currentFields = Object.fromEntries(Object.entries(dest).filter(([k]) => k !== 'attempts'));
        const backupFields = Object.fromEntries(Object.entries(rec).filter(([k]) => k !== 'attempts'));
        if (different(currentFields, backupFields)) { issues.records++; issues.details.push({ kind: 'record', qid, current: copy(currentFields), backup: copy(backupFields) }); }
        const attemptIds = new Map(dest.attempts.map((a, i) => [a.id, i]));
        for (const a of rec.attempts) {
          if (!attemptIds.has(a.id)) { attemptIds.set(a.id, dest.attempts.length); dest.attempts.push(a); report.addedAttempts++; }
          else {
            const index = attemptIds.get(a.id), current = dest.attempts[index];
            if (different(current, a)) {
              issues.attempts++; issues.details.push({ kind: 'attempt', qid, attemptId: a.id, current: copy(current), backup: copy(a) });
              if (policy === 'backup') dest.attempts[index] = a;
            }
          }
        }
        const fields = mergeFields(currentFields, backupFields);
        for (const [k, v] of Object.entries(fields)) dest[k] = copy(v);
      }
      const rmap = new Map(target.rounds.map(r => [r.id, r]));
      for (const round of old.rounds) {
        if (!rmap.has(round.id)) { target.rounds.push(round); continue; }
        const current = rmap.get(round.id);
        if (different(current, round)) {
          issues.rounds++; issues.details.push({ kind: 'round', roundId: round.id, current: copy(current), backup: copy(round) });
          const merged = mergeFields(current, round);
          const preferred = policy === 'backup' ? round.questionIds : current.questionIds;
          const other = policy === 'backup' ? current.questionIds : round.questionIds;
          merged.questionIds = [...new Set([...preferred, ...other])];
          merged.answers = mergeFields(current.answers, round.answers);
          merged.results = mergeFields(current.results, round.results);
          Object.assign(current, merged);
        }
      }
      if (policy === 'backup') { target.name = old.name; target.activeRoundId = old.activeRoundId; }
      report.conflicts.push(issues);
    }
    if (source.timer) {
      const restored = copy(source.timer);
      restored.bankId = remapped.get(restored.bankId) || restored.bankId;
      if (restored.status === 'running') { restored.status = restored.remainingMs > 0 ? 'paused' : 'expired'; restored.deadline = null; }
      if (out.timer && different(out.timer, restored)) report.timerConflict = { current: copy(out.timer), backup: copy(restored), selected: policy === 'backup' ? 'backup' : 'current' };
      if (policy === 'copy' && out.timer) {
        const copiedBank = out.banks.find(b => b.id === restored.bankId);
        if (copiedBank) copiedBank.restoredTimer = restored;
        if (report.timerConflict) report.timerConflict.savedOnBank = restored.bankId;
      } else if (policy === 'backup' || !out.timer) out.timer = restored;
    } else if (policy === 'backup') {
      if (out.timer) report.timerConflict = { current: copy(out.timer), backup: null, selected: 'backup' };
      out.timer = null;
    }
    if (out.activeBankId != null && (different(out.settings, source.settings) || out.activeBankId !== (remapped.get(source.activeBankId) || source.activeBankId))) {
      report.sessionConflict = { current: { settings: copy(out.settings), activeBankId: out.activeBankId }, backup: { settings: copy(source.settings), activeBankId: remapped.get(source.activeBankId) || source.activeBankId }, selected: policy === 'backup' ? 'backup' : 'current' };
    }
    if (policy === 'backup' || out.activeBankId == null) {
      out.settings = copy(source.settings || out.settings);
      out.activeBankId = remapped.get(source.activeBankId) || source.activeBankId;
    }
    return { state: out, report };
  }
  function parseLegacyProgress(state, raw, bankId) {
    const bank = state.banks.find(b => b.id === bankId); if (!bank) throw new Error('请选择目标题库');
    if (!raw || !raw.records || typeof raw.records !== 'object' || Array.isArray(raw.records) || (raw.format && raw.format !== 'computer-graphics-progress')) throw new Error('旧版进度格式无效');
    const byOriginal = new Map();
    for (const q of bank.questions) { const key = q.originalId || q.id; if (byOriginal.has(key)) byOriginal.set(key, null); else byOriginal.set(key, q); }
    const report = { matched: 0, skipped: 0, unknown: [], existing: 0, conflicts: [] };
    const keys = new Set([...Object.keys(raw.records), ...Object.keys(raw.drafts || {})]);
    let round = currentRound(bank); if (!round) round = startRound(bank, bank.questions.map(q => q.id), '旧版进度');
    for (const originalId of keys) {
      const q = byOriginal.get(originalId); if (!q) { report.skipped++; report.unknown.push(originalId); continue; }
      const rec = raw.records[originalId] || {}, dest = ensureRecord(bank, q.id), hadAttempt = dest.attempts.length > 0, had = hadAttempt || dest.bookmark;
      if (had) report.existing++;
      if (rec.bookmark) dest.bookmark = true;
      if (['correct', 'wrong', 'review'].includes(rec.result)) {
        const id = `legacy-${encodeURIComponent(bank.id)}-${encodeURIComponent(originalId)}`;
        if (!dest.attempts.some(a => a.id === id)) {
          dest.attempts.push({ id, at: null, answer: copy(rec.answer ?? ''), result: rec.result, roundId: round.id });
          if (!hadAttempt && rec.result !== 'review') dest.currentWrong = rec.result === 'wrong';
          if (!Object.hasOwn(round.results, q.id)) round.results[q.id] = rec.result;
        } else {
          const prior = dest.attempts.find(a => a.id === id);
          if (prior.result !== rec.result || JSON.stringify(prior.answer) !== JSON.stringify(rec.answer ?? '')) report.conflicts.push({ originalId, current: copy(prior), incoming: { result: rec.result, answer: copy(rec.answer ?? '') } });
        }
      }
      const draft = raw.drafts && Object.hasOwn(raw.drafts, originalId) ? raw.drafts[originalId] : rec.answer;
      if (draft != null && !Object.hasOwn(round.answers, q.id)) round.answers[q.id] = copy(draft);
      report.matched++;
    }
    return report;
  }
  class Store {
    constructor(name = 'local-quiz-tool-v1') { this.name = name; this.db = null; }
    open() {
      if (this.db) return Promise.resolve(this.db);
      if (typeof indexedDB === 'undefined') return Promise.reject(new Error('浏览器本地存储不可用'));
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('data')) req.result.createObjectStore('data'); };
        req.onerror = () => reject(req.error || new Error('打开本地存储失败'));
        req.onblocked = () => reject(new Error('本地存储升级被其他页面阻止'));
        req.onsuccess = () => { this.db = req.result; this.db.onversionchange = () => { this.db.close(); this.db = null; }; resolve(this.db); };
      });
    }
    async load() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('data', 'readonly'), req = tx.objectStore('data').get('state');
        req.onsuccess = () => resolve(req.result || createState()); req.onerror = () => reject(req.error || new Error('读取失败'));
        tx.onabort = () => reject(tx.error || new Error('读取事务失败'));
      });
    }
    async save(state) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(copy(state), 'state');
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || new Error('保存失败')); tx.onabort = () => reject(tx.error || new Error('保存失败'));
      });
    }
  }
  return { uid, createState, normalizeQuestion, createBank, currentRound, setDraft, toggleBookmark, grade, submit, stats, startRound, startWrongRound, getRecord, getDraft, getResult, getTimerRemaining, createTimer, pauseTimer, resumeTimer, finishTimer, backup, validateBackup, mergeBackup, parseLegacyProgress, Store };
});
