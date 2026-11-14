// Викторина: вопросы, состояние показа, ответы участников, итоги.
import { pipeline, cmd, parse, toObj, TTL, sync } from './kv.js';
import { buildCloud } from './cluster.js';

export const DEFAULT_QUESTIONS = [
  { id: 'q1', type: 'number', text: 'Сколько примерно сортов сыра производят во Франции?', correct: '1200–1600' },
  { id: 'q2', type: 'word', text: 'Какая страна имеет самую протяжённую сухопутную границу с Францией?', correct: '' },
  { id: 'q3', type: 'word', text: 'Откуда на самом деле родом круассан?', correct: '' },
  { id: 'q4', type: 'word', text: 'Где изначально планировали построить Эйфелеву башню?', correct: '' },
  {
    id: 'q5',
    type: 'word',
    text: 'Какое слово французского происхождения изначально означало «маленький, уютный ресторанчик», а по легенде появилось благодаря русским казакам в 1814 году?',
    correct: '',
  },
  {
    id: 'q6',
    type: 'word',
    text: 'Какое слово французского происхождения в XVII веке означало «человек, который чистит сапоги», а позже стало обозначать целое направление в искусстве и образе жизни?',
    correct: '',
  },
  { id: 'q7', type: 'number', text: 'В каком году во Франции легализовали однополые браки?', correct: '2013' },
];

const K = {
  questions: 'quest:questions',
  state: 'quest:state',
  players: (run) => `quest:${run}:players`,
  answers: (run, qid) => `quest:${run}:a:${qid}`,
  result: (run, qid) => `quest:${run}:r:${qid}`,
};

const INITIAL = { run: '1', idx: 0, phase: 'lobby' }; // phase: lobby | question | reveal | end

