class TerrainField {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.config = config;
    this.noise = new Perlin(config.seed);
    this.cols = 0;
    this.rows = 0;
    this.nx = 0;
    this.cssW = 0;
    this.cssH = 0;
    this.z = null;
    this.overlapPx = 0;
    this.overlapDev = 0;
    this.tileCssW = 0;
    this.screenPxW = 0;
    this.screenPxH = 0;
    this.tiles = new Map();
    this.pool = [];
    this.panBiasWorld = 0;
    this.hintBias = 0;
  }

  start() {
    this.resize();
    window.addEventListener("resize", () => this.resize());
    let last = 0;
    const tick = (now) => {
      const seconds = now / 1000;
      const dt = last ? Math.min(0.05, seconds - last) : 0;
      last = seconds;
      if (this.beforeDraw) this.beforeDraw(seconds, dt);
      this.draw(seconds);
      if (this.afterDraw) this.afterDraw(seconds, dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const { canvas, ctx, config } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const host = canvas.parentElement;
    this.cssW = host ? host.clientWidth : window.innerWidth;
    this.cssH = host ? host.clientHeight : window.innerHeight;
    canvas.width = Math.round(this.cssW * dpr);
    canvas.height = Math.round(this.cssH * dpr);
    canvas.style.width = this.cssW + "px";
    canvas.style.height = this.cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.screenPxW = canvas.width;
    this.screenPxH = canvas.height;
    this.overlapDev = Math.round(Math.max(config.cellPx * 4, 40) * (canvas.width / this.cssW));
    this.overlapPx = this.overlapDev / (this.screenPxW / this.cssW);
    this.tileCssW = this.cssW + 2 * this.overlapPx;
    this.cols = Math.max(64, Math.round(this.tileCssW / config.cellPx));
    this.rows = Math.max(44, Math.round(this.cssH / config.cellPx));
    this.nx = this.cols + 1;
    this.z = new Float32Array(this.nx * (this.rows + 1));
    this.tiles.clear();
    this.pool.length = 0;
  }

  heightAtLandscape(px, py, octaves) {
    const c = this.config;
    const n = this.noise;
    const oct = octaves == null ? c.octaves : octaves;
    const wx = px + c.warp * n.fbm(px + 3.1, py, Math.min(3, oct), c.persistence);
    const wy = py + c.warp * n.fbm(px + 17.7, py + 8.2, Math.min(3, oct), c.persistence);
    return n.fbm(wx, wy, oct, c.persistence);
  }

  toLandscape(x, y, seconds) {
    const c = this.config;
    return {
      px: x * c.worldScale + seconds * c.panSpeed + this.panBiasWorld * c.worldScale,
      py: y * c.worldScale
    };
  }

  toWorld(px, py, seconds) {
    const c = this.config;
    return {
      x: (px - seconds * c.panSpeed) / c.worldScale - this.panBiasWorld,
      y: py / c.worldScale
    };
  }

  height(x, y, seconds, octaves) {
    const p = this.toLandscape(x, y, seconds || 0);
    return this.heightAtLandscape(p.px, p.py, octaves);
  }

  heightAtOrigin(x, y) {
    const c = this.config;
    return this.heightAtLandscape(x * c.worldScale, y * c.worldScale);
  }

  vis() {
    return this.config.xMax - this.config.xMin;
  }

  tileWorldRange(index) {
    const c = this.config;
    const vis = this.vis();
    const overlapWorld = (this.overlapPx / this.cssW) * vis;
    return {
      x0: c.xMin + index * vis - overlapWorld,
      x1: c.xMin + (index + 1) * vis + overlapWorld,
      y0: c.yMin,
      y1: c.yMax
    };
  }

  sampleTile(index) {
    const { cols, rows, nx } = this;
    const r = this.tileWorldRange(index);
    for (let j = 0; j <= rows; j++) {
      const y = r.y0 + (r.y1 - r.y0) * (j / rows);
      for (let i = 0; i <= cols; i++) {
        const x = r.x0 + (r.x1 - r.x0) * (i / cols);
        this.z[j * nx + i] = this.heightAtOrigin(x, y);
      }
    }
  }

  shade(t) {
    const g = Math.round(this.config.background + this.config.lineMin + t * this.config.lineRange);
    return `rgb(${g},${g},${g})`;
  }

  splineTo(ctx, pts, closed) {
    const n = pts.length;
    if (n < 2) return;
    if (n === 2) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      return;
    }
    const at = (k) => {
      if (closed) return pts[(k + n) % n];
      if (k < 0) return pts[0];
      if (k >= n) return pts[n - 1];
      return pts[k];
    };
    ctx.moveTo(pts[0][0], pts[0][1]);
    const steps = closed ? n : n - 1;
    for (let k = 0; k < steps; k++) {
      const p0 = at(k - 1), p1 = at(k), p2 = at(k + 1), p3 = at(k + 2);
      ctx.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6,
        p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6,
        p2[1] - (p3[1] - p1[1]) / 6,
        p2[0], p2[1]
      );
    }
  }

  acquireCanvas() {
    const dpr = this.canvas.width / this.cssW;
    const canvas = this.pool.pop() || document.createElement("canvas");
    canvas.width = this.screenPxW + 2 * this.overlapDev;
    canvas.height = this.screenPxH;
    return canvas;
  }

  releaseTile(index) {
    const tile = this.tiles.get(index);
    if (!tile) return;
    this.tiles.delete(index);
    this.pool.push(tile.canvas);
  }

  bakeTile(index) {
    const canvas = this.acquireCanvas();
    const ctx = canvas.getContext("2d");
    const { config: c, cols, rows, nx, cssH, tileCssW: w } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = canvas.width / w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgb(${c.background},${c.background},${c.background})`;
    ctx.fillRect(0, 0, w, cssH);
    this.sampleTile(index);

    const cellW = w / cols;
    const cellH = cssH / rows;
    const depth = c.bandDepth || 0;
    if (depth > 0) {
      const span = c.zMax - c.zMin || 1;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const avg = (
            this.z[j * nx + i] +
            this.z[j * nx + i + 1] +
            this.z[(j + 1) * nx + i] +
            this.z[(j + 1) * nx + i + 1]
          ) * 0.25;
          let t = (avg - c.zMin) / span;
          t = Math.max(0, Math.min(1, t));
          t = Math.floor(t * c.levels) / c.levels;
          const g = Math.max(0, c.background - Math.round((1 - t) * depth));
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.fillRect(i * cellW, j * cellH, cellW + 0.6, cellH + 0.6);
        }
      }
    }

    ctx.lineWidth = c.lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (let L = 0; L < c.levels; L++) {
      const u = L / (c.levels - 1);
      const level = c.zMin + (c.zMax - c.zMin) * (0.08 + 0.84 * u);
      const { open, closed } = Contours.paths(this.z, cols, rows, nx, level, cellW, cellH);
      ctx.strokeStyle = this.shade(u);
      ctx.beginPath();
      for (const pts of open) {
        if (pts.length >= c.minOpenPoints) this.splineTo(ctx, pts, false);
      }
      for (const pts of closed) {
        if (pts.length >= c.minClosedPoints) this.splineTo(ctx, pts, true);
      }
      ctx.stroke();
    }

    this.tiles.set(index, { canvas });
  }

  panOffset(seconds) {
    const c = this.config;
    const worldShift = (seconds * c.panSpeed) / c.worldScale + this.panBiasWorld;
    return (worldShift / this.vis()) * this.cssW;
  }

  setPanBias(world) {
    this.panBiasWorld = world;
  }

  hintPanBias(world) {
    this.hintBias = world;
  }

  visibleTiles(shift) {
    const w = this.cssW;
    const first = Math.floor(shift / w);
    const last = Math.floor((shift + w - 1e-6) / w);
    return { first, last };
  }

  desiredTiles(first, last, seconds) {
    const ahead = this.config.prefetchAhead || 4;
    const behind = this.config.prefetchBehind ?? 1;
    let lo = first - behind;
    let hi = last + ahead;
    const hintShift =
      (seconds * this.config.panSpeed) / this.config.worldScale + this.hintBias;
    const hint = Math.floor(hintShift / this.vis());
    lo = Math.min(lo, hint - behind);
    hi = Math.max(hi, hint + ahead);
    const want = [];
    for (let i = lo; i <= hi; i++) want.push(i);
    return want;
  }

  evict(keep, first, last) {
    const maxTiles = this.config.maxTiles || keep.length + 2;
    if (this.tiles.size <= maxTiles) return;
    const keepSet = new Set(keep);
    const extra = [...this.tiles.keys()].filter((k) => {
      if (k >= first && k <= last) return false;
      return !keepSet.has(k);
    });
    extra.sort((a, b) => {
      const mid = (keep[0] + keep[keep.length - 1]) / 2;
      return Math.abs(b - mid) - Math.abs(a - mid);
    });
    while (this.tiles.size > maxTiles && extra.length) this.releaseTile(extra.shift());
  }

  ensureTiles(seconds) {
    const shift = this.panOffset(seconds);
    const { first, last } = this.visibleTiles(shift);
    const want = this.desiredTiles(first, last, seconds);
    for (let i = first; i <= last; i++) {
      if (!this.tiles.has(i)) this.bakeTile(i);
    }
    const budget = this.config.bakeBudgetMs || 8;
    const t0 = performance.now();
    const missing = want.filter((i) => !this.tiles.has(i));
    missing.sort((a, b) => Math.abs(a - first) - Math.abs(b - first));
    for (const i of missing) {
      if (performance.now() - t0 >= budget) break;
      this.bakeTile(i);
    }
    this.evict(want, first, last);
    return { shift, first, last };
  }

  draw(seconds) {
    const { shift, first, last } = this.ensureTiles(seconds);
    const { ctx, screenPxW, screenPxH, overlapDev } = this;
    const dpr = this.canvas.width / this.cssW;
    const c = this.config;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${c.background},${c.background},${c.background})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const origin = Math.round(-shift * dpr);
    for (let i = first; i <= last; i++) {
      const tile = this.tiles.get(i);
      if (!tile) continue;
      ctx.drawImage(
        tile.canvas,
        overlapDev, 0, screenPxW, screenPxH,
        origin + i * screenPxW, 0, screenPxW, screenPxH
      );
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
