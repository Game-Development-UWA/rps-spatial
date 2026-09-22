class TerrainField {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true }) || canvas.getContext("2d");
    this.config = config;
    this.noise = new Perlin(config.seed);
    this.cols = 0;
    this.rows = 0;
    this.nx = 0;
    this.cssW = 0;
    this.cssH = 0;
    this.overlapPx = 0;
    this.overlapDev = 0;
    this.tileCssW = 0;
    this.screenPxW = 0;
    this.screenPxH = 0;
    this.tiles = new Map();
    this.panBiasWorld = 0;
    this.panBiasY = 0;
    this.hintBias = 0;
    this.slideCount = 1;
    this.panPush = 0.8;
    this.generation = 0;
    this.queued = new Set();
    this.inflight = null;
    this.worker = null;
    this.shadeLut = [];
    this.zScratch = null;
    this.raf = 0;
    this.lastTick = 0;
    this.bootWorker();
  }

  bootWorker() {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return;
    try {
      this.worker = new Worker("field-worker.js");
      this.worker.onmessage = (e) => this.onWorker(e.data);
      this.worker.onerror = () => this.dropWorker();
    } catch (err) {
      this.worker = null;
    }
  }

  dropWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.inflight != null) {
      this.queued.add(this.inflight);
      this.inflight = null;
    }
  }

  attachDeck(deck) {
    this.slideCount = deck.columns.length;
    this.panPush = deck.config.panPush != null ? deck.config.panPush : 0.8;
  }

  start() {
    this.resize();
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.disarm();
      else this.arm();
    });
    if (!document.hidden) this.arm();
  }

  disarm() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastTick = 0;
  }

  arm() {
    if (this.raf || document.hidden) return;
    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      const maxFps = this.config.maxFps == null ? 30 : this.config.maxFps;
      if (maxFps > 0 && this.lastTick && now - this.lastTick < 1000 / maxFps) return;
      const seconds = now / 1000;
      const dt = this.lastTick ? Math.min(0.05, (now - this.lastTick) / 1000) : 0;
      this.lastTick = now;
      if (this.beforeDraw) this.beforeDraw(seconds, dt);
      this.draw(seconds);
      if (this.afterDraw) this.afterDraw(seconds, dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  layoutPayload() {
    return {
      cols: this.cols,
      rows: this.rows,
      nx: this.nx,
      cssW: this.cssW,
      cssH: this.cssH,
      tileCssW: this.tileCssW,
      overlapPx: this.overlapPx,
      pixelW: this.screenPxW + 2 * this.overlapDev,
      pixelH: this.screenPxH
    };
  }

  resize() {
    const { canvas, ctx, config } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const host = canvas.parentElement;
    const cssW = host ? host.clientWidth : window.innerWidth;
    const cssH = host ? host.clientHeight : window.innerHeight;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (w === canvas.width && h === canvas.height && this.cols) return;
    this.cssW = cssW;
    this.cssH = cssH;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.screenPxW = canvas.width;
    this.screenPxH = canvas.height;
    this.overlapDev = Math.round(Math.max(config.cellPx * 2, 24) * dpr);
    this.overlapPx = this.overlapDev / dpr;
    this.tileCssW = this.cssW + 2 * this.overlapPx;
    this.cols = Math.min(120, Math.max(48, Math.round(this.tileCssW / config.cellPx)));
    this.rows = Math.min(80, Math.max(32, Math.round(this.cssH / config.cellPx)));
    this.nx = this.cols + 1;
    this.zScratch = new Float32Array(this.nx * (this.rows + 1));
    this.rebuildTiles();
  }

  rebuildTiles() {
    this.tiles.forEach((tile) => this.disposeTile(tile));
    this.tiles.clear();
    this.queued.clear();
    this.inflight = null;
    this.generation += 1;
    this.shadeLut = [];
    if (this.worker) {
      this.worker.postMessage({
        type: "setup",
        generation: this.generation,
        config: this.config,
        layout: this.layoutPayload()
      });
    }
  }

  heightAtLandscape(px, py, octaves) {
    return landscapeHeight(this.noise, this.config, px, py, octaves);
  }

  toLandscape(x, y, seconds) {
    const c = this.config;
    return {
      px: x * c.worldScale + seconds * c.panSpeed + this.panBiasWorld * c.worldScale,
      py: (y + this.panBiasY) * c.worldScale
    };
  }

  toWorld(px, py, seconds) {
    const c = this.config;
    return {
      x: (px - seconds * c.panSpeed) / c.worldScale - this.panBiasWorld,
      y: py / c.worldScale - this.panBiasY
    };
  }

  height(x, y, seconds, octaves) {
    const p = this.toLandscape(x, y, seconds || 0);
    return this.heightAtLandscape(p.px, p.py, octaves);
  }

  vis() {
    return this.config.xMax - this.config.xMin;
  }

  panOffset(seconds) {
    const c = this.config;
    const worldShift = (seconds * c.panSpeed) / c.worldScale + this.panBiasWorld;
    return (worldShift / this.vis()) * this.cssW;
  }

  setPanBias(world) {
    this.panBiasWorld = world;
  }

  setPanBiasY(world) {
    if (world === this.panBiasY) return;
    this.panBiasY = world;
    this.config.yBias = world;
    this.rebuildTiles();
  }

  hintPanBias(world) {
    this.hintBias = world;
  }

  stripRange(seconds) {
    const vis = this.vis();
    const time = (seconds * this.config.panSpeed) / this.config.worldScale;
    const n = Math.max(1, this.slideCount);
    const hiBias = (n - 1) * this.panPush * vis;
    const lo = Math.floor(time / vis);
    const hi = Math.floor((time + hiBias) / vis + 1 - 1e-6);
    const shown = this.visibleTiles(this.panOffset(seconds));
    return { lo: Math.min(lo, shown.first), hi: Math.max(hi, shown.last) };
  }

  visibleTiles(shift) {
    const w = this.cssW;
    const first = Math.floor(shift / w);
    const last = Math.floor((shift + w - 1e-6) / w);
    return { first, last };
  }

  disposeTile(tile) {
    if (tile && tile.bitmap && tile.bitmap.close) tile.bitmap.close();
  }

  releaseTile(index) {
    const tile = this.tiles.get(index);
    if (!tile) return;
    this.tiles.delete(index);
    this.disposeTile(tile);
  }

  onWorker(msg) {
    if (msg.type !== "tile") return;
    if (msg.generation !== this.generation) {
      if (msg.bitmap && msg.bitmap.close) msg.bitmap.close();
      return;
    }
    const prev = this.tiles.get(msg.index);
    if (prev) this.disposeTile(prev);
    this.tiles.set(msg.index, { bitmap: msg.bitmap });
    if (this.inflight === msg.index) this.inflight = null;
    this.queued.delete(msg.index);
    this.kickBake();
  }

  requestTile(index) {
    if (this.tiles.has(index) || this.queued.has(index) || this.inflight === index) return;
    this.queued.add(index);
  }

  kickBake() {
    if (this.inflight != null || !this.queued.size) return;
    let best = null;
    let bestDist = Infinity;
    const vis = this.visibleTiles(this.panOffset(performance.now() / 1000));
    const mid = (vis.first + vis.last) / 2;
    this.queued.forEach((i) => {
      const d = Math.abs(i - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    this.queued.delete(best);
    this.inflight = best;
    if (this.worker) {
      this.worker.postMessage({ type: "bake", index: best, generation: this.generation });
      return;
    }
    this.bakeLocal(best);
  }

  bakeLocal(index) {
    const L = this.layoutPayload();
    const canvas = document.createElement("canvas");
    canvas.width = L.pixelW;
    canvas.height = L.pixelH;
    const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
    bakeLandscapeTile(ctx, {
      config: this.config,
      cols: L.cols,
      rows: L.rows,
      nx: L.nx,
      cssW: L.cssW,
      cssH: L.cssH,
      tileCssW: L.tileCssW,
      pixelW: L.pixelW,
      pixelH: L.pixelH,
      overlapPx: L.overlapPx,
      index,
      noise: this.noise,
      z: this.zScratch,
      shadeLut: this.shadeLut
    });
    const prev = this.tiles.get(index);
    if (prev) this.disposeTile(prev);
    this.tiles.set(index, { bitmap: canvas });
    this.inflight = null;
  }

  ensureTiles(seconds) {
    const shift = this.panOffset(seconds);
    const { first, last } = this.visibleTiles(shift);
    const strip = this.stripRange(seconds);
    for (let i = strip.lo; i <= strip.hi; i++) this.requestTile(i);
    this.tiles.forEach((_, i) => {
      if (i < strip.lo || i > strip.hi) this.releaseTile(i);
    });
    this.queued.forEach((i) => {
      if (i < strip.lo || i > strip.hi) this.queued.delete(i);
    });
    this.kickBake();
    return { shift, first, last };
  }

  draw(seconds) {
    const { shift, first, last } = this.ensureTiles(seconds);
    const { ctx, screenPxW, screenPxH, overlapDev } = this;
    const dpr = this.canvas.width / this.cssW;
    const c = this.config;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgb(" + c.background + "," + c.background + "," + c.background + ")";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const origin = Math.round(-shift * dpr);
    for (let i = first; i <= last; i++) {
      const tile = this.tiles.get(i);
      if (!tile || !tile.bitmap) continue;
      ctx.drawImage(
        tile.bitmap,
        overlapDev, 0, screenPxW, screenPxH,
        origin + i * screenPxW, 0, screenPxW, screenPxH
      );
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
