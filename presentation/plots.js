const World1D = {
  xMin: -2.45,
  xMax: 2.45,
  flat: 0.28,
  shift: 1.55,
  tilt: -0.1,
  bumps: [
    { m: -1.78, s: 0.32, a: 2.45 },
    { m: -0.72, s: 0.22, a: 1.05 },
    { m: 0.22, s: 0.26, a: 1.65 },
    { m: 1.55, s: 0.36, a: 3.25 }
  ],
  bump(x, b) {
    const u = (x - b.m) / b.s;
    return b.a * Math.exp(-0.5 * u * u);
  },
  f(x) {
    let y = -this.shift + this.tilt * x;
    for (const b of this.bumps) y += this.bump(x, b);
    return y;
  },
  df(x) {
    let d = this.tilt;
    for (const b of this.bumps) {
      const g = this.bump(x, b);
      d += g * (-(x - b.m) / (b.s * b.s));
    }
    return d;
  },
  ddf(x) {
    let d = 0;
    for (const b of this.bumps) {
      const g = this.bump(x, b);
      const s2 = b.s * b.s;
      const xm = x - b.m;
      d += g * ((xm * xm - s2) / (s2 * s2));
    }
    return d;
  },
  clamp(x) {
    return Math.max(this.xMin, Math.min(this.xMax, x));
  },
  sampleRange(fn) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 240; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / 240);
      const y = fn(x);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const pad = Math.max(0.18, (hi - lo) * 0.16);
    return { yMin: lo - pad, yMax: hi + pad };
  },
  crit() {
    if (this._crit) return this._crit;
    const pts = [];
    const n = 420;
    let prev = this.xMin;
    let pd = this.df(prev);
    for (let i = 1; i <= n; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / n);
      const d = this.df(x);
      if (pd === 0) pts.push(prev);
      else if (pd * d < 0) {
        let lo = prev;
        let hi = x;
        for (let k = 0; k < 28; k++) {
          const m = (lo + hi) / 2;
          if (this.df(lo) * this.df(m) <= 0) hi = m;
          else lo = m;
        }
        pts.push((lo + hi) / 2);
      }
      prev = x;
      pd = d;
    }
    this._crit = pts;
    return pts;
  },
  peaks() {
    return this.crit().filter((x) => this.ddf(x) < -0.25);
  },
  globalPeak() {
    const peaks = this.peaks();
    let best = peaks[0];
    for (const p of peaks) if (this.f(p) > this.f(best)) best = p;
    return best;
  },
  fadeX() {
    const mins = this.crit().filter((x) => this.ddf(x) > 0.1);
    return mins.length ? mins[0] : 0;
  }
};

function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x7feb352d);
    s = Math.imul(s ^ (s >>> 15), 0x846ca68b);
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

class Neighbourhood {
  constructor(kind, param) {
    this.kind = kind;
    this.param = param;
  }

  pdf(off) {
    if (this.kind === "uniform") {
      return Math.abs(off) <= this.param ? 1 / (2 * this.param || 1) : 0;
    }
    const s = Math.max(this.param, 1e-4);
    return Math.exp(-(off * off) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));
  }

  pdfPeak() {
    if (this.kind === "uniform") return 1 / (2 * this.param || 1);
    const s = Math.max(this.param, 1e-4);
    return 1 / (s * Math.sqrt(2 * Math.PI));
  }

  sample(rng) {
    if (this.kind === "uniform") return (rng() * 2 - 1) * this.param;
    let u = rng();
    const v = rng();
    if (u < 1e-9) u = 1e-9;
    return this.param * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  span() {
    return this.kind === "uniform" ? this.param : this.param * 3.2;
  }
}

class Phases {
  constructor(steps, onEnter) {
    this.steps = steps;
    this.onEnter = onEnter;
    this.i = 0;
    this.t = 0;
    this.playing = false;
  }

  get id() {
    return this.steps[this.i].id;
  }

  reset(play) {
    this.i = 0;
    this.t = 0;
    if (play != null) this.playing = play;
    if (this.onEnter) this.onEnter(this.id, this.i);
  }

  advance() {
    this.i = (this.i + 1) % this.steps.length;
    this.t = 0;
    if (this.onEnter) this.onEnter(this.id, this.i);
  }

