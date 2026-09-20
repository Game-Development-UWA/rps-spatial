const Contours = {
  paths(z, cols, rows, nx, level, cellW, cellH) {
    const pos = new Map();
    const adj = new Map();
    const hCount = (rows + 1) * cols;
    const H = (i, j) => j * cols + i;
    const V = (i, j) => hCount + j * nx + i;
    const lerp = (a, b, va, vb) => a + ((level - va) / (vb - va || 1e-9)) * (b - a);
    const key = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);

    const link = (a, b, pa, pb) => {
      pos.set(a, pa);
      pos.set(b, pb);
      let la = adj.get(a);
      if (!la) {
        la = [];
        adj.set(a, la);
      }
      let lb = adj.get(b);
      if (!lb) {
        lb = [];
        adj.set(b, lb);
      }
      la.push(b);
      lb.push(a);
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

        if (idx === 5 || idx === 10) {
          const mid = (v00 + v10 + v11 + v01) * 0.25 >= level;
          if ((idx === 5) === mid) {
            link(eL, eB, left, bottom);
            link(eR, eT, right, top);
          } else {
            link(eL, eT, left, top);
            link(eB, eR, bottom, right);
          }
          continue;
        }

        if (idx === 1 || idx === 14) link(eL, eB, left, bottom);
        else if (idx === 2 || idx === 13) link(eB, eR, bottom, right);
        else if (idx === 3 || idx === 12) link(eL, eR, left, right);
        else if (idx === 4 || idx === 11) link(eR, eT, right, top);
        else if (idx === 6 || idx === 9) link(eB, eT, bottom, top);
        else if (idx === 7 || idx === 8) link(eL, eT, left, top);
      }
    }

    const used = new Set();
    const walk = (start, first) => {
      const nodes = [start];
      let prev = start, cur = first;
      used.add(key(start, first));
      while (cur !== start) {
        nodes.push(cur);
        const nbrs = adj.get(cur);
        let next = null;
        for (let n = 0; n < nbrs.length; n++) {
          const k = nbrs[n];
          if (k !== prev && !used.has(key(cur, k))) {
            next = k;
            break;
          }
        }
        if (next == null) return { nodes, closed: false };
        used.add(key(cur, next));
        prev = cur;
        cur = next;
      }
      return { nodes, closed: true };
    };

    const open = [];
    const closed = [];
    for (const start of adj.keys()) {
      const nbrs = adj.get(start);
      if (nbrs.length !== 1) continue;
      const n0 = nbrs[0];
      if (used.has(key(start, n0))) continue;
      open.push(walk(start, n0).nodes.map((id) => pos.get(id)));
    }
    for (const start of adj.keys()) {
      const nbrs = adj.get(start);
      for (let n = 0; n < nbrs.length; n++) {
        const n0 = nbrs[n];
        if (used.has(key(start, n0))) continue;
        closed.push(walk(start, n0).nodes.map((id) => pos.get(id)));
      }
    }
    return { open, closed };
  },

  addAbove(ctx, z, cols, rows, nx, level, cellW, cellH, ox, oy) {
    ox = ox || 0;
    oy = oy || 0;
    const lerp = (a, b, va, vb) => a + ((level - va) / (vb - va || 1e-9)) * (b - a);
    const emit = (pts) => {
      ctx.moveTo(ox + pts[0][0], oy + pts[0][1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(ox + pts[k][0], oy + pts[k][1]);
      ctx.closePath();
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
        if (idx === 0) continue;

        const xA = i * cellW, xB = (i + 1) * cellW;
        const yA = j * cellH, yB = (j + 1) * cellH;
        if (idx === 15) {
          emit([[xA, yA], [xB, yA], [xB, yB], [xA, yB]]);
          continue;
        }

        const B = [lerp(xA, xB, v00, v10), yA];
        const R = [xB, lerp(yA, yB, v10, v11)];
        const T = [lerp(xA, xB, v01, v11), yB];
        const L = [xA, lerp(yA, yB, v00, v01)];
        const TL = [xA, yA], TR = [xB, yA], BR = [xB, yB], BL = [xA, yB];

        if (idx === 5 || idx === 10) {
          const mid = (v00 + v10 + v11 + v01) * 0.25 >= level;
          const pair00 = (idx === 5) === mid;
          if (idx === 5) {
            if (pair00) {
              emit([TL, B, L]);
              emit([BR, T, R]);
            } else emit([TL, B, R, BR, T, L]);
          } else if (pair00) emit([TR, R, T, BL, L, B]);
          else {
            emit([TR, R, B]);
            emit([BL, L, T]);
          }
          continue;
        }

        if (idx === 1) emit([TL, B, L]);
        else if (idx === 2) emit([TR, R, B]);
        else if (idx === 4) emit([BR, T, R]);
        else if (idx === 8) emit([BL, L, T]);
        else if (idx === 3) emit([TL, TR, R, L]);
        else if (idx === 6) emit([TR, BR, T, B]);
        else if (idx === 12) emit([BR, BL, L, R]);
        else if (idx === 9) emit([TL, B, T, BL]);
        else if (idx === 7) emit([TL, TR, BR, T, L]);
        else if (idx === 14) emit([TR, BR, BL, L, B]);
        else if (idx === 13) emit([TL, B, R, BR, BL]);
        else if (idx === 11) emit([TL, TR, R, T, BL]);
      }
    }
  }
};
