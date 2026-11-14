import { hostView, playView, join, answer, control, getQuestions, saveQuestions } from '../quest.js';

const noStore = { 'Cache-Control': 'no-store' };

function fail(e, status = 400) {
  return Response.json({ error: String(e?.message || e) }, { status, headers: noStore });
}

// GET /api/quest?view=host | view=play&pid=... | view=questions
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get('view');
    if (view === 'host') return Response.json(await hostView(), { headers: noStore });
    if (view === 'questions') return Response.json({ questions: await getQuestions() }, { headers: noStore });
    return Response.json(await playView(url.searchParams.get('pid') || ''), { headers: noStore });
  } catch (e) {
    return fail(e, 500);
  }
}

// POST { action: 'join' | 'answer' | 'control' | 'save', ... }
export async function POST(request) {
  let b;
  try {
    b = await request.json();
  } catch {
    return fail('Некорректный запрос');
  }
  try {
    switch (b?.action) {
      case 'join':
        return Response.json(await join(b.pid), { headers: noStore });
      case 'answer':
        return Response.json(await answer(b.pid, b.qid, b.value), { headers: noStore });
      case 'control':
        await control(b.op, b.idx);
        return Response.json(await hostView(), { headers: noStore });
      case 'save':
        return Response.json({ questions: await saveQuestions(b.questions) }, { headers: noStore });
      default:
        return fail('Неизвестное действие');
    }
  } catch (e) {
    return fail(e);
  }
}