  tick(dt) {
    if (!this.playing) return;
    this.t += dt;
    const dur = this.steps[this.i].dur;
    if (this.t >= dur) this.advance();
  }
}

function iconSvg(name) {
  const paths = {
    play: '<path d="M5 3.2v13.6L17 10z"/>',
    pause: '<path d="M4.2 3.2h3.4v13.6H4.2zm8.2 0h3.4v13.6h-3.4z"/>',
    step: '<path d="M3.6 3.4v13.2h2V3.4zm3.4 0v13.2L16.6 10z"/>',
    repeat: '<path d="M4.1 10A5.9 5.9 0 0 1 14.2 6.2L16 4.4V9h-4.6l1.6-1.6A4.1 4.1 0 1 0 14.1 13h1.85A5.9 5.9 0 0 1 4.1 10z"/>',
    rand: '<path d="M10 3.1a6.9 6.9 0 1 0 6.5 8.9h-2.15a4.75 4.75 0 1 1-4.35-6.7 4.6 4.6 0 0 1 3.35 1.45L11.8 8.3H17V3.1l-1.7 1.8A6.9 6.9 0 0 0 10 3.1z"/>'
  };
  return '<svg viewBox="0 0 20 20" aria-hidden="true">' + (paths[name] || "") + "</svg>";
}

class PanelView {
  constructor(panel, controls) {
    this.panel = panel;
    panel.innerHTML = "";
    this.stage = document.createElement("div");
    this.stage.className = "demo-stage";
    this.canvas = document.createElement("canvas");
    this.stage.appendChild(this.canvas);
    this.bubble = document.createElement("div");
    this.bubble.className = "demo-bubble";
    this.bubble.hidden = true;
    this.stage.appendChild(this.bubble);
    panel.appendChild(this.stage);
    this.btns = {};
    this.sliders = {};
    if (controls && controls.length) {
      this.bar = document.createElement("div");
      this.bar.className = "demo-bar";
      controls.forEach((spec) => this.addControl(spec));
      panel.appendChild(this.bar);
    }
    this.ctx = this.canvas.getContext("2d");
    this.cssW = 0;
    this.cssH = 0;
    this.onResize = null;
    this.resize();
    new ResizeObserver(() => {
      if (this.resize() && this.onResize) this.onResize();
    }).observe(panel);
  }

  addControl(spec) {
    if (spec.type === "button") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", spec.label);
      const icon = spec.icon || spec.key;
      if (iconSvg(icon).indexOf("<path") >= 0) {
        btn.className = "demo-icon";
        btn.innerHTML = iconSvg(icon);
      } else btn.textContent = spec.label;
      btn.addEventListener("click", spec.onClick);
      this.bar.appendChild(btn);
      this.btns[spec.key] = btn;
      return;
    }
    if (spec.type === "range") {
      const wrap = document.createElement("label");
      wrap.className = "demo-slider";
      const name = document.createElement("span");
      name.textContent = spec.label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step;
      input.value = spec.value;
      const val = document.createElement("strong");
      const fmt = spec.fmt || ((n) => Number(n).toFixed(2));
      val.textContent = fmt(spec.value);
      input.addEventListener("input", () => {
        val.textContent = fmt(input.value);
        if (spec.onInput) spec.onInput(Number(input.value));
      });
      wrap.appendChild(name);
      wrap.appendChild(input);
      wrap.appendChild(val);
      this.bar.appendChild(wrap);
      this.sliders[spec.key] = input;
    }
  }

  setPlay(on) {
    const btn = this.btns.play;
    if (!btn) return;
    const icon = on ? "pause" : "play";
    btn.setAttribute("aria-label", on ? "Pause" : "Play");
    if (btn.classList.contains("demo-icon")) btn.innerHTML = iconSvg(icon);
    else btn.textContent = on ? "Pause" : "Play";
  }

  showBubble(text, x, y) {
    this.bubble.hidden = false;
    this.bubble.textContent = text;
    const w = this.bubble.offsetWidth || 160;
    const left = Math.max(8, Math.min(this.cssW - w - 8, x + 10));
    const top = Math.max(8, y - 46);
    this.bubble.style.left = left + "px";
    this.bubble.style.top = top + "px";
  }

  hideBubble() {
    this.bubble.hidden = true;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    const w = Math.round(this.cssW * dpr);
    const h = Math.round(this.cssH * dpr);
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
}

