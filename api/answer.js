import { snapshot, addAnswer } from '../lib/store.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  // Позиция важна (от неё зависит вес), поэтому пустые поля сохраняем как ''.
  const words = (Array.isArray(body?.words) ? body.words : [])
    .slice(0, 3)
    .map((w) => String(w ?? '').replace(/\s+/g, ' ').trim().slice(0, 40));
  if (!words.some(Boolean)) return Response.json({ error: 'Введите хотя бы одно слово' }, { status: 400 });

  const snap = await snapshot();
  if (snap.resultBlob) return Response.json({ error: 'Опрос уже завершён' }, { status: 409 });

  await addAnswer(words);
  return Response.json({ ok: true });
}
