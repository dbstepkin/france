// Раскладка облака: в центре — группа с самым популярным понятием,
// остальные группы по окружности. Внутри группы слова укладываются по спирали.
(function () {
  const PALETTE = ['#ffd978', '#7cc4ff', '#ff8b96', '#8fe6c0', '#c9a9ff', '#ffb37a', '#8fe0ff', '#f6a6d7'];

  function overlap(a, b, gx, gy) {
    return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gx && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gy;
  }

  function measure(text, size, weight) {
    const m = (measure.el ||= (() => {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;line-height:1.1';
      document.body.appendChild(s);
      return s;
    })());
    m.style.font = `${weight} ${size}px Manrope, system-ui, sans-serif`;
    m.textContent = text;
    return { w: m.offsetWidth, h: m.offsetHeight };
  }

  function layoutCluster(cluster, fontSize) {
    const words = cluster.terms.map((t) => {
      const size = fontSize(t.count);
      const weight = size > 34 ? 800 : size > 24 ? 700 : 600;
      const box = measure(t.label, size, weight);
      const badge = t.count > 1 ? measure('×' + t.count, Math.max(11, size * 0.32), 600).w + 4 : 0;
      return { text: t.label, count: t.count, size, weight, w: box.w + badge, h: box.h, x: 0, y: 0 };
    });
    const placed = [];
    for (const w of words) {
      for (let t = 0; ; t += 0.12) {
        const r = 2.4 * t;
        w.x = r * Math.cos(t) * 1.45;
        w.y = r * Math.sin(t) * 0.8;
        if (!placed.some((p) => overlap(w, p, 14, 5))) break;
      }
      placed.push(w);
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const w of words) {
      x0 = Math.min(x0, w.x - w.w / 2); x1 = Math.max(x1, w.x + w.w / 2);
      y0 = Math.min(y0, w.y - w.h / 2); y1 = Math.max(y1, w.y + w.h / 2);
    }
    y0 -= 30; // место под название группы
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const w of words) { w.x -= cx; w.y -= cy; }
    const nameW = measure(cluster.name.toUpperCase(), 13, 700).w + 40;
    return { name: cluster.name, words, w: Math.max(x1 - x0, nameW) + 44, h: y1 - y0 + 36, labelY: y0 - cy + 10, x: 0, y: 0 };
  }

  function render(stage, cloud) {
    stage.innerHTML = '';
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!cloud || !cloud.clusters.length || !W || !H) return;

    const all = cloud.clusters.flatMap((c) => c.terms);
    const maxCount = Math.max(...all.map((t) => t.count));
    const fontSize = (c) => (maxCount <= 1 ? 30 : 20 + 56 * Math.sqrt((c - 1) / (maxCount - 1)));

    // Центр — группа, где находится понятие-лидер.
    const clusters = cloud.clusters.slice().sort((a, b) => b.terms[0].count - a.terms[0].count || b.total - a.total);
    const boxes = clusters.map((c, i) => Object.assign(layoutCluster(c, fontSize), { color: PALETTE[i % PALETTE.length] }));

    const aspect = Math.min(2.4, Math.max(0.6, W / H));
    const n = boxes.length - 1;
    const start = n <= 2 ? 0 : -Math.PI / 2;
    const placed = [boxes[0]];
    for (let i = 1; i <= n; i++) {
      const b = boxes[i];
      const k = i % 2 ? (i - 1) / 2 : n - i / 2; // чередуем стороны
      const ang = start + (2 * Math.PI * k) / n;
      for (let d = 0; ; d += 5) {
        b.x = Math.cos(ang) * d * aspect;
        b.y = Math.sin(ang) * d;
        if (!placed.some((p) => overlap(b, p, 10, 6))) break;
      }
      placed.push(b);
    }

    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const b of boxes) {
      x0 = Math.min(x0, b.x - b.w / 2); x1 = Math.max(x1, b.x + b.w / 2);
      y0 = Math.min(y0, b.y - b.h / 2); y1 = Math.max(y1, b.y + b.h / 2);
    }
    const scale = Math.min(W / (x1 - x0), H / (y1 - y0), 2.4) * 0.97;
    const ox = -(x0 + x1) / 2, oy = -(y0 + y1) / 2;

    const root = document.createElement('div');
    root.className = 'cloud-root';
    root.style.transform = `scale(${scale})`;

    boxes.forEach((b, bi) => {
      const el = document.createElement('div');
      el.className = 'cloud-cluster' + (bi === 0 ? ' is-center' : '');
      el.style.left = b.x + ox + 'px';
      el.style.top = b.y + oy + 'px';
      el.style.setProperty('--c', b.color);

      const blob = document.createElement('div');
      blob.className = 'cloud-blob';
      blob.style.width = b.w * 1.25 + 'px';
      blob.style.height = b.h * 1.35 + 'px';
      el.appendChild(blob);

      const name = document.createElement('div');
      name.className = 'cloud-name';
      name.textContent = b.name;
      name.style.top = b.labelY + 'px';
      el.appendChild(name);

      b.words.forEach((w, wi) => {
        const s = document.createElement('span');
        s.className = 'cloud-word';
        s.style.left = w.x + 'px';
        s.style.top = w.y + 'px';
        s.style.fontSize = w.size + 'px';
        s.style.fontWeight = w.weight;
        s.style.animationDelay = bi * 0.18 + wi * 0.05 + 's';
        s.textContent = w.text;
        if (w.count > 1) {
          const c = document.createElement('sup');
          c.textContent = '×' + w.count;
          c.style.fontSize = Math.max(11, w.size * 0.32) + 'px';
          s.appendChild(c);
        }
        el.appendChild(s);
      });
      root.appendChild(el);
    });
    stage.appendChild(root);
  }

  window.renderCloud = function (stage, cloud) {
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => render(stage, cloud));
  };
})();
