// Шкала для числовых ответов (анонимно): каждый ответ — плашка с числом, столбиками над осью,
// правильный ответ — зелёная линия/полоса, медиана зала — пунктир.
// Если ответы разбросаны на порядки, шкала логарифмическая.
(function () {
  const fmt = (v) => v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  let ctx;
  function textW(text, font) {
    ctx ||= document.createElement('canvas').getContext('2d');
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }

  function el(parent, cls, css, html) {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, css);
    if (html != null) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function render(stage, r) {
    stage.innerHTML = '';
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const root = el(stage, 'scale', {});

    const ans = r.answers.slice().sort((a, b) => a.value - b.value);
    const vals = ans.map((a) => a.value);
    const c = r.correct;
    const all = vals.concat(c ? [c.min, c.max] : []);
    let min = Math.min(...all), max = Math.max(...all);

    const log = min > 0 && max / min >= 30;
    const f = log ? Math.log10 : (v) => v;
    let lo = f(min), hi = f(max);
    if (hi - lo < 1e-9) {
      const d = log ? 0.5 : Math.max(1, Math.abs(lo) * 0.1);
      lo -= d; hi += d;
    }
    const pad = (hi - lo) * 0.06;
    lo -= pad; hi += pad;

    const L = 30, R = 30, TOP = 58, axisY = H - 62;
    const pw = W - L - R;
    const X = (v) => L + ((f(v) - lo) / (hi - lo)) * pw;

    // ось и деления
    el(root, 'axis', { left: L + 'px', width: pw + 'px', top: axisY + 'px' });
    const ticks = [];
    if (log) {
      const many = (Math.ceil(hi) - Math.floor(lo)) * 3 > pw / 70;
      for (let e = Math.floor(lo); e <= Math.ceil(hi); e++)
        for (const m of many ? [1] : [1, 2, 5]) {
          const v = m * Math.pow(10, e);
          if (f(v) >= lo && f(v) <= hi) ticks.push(v);
        }
    } else {
      const step = niceStep(hi - lo, Math.floor(pw / 110));
      for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toPrecision(12));
    }
    for (const v of ticks) {
      const x = X(v);
      el(root, 'tick', { left: x + 'px', top: axisY + 'px' });
      el(root, 'tlabel', { left: x + 'px', top: axisY + 12 + 'px' }, fmt(v));
    }
    if (log) el(root, 'note', {}, 'логарифмическая шкала');

    // правильный ответ
    if (c) {
      const x1 = X(c.min), x2 = X(c.max);
      const isLine = x2 - x1 < 4;
      el(root, 'band' + (isLine ? ' line' : ''), {
        left: (isLine ? (x1 + x2) / 2 - 1 : x1) + 'px',
        width: (isLine ? 0 : x2 - x1) + 'px',
        top: TOP - 14 + 'px',
        height: axisY - TOP + 14 + 'px',
      });
      const text = 'Правильно: ' + (r.correctText || (c.min === c.max ? fmt(c.min) : fmt(c.min) + '–' + fmt(c.max)));
      const lw = textW(text, '800 16px Manrope') + 30;
      const cx = Math.min(Math.max((x1 + x2) / 2, L + lw / 2), W - R - lw / 2);
      el(root, 'blabel', { left: cx + 'px', top: '6px' }, esc(text));
    }

    // медиана зала
    if (vals.length >= 3) {
      const mid = vals.length / 2;
      const med = vals.length % 2 ? vals[Math.floor(mid)] : (vals[mid - 1] + vals[mid]) / 2;
      const mx = X(med);
      el(root, 'median', { left: mx + 'px', top: TOP + 'px', height: axisY - TOP + 'px' });
      const text = 'медиана зала: ' + fmt(+med.toPrecision(6));
      const lw = textW(text, '700 14px Manrope') + 10;
      el(root, 'mlabel', { left: Math.min(Math.max(mx, L + lw / 2), W - R - lw / 2) + 'px', top: axisY + 36 + 'px' }, esc(text));
    }

    // ответы: каждая плашка стоит ровно над своим значением; при наложении поднимается на ряд выше
    const avail = axisY - 10 - TOP;
    function layout(fs) {
      const font = '800 ' + fs + 'px Manrope';
      const h = Math.round(fs * 1.9);
      const items = ans.map((a) => {
        const w = textW(fmt(a.value), font) + fs * 1.4;
        const x = Math.min(Math.max(X(a.value), L + w / 2), W - R - w / 2);
        return { a, w, x, row: 0 };
      });
      const rowsRight = [];
      for (const it of items) {
        let r = 0;
        while (rowsRight[r] != null && rowsRight[r] + 4 > it.x - it.w / 2) r++;
        it.row = r;
        rowsRight[r] = it.x + it.w / 2;
      }
      return { items, h, fs, rows: rowsRight.length };
    }
    let lay;
    for (let fs = 22; fs >= 11; fs--) {
      lay = layout(fs);
      if (lay.rows * (lay.h + 4) <= avail) break;
    }
    const gap = 4;
    const rowH = Math.min(lay.h + gap, avail / lay.rows);
    const dot = rowH < lay.h * 0.75;
    lay.items.forEach((it, i) => {
      const hh = dot ? Math.max(6, rowH - 2) : Math.min(lay.h, rowH - 2);
      const w = dot ? hh : it.w;
      const chip = el(
        root,
        'chip' + (dot ? ' dot' : ''),
        {
          left: it.x - w / 2 + 'px',
          top: axisY - 8 - (it.row + 1) * rowH + 'px',
          width: w + 'px',
          height: hh + 'px',
          fontSize: lay.fs + 'px',
          borderRadius: Math.round(hh / 3) + 'px',
          animationDelay: Math.min(1.5, i * 0.05) + 's',
        },
        '<b>' + esc(fmt(it.a.value)) + '</b>',
      );
      chip.title = fmt(it.a.value);
    });
  }

  window.renderScale = function (stage, result) {
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => render(stage, result));
  };
})();
