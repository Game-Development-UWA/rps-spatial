function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp01(s);
  l = clamp01(l);
  if (s < 1e-6) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255)
  ];
}

function posterColor(name, lightOverride) {
  const cfg = CONFIG.poster || {};
  const spec = (cfg.ink && cfg.ink[name]) || { h: 0 };
  const sat = spec.sat != null ? spec.sat : (cfg.sat != null ? cfg.sat : 0.5);
  const light = lightOverride != null
    ? lightOverride
    : (spec.light != null ? spec.light : (cfg.light != null ? cfg.light : 0.55));
  const rgb = hslToRgb(spec.h || 0, sat, light);
  return {
    hsl: "hsl(" + (spec.h || 0) + " " + (sat * 100) + "% " + (light * 100) + "%)",
    hex: "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join(""),
    rgb: rgb,
    css: "rgba(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ", 0.95)"
  };
}

function applyPosterInk() {
  const sheet = document.querySelector(".sheet") || document.documentElement;
  ["rock", "paper", "scissors", "swarms", "genes", "mountains"].forEach((name) => {
    sheet.style.setProperty("--ink-" + name, posterColor(name).hsl);
  });
}

class PosterSADemo extends SADemo {
  constructor(panel) {
    super(panel);
    const trailL = (CONFIG.poster && CONFIG.poster.trailLight) != null
      ? CONFIG.poster.trailLight
      : 0.82;
    const rock = posterColor("rock");
    const paper = posterColor("paper");
    const scissors = posterColor("scissors");
    this.palette = [
      { trail: posterColor("rock", trailL).css, dot: rock.hex },
      { trail: posterColor("paper", trailL).css, dot: paper.hex },
      { trail: posterColor("scissors", trailL).css, dot: scissors.hex }
    ];
    this.walkers = [];
  }

  makeWalker(start, seed, color) {
    return {
      pos: { x: start.x, y: start.y },
      rng: rngFrom(seed),
      T: 0.6,
      trail: [],
      color
    };
  }

  reset(start, seed) {
    const spanX = this.plot.xMax - this.plot.xMin;
    const spanY = this.plot.yMax - this.plot.yMin;
    const homes = [
      { x: this.plot.xMin + spanX * 0.22, y: this.plot.yMin + spanY * 0.28 },
      { x: this.plot.xMin + spanX * 0.78, y: this.plot.yMin + spanY * 0.32 },
      { x: this.plot.xMin + spanX * 0.5, y: this.plot.yMin + spanY * 0.78 }
    ];
    this.walkers = this.palette.map((color, i) =>
      this.makeWalker(this.plot.clamp(homes[i]), (seed + i * 17) >>> 0, color)
    );
    this.cool = 0;
  }

  placeAround(p, seed) {
    const spanX = this.plot.xMax - this.plot.xMin;
    const spanY = this.plot.yMax - this.plot.yMin;
    this.reset(p, seed);
    this.walkers.forEach((w, i) => {
      const ang = (i / this.walkers.length) * Math.PI * 2;
      w.pos = this.plot.clamp({
        x: p.x + Math.cos(ang) * spanX * 0.16,
        y: p.y + Math.sin(ang) * spanY * 0.16
      });
      w.trail = [];
    });
  }

  stepWalker(w) {
    const nxt = this.plot.clamp({
      x: w.pos.x + this.dist.sample(w.rng),
      y: w.pos.y + this.dist.sample(w.rng)
    });
    const df = designedJ(nxt.x, nxt.y) - designedJ(w.pos.x, w.pos.y);
    const t = Math.max(w.T, 0.02);
    const p = df >= 0 ? 1 : Math.exp(df / t);
    if (w.rng() < p) {
      w.trail.push({ x: w.pos.x, y: w.pos.y });
      if (w.trail.length > 6) w.trail.shift();
      w.pos = nxt;
    }
    w.T *= 0.995;
    if (w.T < 0.03) w.T = 0.6;
  }

  tick(dt) {
    if (!this.alive) return;
    this.cool += dt;
    if (this.cool > 0.07) {
      this.cool = 0;
      this.walkers.forEach((w) => this.stepWalker(w));
    }
    this.draw();
  }

  draw() {
    const { plot } = this;
    plot.clear();
    plot.drawField();
    const ctx = plot.view.ctx;
    this.walkers.forEach((w) => {
      ctx.beginPath();
      w.trail.forEach((p, i) => {
        const s = plot.toScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      const now = plot.toScreen(w.pos.x, w.pos.y);
      if (w.trail.length) ctx.lineTo(now.x, now.y);
      ctx.strokeStyle = w.color.trail;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      drawDot(ctx, now.x, now.y, 7.2, w.color.dot);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyPosterInk();
  const fieldConfig = Object.assign({}, CONFIG.field, {
    cellPx: CONFIG.field.cellPx / 4,
    panSpeed: 0,
    yBias: 0
  });
  const field = new TerrainField(document.getElementById("field"), fieldConfig);
  const keys = new Set();
  const arrows = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };
  window.addEventListener("keydown", (e) => {
    if (!arrows[e.key]) return;
    e.preventDefault();
    keys.add(e.key);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key));
  let yHold = 0;
  field.beforeDraw = (seconds, dt) => {
    let dx = 0;
    let dy = 0;
    if (keys.has("ArrowLeft")) dx -= 1;
    if (keys.has("ArrowRight")) dx += 1;
    if (keys.has("ArrowUp")) dy += 1;
    if (keys.has("ArrowDown")) dy -= 1;
    const speed = 0.85;
    if (dx) field.setPanBias(field.panBiasWorld + dx * speed * dt);
    if (dy) {
      yHold += dy * speed * dt;
      if (Math.abs(yHold) >= 0.06) {
        field.setPanBiasY(field.panBiasY + yHold);
        yHold = 0;
      }
    }
  };
  const saPanel = document.querySelector('[data-demo="sa"]');
  const sa = saPanel ? new PosterSADemo(saPanel) : null;
  if (sa) {
    sa.reset({ x: 0, y: 0 }, (Math.random() * 1e9) | 0);
    sa.alive = true;
    sa.plot.layout();
    sa.plot.bake();
    sa.draw();
    bindPlace2D(sa.view, sa.plot, (p) => {
      sa.placeAround(p, (Math.random() * 1e9) | 0);
      sa.alive = true;
    });
  }
  field.afterDraw = (seconds, dt) => {
    if (sa) sa.tick(dt);
  };
  field.start();
});