function hexRgb(hex) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3
    ? h.split("").map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return n;
}

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function cssRgb(rgb, a) {
  if (a == null || a >= 0.999) return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
  return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
}

function demoStops() {
  const raw = (typeof CONFIG !== "undefined" && CONFIG.demo && CONFIG.demo.palette) || [
    "#2a62c8", "#2f9d62", "#d43c3c"
  ];
  return (Array.isArray(raw) ? raw : [raw]).map(hexRgb);
}

function paletteAt(t, stops) {
  const cols = stops || demoStops();
  if (cols.length === 1) return cols[0];
  const u = Math.max(0, Math.min(1, t)) * (cols.length - 1);
  const i = Math.min(cols.length - 2, Math.floor(u));
  return mixRgb(cols[i], cols[i + 1], u - i);
}

function clipPlotBox(ctx, box, radius) {
  if (!box || box.w <= 0 || box.h <= 0) return;
  const r = radius == null
    ? Math.min(16, box.w * 0.06, box.h * 0.06)
    : Math.max(0, radius);
  ctx.beginPath();
  if (r > 0 && typeof ctx.roundRect === "function") ctx.roundRect(box.x, box.y, box.w, box.h, r);
  else ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
}

class CurvePlot {
  constructor(view, opts) {
    this.view = view;
    this.fn = (opts && opts.fn) || ((x) => World1D.f(x));
    this.xMin = (opts && opts.xMin) || World1D.xMin;
    this.xMax = (opts && opts.xMax) || World1D.xMax;
    const range = World1D.sampleRange(this.fn);
    this.yMin = range.yMin;
    this.yMax = range.yMax;
    this.strip = !!(opts && opts.strip);
    this.layout();
  }

  layout() {
    const strip = this.strip ? 46 : 0;
    this.pad = { t: 14, r: 16, b: 12 + strip, l: 28 };
    const w = this.view.cssW;
    const h = this.view.cssH;
    this.box = {
      x: this.pad.l,
      y: this.pad.t,
      w: Math.max(8, w - this.pad.l - this.pad.r),
      h: Math.max(8, h - this.pad.t - this.pad.b)
    };
    if (this.strip) {
      this.stripBox = {
        x: this.box.x,
        y: this.box.y + this.box.h + 12,
        w: this.box.w,
        h: 30
      };
    }
  }

  toScreen(x, y) {
    const box = this.box;
    return {
      x: box.x + ((x - this.xMin) / (this.xMax - this.xMin)) * box.w,
      y: box.y + (1 - (y - this.yMin) / (this.yMax - this.yMin)) * box.h
    };
  }

  xFromPointer(mx) {
    const box = this.box;
    if (mx < box.x - 8 || mx > box.x + box.w + 8) return null;
    const t = (mx - box.x) / box.w;
    return World1D.clamp(this.xMin + t * (this.xMax - this.xMin));
  }

  clear() {
    this.view.ctx.clearRect(0, 0, this.view.cssW, this.view.cssH);
  }

