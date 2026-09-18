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
    this.layer = document.createElement("canvas");
    this.layerCtx = this.layer.getContext("2d");
    this.dirty = true;
    this.bakedAt = 0;
    this.padPx = 0;
    this.layerCssW = 0;
  }

  start() {
    this.resize();
    window.addEventListener("resize", () => this.resize());
    let last = 0;
    const tick = (now) => {
      const seconds = now / 1000;
      const dt = last ? Math.min(0.05, seconds - last) : 0;
      last = seconds;
      this.draw(seconds);
      if (this.afterDraw) this.afterDraw(seconds, dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const { canvas, ctx, config } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    canvas.width = Math.round(this.cssW * dpr);
    canvas.height = Math.round(this.cssH * dpr);
    canvas.style.width = this.cssW + "px";
    canvas.style.height = this.cssH + "px";
    this.padPx = (config.panPad || 0) * this.cssW;
    this.layerCssW = this.cssW + 2 * this.padPx;
    this.layer.width = Math.round(this.layerCssW * dpr);
    this.layer.height = canvas.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cols = Math.max(64, Math.round(this.layerCssW / config.cellPx));
    this.rows = Math.max(44, Math.round(this.cssH / config.cellPx));
    this.nx = this.cols + 1;
    this.z = new Float32Array(this.nx * (this.rows + 1));
    this.bakedAt = 0;
    this.dirty = true;
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
      px: x * c.worldScale + seconds * c.panSpeed,
      py: y * c.worldScale
    };
  }

  toWorld(px, py, seconds) {
    const c = this.config;
    return {
      x: (px - seconds * c.panSpeed) / c.worldScale,
      y: py / c.worldScale
    };
  }

  height(x, y, seconds, octaves) {
    const p = this.toLandscape(x, y, seconds || 0);
    return this.heightAtLandscape(p.px, p.py, octaves);
  }

  bakeRange(seconds) {
    const c = this.config;
    const vis = c.xMax - c.xMin;
    const padWorld = (this.padPx / this.cssW) * vis;
    const shift = ((seconds - this.bakedAt) * c.panSpeed) / c.worldScale;
    return {
      x0: c.xMin - padWorld + shift,
      x1: c.xMax + padWorld + shift,
      y0: c.yMin,
      y1: c.yMax
    };
  }

  sample(seconds) {
    const { cols, rows, nx } = this;
    const r = this.bakeRange(seconds);
    for (let j = 0; j <= rows; j++) {
      const y = r.y0 + (r.y1 - r.y0) * (j / rows);
      for (let i = 0; i <= cols; i++) {
        const x = r.x0 + (r.x1 - r.x0) * (i / cols);
        this.z[j * nx + i] = this.height(x, y, seconds);
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

  bakeContours(seconds) {
    const ctx = this.layerCtx;
    const { config: c, cols, rows, nx, cssH } = this;
    const w = this.layerCssW;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    const dpr = this.layer.width / w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgb(${c.background},${c.background},${c.background})`;
    ctx.fillRect(0, 0, w, cssH);
    this.sample(seconds);

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
    this.dirty = false;
  }

  panOffset(seconds) {
    const c = this.config;
    const vis = c.xMax - c.xMin;
    const worldShift = ((seconds - this.bakedAt) * c.panSpeed) / c.worldScale;
    return (worldShift / vis) * this.cssW;
  }

  draw(seconds) {
    let shift = this.panOffset(seconds);
    if (Math.abs(shift) > this.padPx * 0.8) {
      this.bakedAt = seconds;
      this.dirty = true;
      shift = 0;
    }
    if (this.dirty) this.bakeContours(this.bakedAt);
    const { ctx, cssW, cssH } = this;
    const dpr = this.canvas.width / cssW;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, -(this.padPx + shift) * dpr, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
