const Contours = {
  paths(z, cols, rows, nx, level, cellW, cellH) {
    const pos = new Map();
    const adj = new Map();
    const hCount = (rows + 1) * cols;
    const H = (i, j) => j * cols + i;
    const V = (i, j) => hCount + j * nx + i;
    const lerp = (a, b, va, vb) => a + ((level - va) / (vb - va || 1e-9)) * (b - a);

    const link = (a, b, pa, pb) => {
      pos.set(a, pa);
      pos.set(b, pb);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    };

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v00 = z[j * nx + i];
        const v10 = z[j * nx + i + 1];
        const v01 = z[(j + 1) * nx + i];
        const v11 = z[(j + 1) * nx + i + 1];
        const idx =
          ((v00 >= level) << 0) |
          ((v10 >= level) << 1) |
          ((v11 >= level) << 2) |
          ((v01 >= level) << 3);
        if (idx === 0 || idx === 15) continue;

        const xA = i * cellW, xB = (i + 1) * cellW;
        const yA = j * cellH, yB = (j + 1) * cellH;
        const bottom = [lerp(xA, xB, v00, v10), yA];
        const right = [xB, lerp(yA, yB, v10, v11)];
        const top = [lerp(xA, xB, v01, v11), yB];
        const left = [xA, lerp(yA, yB, v00, v01)];
        const eB = H(i, j), eR = V(i + 1, j), eT = H(i, j + 1), eL = V(i, j);
        const pairs = {
          1: [eL, eB, left, bottom], 2: [eB, eR, bottom, right],
          3: [eL, eR, left, right], 4: [eR, eT, right, top],
          6: [eB, eT, bottom, top], 7: [eL, eT, left, top],
          8: [eT, eL, top, left], 9: [eB, eT, bottom, top],
          11: [eR, eT, right, top], 12: [eL, eR, left, right],
          13: [eB, eR, bottom, right], 14: [eL, eB, left, bottom]
        };

        if (idx === 5 || idx === 10) {
          const mid = (v00 + v10 + v11 + v01) * 0.25 >= level;
          if ((idx === 5) === mid) {
            link(eL, eB, left, bottom);
            link(eR, eT, right, top);
          } else {
            link(eL, eT, left, top);
            link(eB, eR, bottom, right);
          }
        } else {
          const p = pairs[idx];
          link(p[0], p[1], p[2], p[3]);
        }
      }
    }

    const used = new Set();
    const eid = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
    const walk = (start, first) => {
      const nodes = [start];
      let prev = start, cur = first;
      used.add(eid(start, first));
      while (cur !== start) {
        nodes.push(cur);
        let next = null;
        for (const k of adj.get(cur)) {
          if (k !== prev && !used.has(eid(cur, k))) {
            next = k;
            break;
          }
        }
        if (next == null) return { nodes, closed: false };
        used.add(eid(cur, next));
        prev = cur;
        cur = next;
      }
      return { nodes, closed: true };
    };

    const open = [];
    const closed = [];
    for (const start of adj.keys()) {
      if ((adj.get(start) || []).length !== 1) continue;
      const n0 = adj.get(start)[0];
      if (used.has(eid(start, n0))) continue;
      open.push(walk(start, n0).nodes.map((id) => pos.get(id)));
    }
    for (const start of adj.keys()) {
      for (const n0 of adj.get(start)) {
        if (used.has(eid(start, n0))) continue;
        const traced = walk(start, n0);
        closed.push(traced.nodes.map((id) => pos.get(id)));
      }
    }
    return { open, closed };
  }
};