// ---------- разбор чисел ----------
export function parseNumber(raw) {
  const s = String(raw ?? '')
    .replace(/[\s  ']/g, '')
    .replace(',', '.')
    .replace(/[^\d.\-eE+]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "2013" -> {min:2013,max:2013}; "1200-1600" / "1200–1600" -> {min:1200,max:1600}
export function parseCorrectRange(raw) {
  const m = String(raw ?? '').match(/^\s*(-?[\d\s.,]+?)\s*(?:[-–—]|\.\.)\s*(-?[\d\s.,]+)\s*$/);
  if (m) {
    const a = parseNumber(m[1]), b = parseNumber(m[2]);
    if (a != null && b != null) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const n = parseNumber(raw);
  return n == null ? null : { min: n, max: n };
}

// ---------- вопросы ----------
export async function getQuestions() {
  const raw = await cmd('GET', K.questions);
  const q = parse(raw);
  return Array.isArray(q) ? q : DEFAULT_QUESTIONS;
}

export function sanitizeQuestions(list) {
  if (!Array.isArray(list)) throw new Error('Ожидался список вопросов');
  const seen = new Set();
  return list.slice(0, 50).map((q) => {
    let id = String(q?.id || '').replace(/[^\w-]/g, '').slice(0, 24);
    if (!id || seen.has(id)) id = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    seen.add(id);
    return {
      id,
      type: q?.type === 'number' ? 'number' : 'word',
      text: String(q?.text || '').trim().slice(0, 400),
      correct: String(q?.correct || '').trim().slice(0, 80),
    };
  });
}

export async function saveQuestions(list) {
  const clean = sanitizeQuestions(list);
  await cmd('SET', K.questions, JSON.stringify(clean));
  return clean;
}

// ---------- состояние ----------
export async function getState() {
  return { ...INITIAL, ...parse(await cmd('GET', K.state), {}) };
}

async function setState(st) {
  await cmd('SET', K.state, JSON.stringify(st));
  return st;
}

// ---------- снимки для экранов ----------
export async function hostView() {
  const [qRaw, stRaw] = await pipeline([['GET', K.questions], ['GET', K.state]]);
  const questions = Array.isArray(parse(qRaw)) ? parse(qRaw) : DEFAULT_QUESTIONS;
  const state = { ...INITIAL, ...parse(stRaw, {}) };
  const q = questions[state.idx];
  const cmds = [['HLEN', K.players(state.run)]];
  if (q) cmds.push(['HLEN', K.answers(state.run, q.id)], ['GET', K.result(state.run, q.id)]);
  const [players, count, result] = await pipeline(cmds);
  return {
    state,
    questions,
    players: Number(players) || 0,
    count: Number(count) || 0,
    result: state.phase === 'reveal' ? parse(result) : null,
  };
}

export async function playView(pid) {
  const [qRaw, stRaw] = await pipeline([['GET', K.questions], ['GET', K.state]]);
  const questions = Array.isArray(parse(qRaw)) ? parse(qRaw) : DEFAULT_QUESTIONS;
  const state = { ...INITIAL, ...parse(stRaw, {}) };
  const q = questions[state.idx];
  let joined = false;
  let mine = null;
  if (pid) {
    const cmds = [['HGET', K.players(state.run), pid]];
    if (q) cmds.push(['HGET', K.answers(state.run, q.id), pid]);
    const [p, a] = await pipeline(cmds);
    joined = !!p;
    mine = a ? parse(a, {}).value ?? null : null;
  }
  return {
    state,
    total: questions.length,
    question: q && state.phase !== 'lobby' && state.phase !== 'end' ? { id: q.id, text: q.text, type: q.type } : null,
    joined,
    mine,
  };
}

// ---------- действия участников (анонимно: только случайный id устройства) ----------
function cleanPid(pid) {
  return String(pid || '').replace(/[^\w-]/g, '').slice(0, 40);
}

export async function join(pid) {
  pid = cleanPid(pid);
  if (!pid) throw new Error('Некорректный запрос');
  const st = await getState();
  const k = K.players(st.run);
  await pipeline([['HSET', k, pid, '1'], ['EXPIRE', k, TTL]]);
  return { ok: true };
}

export async function answer(pid, qid, rawValue) {
  pid = cleanPid(pid);
  if (!pid) throw new Error('Некорректный запрос');
  const [questions, st] = await Promise.all([getQuestions(), getState()]);
  const q = questions[st.idx];
  if (st.phase !== 'question' || !q || q.id !== qid) throw new Error('Приём ответов на этот вопрос закрыт');

  let value;
  if (q.type === 'number') {
    value = parseNumber(rawValue);
    if (value == null) throw new Error('Введите число');
  } else {
    value = String(rawValue ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!value) throw new Error('Введите ответ');
  }
  const ka = K.answers(st.run, q.id);
  const kp = K.players(st.run);
  await pipeline([
    ['HSET', ka, pid, JSON.stringify({ value })],
    ['EXPIRE', ka, TTL],
    ['HSET', kp, pid, '1'],
    ['EXPIRE', kp, TTL],
  ]);
  return { ok: true, value };
}

// ---------- итоги вопроса ----------
async function buildResult(run, q) {
  const all = Object.values(toObj(await cmd('HGETALL', K.answers(run, q.id)))).map((s) => parse(s, {}));
  if (q.type === 'number') {
    const answers = all
      .filter((a) => typeof a.value === 'number' && Number.isFinite(a.value))
      .map((a) => ({ value: a.value }));
    return { type: 'number', answers, correct: parseCorrectRange(q.correct), correctText: q.correct || '' };
  }
  const texts = all.map((a) => String(a.value || '')).filter(Boolean);
  if (!texts.length) return { type: 'word', cloud: null, correctText: q.correct || '' };
  const cloud = await buildCloud(
    texts.map((t) => [t]),
    { question: q.text, correct: q.correct, weights: [1] },
  );
  return { type: 'word', cloud, correctText: q.correct || '' };
}

// ---------- управление ведущим ----------
export async function control(op) {
  await sync(); // действия ведущего — по самым свежим данным, даже если ответы принимала другая копия функции
  const [questions, st] = await Promise.all([getQuestions(), getState()]);
  const n = questions.length;
  const q = questions[st.idx];

  switch (op) {
    case 'start':
      return setState({ ...st, idx: 0, phase: n ? 'question' : 'end' });

    case 'reveal': {
      if (!q) return st;
      const result = await buildResult(st.run, q);
      const kr = K.result(st.run, q.id);
      await pipeline([['SET', kr, JSON.stringify(result)], ['EXPIRE', kr, TTL]]);
      return setState({ ...st, phase: 'reveal' });
    }

    case 'reopen':
      return setState({ ...st, phase: 'question' });

    case 'next':
      if (st.phase === 'lobby') return setState({ ...st, idx: 0, phase: n ? 'question' : 'end' });
      if (st.idx + 1 >= n) return setState({ ...st, phase: 'end' });
      return setState({ ...st, idx: st.idx + 1, phase: 'question' });

    case 'prev': {
      if (st.phase === 'end') return setState({ ...st, idx: Math.max(0, n - 1), phase: 'reveal' });
      if (st.idx <= 0) return setState({ ...st, idx: 0, phase: 'lobby' });
      const pq = questions[st.idx - 1];
      const has = await cmd('GET', K.result(st.run, pq.id));
      return setState({ ...st, idx: st.idx - 1, phase: has ? 'reveal' : 'question' });
    }

    case 'restart':
      return setState({ run: Date.now().toString(36), idx: 0, phase: 'lobby' });

    default:
      throw new Error('Неизвестное действие');
  }
}
