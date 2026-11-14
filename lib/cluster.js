// Схлопывание одинаковых понятий и группировка по смыслу через OpenAI.

const MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/^[\s«»"'`.,!?;:()\-–—]+|[\s«»"'`.,!?;:()\-–—]+$/g, '')
    .trim();
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Вес ответа зависит от поля: первое — 1.2, второе — 1, третье — 0.8.
export const WEIGHTS = [1.2, 1, 0.8];

// answers: string[][] (позиция = номер поля) -> [{ id, text, count, score }]
export function tally(answers, weights = WEIGHTS) {
  const stats = new Map();
  for (const words of answers) {
    const seen = new Set();
    words.forEach((w, i) => {
      const n = norm(w);
      if (!n || seen.has(n)) return; // повтор в одном ответе считаем один раз (по первому полю)
      seen.add(n);
      const s = stats.get(n) || { count: 0, score: 0 };
      s.count += 1;
      s.score += weights[i] ?? weights[weights.length - 1];
      stats.set(n, s);
    });
  }
  return [...stats.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([text, s], i) => ({ id: i + 1, text, count: s.count, score: round(s.score) }));
}

function round(x) {
  return Math.round(x * 100) / 100;
}

const POLL_Q = 'Что для вас Франция?';

function systemPrompt({ question = POLL_Q, correct = '' } = {}) {
  const correctRule = correct
    ? `

Правильный ответ на вопрос: «${correct}». Тегу, который по смыслу совпадает с правильным ответом, добавь поле "correct": true (обычно такой тег один или ни одного).`
    : '';
  return `Ты помогаешь построить облако тегов из ответов участников на вопрос «${question}».
На входе JSON-массив ответов участников: [{"id":1,"text":"круассан"}, ...].

Сделай две вещи.
1) Схлопни ответы, которые означают ОДНО И ТО ЖЕ понятие: формы слова и число (булка, булки), опечатки, регистр, перевод на другой язык (croissant = круассан), полные синонимы и разные написания одного объекта (Эйфелева башня = Эйфелевая башня = башня Эйфеля). НЕ схлопывай просто близкие по теме, но разные понятия (вино и шампанское, Париж и Лувр — это разные теги).
2) Разложи получившиеся теги по смысловым группам (например: еда и напитки, история, искусство, места, мода, чувства и образ жизни — или по смыслу, подходящему к вопросу). Если тегов мало (до 5), допустима одна группа. Групп от 1 до 7 — сколько реально получается, без групп из натянутых соседей. Название группы — 1–2 слова по-русски.

Мат, оскорбления, спам и бессмысленный набор букв не включай в группы — перечисли их id в "skip".

Верни строго JSON:
{"clusters":[{"name":"Еда","terms":[{"label":"Круассан","ids":[1,7]}]}],"skip":[]}

Правила: каждый id встречается ровно один раз (в одном теге или в skip). "label" — красивое написание понятия по-русски с заглавной буквы, в единственном числе, если это естественно; имена собственные сохраняй.${correctRule}`;
}

async function askOpenAI(terms, opts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY не задан');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt(opts) },
        { role: 'user', content: JSON.stringify(terms.map(({ id, text }) => ({ id, text }))) },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content);
}

export async function buildCloud(answers, opts = {}) {
  const terms = tally(answers, opts.weights);
  const byId = new Map(terms.map((t) => [t.id, t]));
  const used = new Set();
  let clusters = [];
  let ai = true;
  let aiError = null;

  try {
    const out = await askOpenAI(terms, opts);
    for (const id of out.skip || []) if (byId.has(id)) used.add(id);
    for (const c of out.clusters || []) {
      const cl = { name: String(c.name || 'Другое').slice(0, 30), terms: [] };
      for (const t of c.terms || []) {
        let count = 0;
        let score = 0;
        for (const id of t.ids || []) {
          if (!byId.has(id) || used.has(id)) continue;
          used.add(id);
          count += byId.get(id).count;
          score += byId.get(id).score;
        }
        if (count > 0) cl.terms.push({ label: String(t.label || '').slice(0, 40), count, score: round(score), ...(t.correct === true ? { correct: true } : {}) });
      }
      if (cl.terms.length) clusters.push(cl);
    }
  } catch (e) {
    ai = false;
    aiError = String(e.message || e);
    used.clear();
    clusters = [];
  }

  // Всё, что модель пропустила, не теряем.
  const rest = terms.filter((t) => !used.has(t.id));
  if (rest.length) {
    let other = clusters.find((c) => c.name === 'Другое');
    if (!other) clusters.push((other = { name: ai ? 'Другое' : 'Франция', terms: [] }));
    for (const t of rest) other.terms.push({ label: cap(t.text), count: t.count, score: t.score });
  }

  for (const c of clusters) {
    c.terms.sort((a, b) => b.score - a.score || b.count - a.count);
    c.total = round(c.terms.reduce((s, t) => s + t.score, 0));
  }
  clusters.sort((a, b) => b.total - a.total);

  return { clusters, participants: answers.length, ai, aiError, at: Date.now() };
}