  drawAxes() {
    const ctx = this.view.ctx;
    const origin = this.toScreen(0, 0);
    const box = this.box;
    ctx.save();
    clipPlotBox(ctx, box);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, origin.y);
    ctx.lineTo(box.x + box.w, origin.y);
    ctx.moveTo(origin.x, box.y);
    ctx.lineTo(origin.x, box.y + box.h);
    ctx.stroke();
    ctx.restore();
  }

  drawCurve(eastAlpha) {
    if (eastAlpha == null) eastAlpha = 1;
    const ctx = this.view.ctx;
    const box = this.box;
    ctx.save();
    clipPlotBox(ctx, box);
    const span = this.yMax - this.yMin || 1;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let prev = null;
    for (let i = 0; i <= 220; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / 220);
      const y = this.fn(x);
      const p = this.toScreen(x, y);
      if (prev) {
        const t = (y - this.yMin) / span;
        const fade = x > World1D.fadeX() ? eastAlpha : 1;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = cssRgb(paletteAt(t), 0.9 * fade);
        ctx.stroke();
      }
      prev = p;
    }
    ctx.restore();
  }

  drawDashed(fn, color) {
    const ctx = this.view.ctx;
    const box = this.box;
    ctx.save();
    clipPlotBox(ctx, box);
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / 180);
      const p = this.toScreen(x, fn(x));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = color || "rgba(180,180,180,0.8)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  drawTangent(x, span) {
    const ctx = this.view.ctx;
    const y = this.fn(x);
    const slope = World1D.df(x);
    const s = span == null ? 0.55 : span;
    const a = this.toScreen(x - s, y - slope * s);
    const b = this.toScreen(x + s, y + slope * s);
    ctx.save();
    clipPlotBox(ctx, this.box);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(180,180,180,0.95)";
    ctx.lineWidth = 1.35;
    ctx.stroke();
    ctx.restore();
  }

  drawVLine(x, color) {
    const ctx = this.view.ctx;
    const p = this.toScreen(x, this.fn(x));
    ctx.save();
    clipPlotBox(ctx, this.box);
    ctx.beginPath();
    ctx.moveTo(p.x, this.box.y);
    ctx.lineTo(p.x, this.box.y + this.box.h);
    ctx.strokeStyle = color || "rgba(210,210,210,0.45)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }
}

function drawDot(ctx, x, y, r, fill, stroke) {
  const radius = r == null ? 7 : r;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill || "#f4f4f4";
  ctx.fill();
  if (stroke !== false) {
    ctx.strokeStyle = stroke || "rgba(8,8,10,0.92)";
    ctx.lineWidth = Math.max(1.6, radius * 0.28);
    ctx.stroke();
  }
}

function drawArrow(ctx, x0, y0, x1, y1, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.stroke();
  const a = Math.atan2(dy, dx);
  const head = 11;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4));
  ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

const DistStrip = {
  draw(ctx, box, spec) {
    if (!box) return;
    const along = spec.axis !== "y";
    const world0 = spec.world0;
    const world1 = spec.world1;
    const origin = spec.origin;
    const neighbourhood = spec.neighbourhood;
    ctx.save();
    clipPlotBox(ctx, box);
    const mid = along ? box.y + box.h * 0.72 : box.x + box.w * 0.28;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (along) {
      ctx.moveTo(box.x, mid);
      ctx.lineTo(box.x + box.w, mid);
    } else {
      ctx.moveTo(mid, box.y);
      ctx.lineTo(mid, box.y + box.h);
    }
    ctx.stroke();

    const toPix = (w) => {
      const t = (w - world0) / (world1 - world0);
      if (along) return box.x + t * box.w;
      return box.y + (1 - t) * box.h;
    };
    const peak = neighbourhood.pdfPeak();
    const amp = along ? box.h * 0.78 : box.w * 0.78;
    ctx.beginPath();
    const steps = 80;
    if (along) ctx.moveTo(toPix(world0), mid);
    else ctx.moveTo(mid, toPix(world0));
    for (let i = 0; i <= steps; i++) {
      const w = world0 + (world1 - world0) * (i / steps);
      const p = neighbourhood.pdf(w - origin);
      const h = (p / (peak || 1)) * amp;
      const pix = toPix(w);
      if (along) ctx.lineTo(pix, mid - h);
      else ctx.lineTo(mid + h, pix);
    }
    if (along) {
      ctx.lineTo(toPix(world1), mid);
      ctx.closePath();
    } else {
      ctx.lineTo(mid, toPix(world1));
      ctx.closePath();
    }
    ctx.fillStyle = "rgba(210,210,210,0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(220,220,220,0.75)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const mark = (list, alpha, radius) => {
      if (!list) return;
      ctx.fillStyle = "rgba(230,230,230," + alpha + ")";
      list.forEach((w) => {
        const pix = toPix(w);
        ctx.beginPath();
        if (along) ctx.arc(pix, mid, radius, 0, Math.PI * 2);
        else ctx.arc(mid, pix, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    mark(spec.ticks, 0.42, 3.4);
    mark(spec.chosen, 0.98, 4.6);
    ctx.restore();
  }
};

function perlinJ(x, y) {
  if (!perlinJ._n) perlinJ._n = new Perlin(42);
  return perlinJ._n.fbm(x * 0.95 + 8.2, y * 0.95 + 3.4, 3, 0.42);
}

function knobsJ(x, y) {
  const a = Math.exp(-((x - 0.42) * (x - 0.42) + (y - 0.22) * (y - 0.22)) / 0.3);
  const b = 0.48 * Math.exp(-((x + 0.52) * (x + 0.52) + (y + 0.38) * (y + 0.38)) / 0.24);
  return a + b;
}

const ruggedPeaks = (() => {
  const rng = rngFrom(2048);
  const peaks = [];
  for (let i = 0; i < 28; i++) {
    peaks.push({
      x: -1.1 + rng() * 2.2,
      y: -1.1 + rng() * 2.2,
      h: (rng() < 0.7 ? 1 : -0.85) * (0.2 + rng() * 0.72),
      s: 0.065 + rng() * 0.155
    });
  }
  peaks.push({ x: 0.58, y: 0.22, h: 1.42, s: 0.13 });
  peaks.push({ x: -0.74, y: -0.62, h: 1.05, s: 0.12 });
  return peaks;
})();

function designedJ(x, y) {
  let z = -0.08 * (x * x + y * y) + 0.2 * perlinJ(x * 1.7, y * 1.7);
  for (const p of ruggedPeaks) {
    const dx = x - p.x;
    const dy = y - p.y;
    z += p.h * Math.exp(-(dx * dx + dy * dy) / (2 * p.s * p.s));
  }
  return z;
}

function numGrad(fn, x, y, eps) {
  const e = eps || 0.03;
  return {
    gx: (fn(x + e, y) - fn(x - e, y)) / (2 * e),
    gy: (fn(x, y + e) - fn(x, y - e)) / (2 * e)
  };
}

class ContourPlot {
  constructor(view, heightFn, opts) {
    this.view = view;
    this.fn = heightFn;
    this.xMin = (opts && opts.xMin) || -1.15;
    this.xMax = (opts && opts.xMax) || 1.15;
    this.yMin = (opts && opts.yMin) || -1.15;
    this.yMax = (opts && opts.yMax) || 1.15;
    this.strips = !!(opts && opts.strips);
    this.cellPx = (opts && opts.cellPx) ||
      (typeof CONFIG !== "undefined" && CONFIG.demo && CONFIG.demo.cellPx) || 7;
    this.fixedCols = opts && opts.cols;
    this.fixedRows = opts && opts.rows;
    this.cols = this.fixedCols || 64;
    this.rows = this.fixedRows || 48;
    this.levels = (opts && opts.levels) || 12;
    this.basePad = (opts && opts.pad) || { t: 10, r: 10, b: 10, l: 10 };
    this.clipRadius = opts && "clipRadius" in opts ? opts.clipRadius : null;
    this.z = null;
    this.zMin = 0;
    this.zMax = 1;
    this.layout();
  }

  layout() {
    const sx = this.strips ? 42 : 0;
    const sy = this.strips ? 42 : 0;
    this.pad = {
      t: this.basePad.t,
      r: this.basePad.r,
      b: this.basePad.b + sx,
      l: this.basePad.l + sy
    };
    const w = this.view.cssW;
    const h = this.view.cssH;
    this.box = {
      x: this.pad.l,
      y: this.pad.t,
      w: Math.max(8, w - this.pad.l - this.pad.r),
      h: Math.max(8, h - this.pad.t - this.pad.b)
    };
    if (!this.fixedCols) this.cols = Math.min(72, Math.max(28, Math.round(this.box.w / this.cellPx)));
    if (!this.fixedRows) this.rows = Math.min(54, Math.max(22, Math.round(this.box.h / this.cellPx)));
    if (this.strips) {
      this.stripXBox = {
        x: this.box.x,
        y: this.box.y + this.box.h + 8,
        w: this.box.w,
        h: 28
      };
      this.stripYBox = {
        x: 8,
        y: this.box.y,
        w: 28,
        h: this.box.h
      };
    }
  }

  bake() {
    const { cols, rows } = this;
    const nx = cols + 1;
    this.z = new Float32Array(nx * (rows + 1));
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j <= rows; j++) {
      const y = this.yMax - (this.yMax - this.yMin) * (j / rows);
      for (let i = 0; i <= cols; i++) {
        const x = this.xMin + (this.xMax - this.xMin) * (i / cols);
        const v = this.fn(x, y);
        this.z[j * nx + i] = v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    this.zMin = lo;
    this.zMax = hi;
    this.stampField();
  }

  dropCache() {
    this.fieldCache = null;
    this.z = null;
  }

  stampField() {
    if (this.view.cssW < 8 || this.view.cssH < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cssW = Math.max(1, this.view.cssW);
    const cssH = Math.max(1, this.view.cssH);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (!this.fieldCache) this.fieldCache = document.createElement("canvas");
    if (this.fieldCache.width !== w || this.fieldCache.height !== h) {
      this.fieldCache.width = w;
      this.fieldCache.height = h;
    }
    const ctx = this.fieldCache.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paintField(ctx);
    this.fieldCssW = cssW;
    this.fieldCssH = cssH;
  }

  toScreen(x, y) {
    const box = this.box;
    return {
      x: box.x + ((x - this.xMin) / (this.xMax - this.xMin)) * box.w,
      y: box.y + (1 - (y - this.yMin) / (this.yMax - this.yMin)) * box.h
    };
  }

  fromPointer(mx, my) {
    const box = this.box;
    if (mx < box.x || mx > box.x + box.w || my < box.y || my > box.y + box.h) return null;
    return {
      x: this.xMin + ((mx - box.x) / box.w) * (this.xMax - this.xMin),
      y: this.yMax - ((my - box.y) / box.h) * (this.yMax - this.yMin)
    };
  }

  clamp(p) {
    return {
      x: Math.max(this.xMin, Math.min(this.xMax, p.x)),
      y: Math.max(this.yMin, Math.min(this.yMax, p.y))
    };
  }

  clear() {
    this.view.ctx.clearRect(0, 0, this.view.cssW, this.view.cssH);
  }

  drawField() {
    if (!this.fieldCache || !this.z) this.bake();
    if (this.fieldCache) {
      this.view.ctx.drawImage(
        this.fieldCache,
        0,
        0,
        this.fieldCssW || this.view.cssW,
        this.fieldCssH || this.view.cssH
      );
    } else this.paintField(this.view.ctx);
  }

  paintField(ctx) {
    const { box, cols, rows, z, zMin, zMax } = this;
    if (!z) return;
    const nx = cols + 1;
    const cellW = box.w / cols;
    const cellH = box.h / rows;
    const span = zMax - zMin || 1;
    ctx.save();
    clipPlotBox(ctx, box, this.clipRadius);
    const stops = demoStops();
    const ground = mixRgb([16, 18, 24], stops[0], 0.22);
    ctx.fillStyle = cssRgb(ground);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    for (let L = 0; L < this.levels; L++) {
      const u = L / (this.levels - 1);
      const level = zMin + span * (0.08 + 0.84 * u);
      const fill = mixRgb(ground, paletteAt(u, stops), 0.42 + 0.48 * u);
      ctx.beginPath();
      Contours.addAbove(ctx, z, cols, rows, nx, level, cellW, cellH, box.x, box.y);
      ctx.fillStyle = cssRgb(fill);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    for (let L = 0; L < this.levels; L++) {
      const u = L / (this.levels - 1);
      const level = zMin + span * (0.08 + 0.84 * u);
      const { open, closed } = Contours.paths(z, cols, rows, nx, level, cellW, cellH);
      ctx.strokeStyle = cssRgb(mixRgb(paletteAt(u, stops), [255, 255, 255], 0.18), 0.85);
      ctx.beginPath();
      const stroke = (pts) => {
        if (!pts.length) return;
        ctx.moveTo(box.x + pts[0][0], box.y + pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(box.x + pts[k][0], box.y + pts[k][1]);
      };
      for (const pts of open) if (pts.length >= 3) stroke(pts);
      for (const pts of closed) if (pts.length >= 4) stroke(pts);
      ctx.stroke();
    }
    ctx.restore();
  }
}
