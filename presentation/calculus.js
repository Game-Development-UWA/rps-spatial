class CubicProbe {
  constructor(panel, readout) {
    this.panel = panel;
    this.readout = readout;
    this.els = {
      verdict: readout.querySelector('[data-k="verdict"]')
    };
    this.pad = { t: 16, r: 18, b: 16, l: 36 };
    this.xMin = -2.35;
    this.xMax = 2.4;
    this.hover = null;
    this.crit = [];
    this.findCrit();
    this.plots = [
      { key: "f", fn: (x) => this.f(x), yMin: 0, yMax: 1 },
      { key: "df", fn: (x) => this.df(x), yMin: 0, yMax: 1 },
      { key: "ddf", fn: (x) => this.ddf(x), yMin: 0, yMax: 1 }
    ].map((spec) => {
      const canvas = panel.querySelector('[data-plot="' + spec.key + '"]');
      const range = this.sampleRange(spec.fn);
      return {
        key: spec.key,
        fn: spec.fn,
        canvas,
        ctx: canvas.getContext("2d"),
        cssW: 0,
        cssH: 0,
        yMin: range.yMin,
        yMax: range.yMax
      };
    });
    this.resize();
    this.bind();
    this.draw();
  }

  f(x) {
    return -0.85 * x * x * x * x + 5.8 * x * x + 0.55 * x;
  }

  df(x) {
    return -3.4 * x * x * x + 11.6 * x + 0.55;
  }

  ddf(x) {
    return -10.2 * x * x + 11.6;
  }

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
  }

  findCrit() {
    const pts = [];
    const n = 420;
    let prev = this.xMin;
    let pd = this.df(prev);
    for (let i = 1; i <= n; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / n);
      const d = this.df(x);
      if (pd === 0) pts.push(prev);
      else if (pd * d < 0) {
        let lo = prev, hi = x;
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
    this.crit = pts;
  }

  bind() {
    new ResizeObserver(() => {
      this.resize();
      this.draw();
    }).observe(this.panel);
    this.plots.forEach((plot) => {
      plot.canvas.addEventListener("pointermove", (e) => this.onMove(plot, e));
      plot.canvas.addEventListener("pointerleave", () => {
        this.hover = null;
        this.updateReadout(null);
        this.draw();
      });
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.plots.forEach((plot) => {
      const rect = plot.canvas.getBoundingClientRect();
      plot.cssW = Math.max(1, rect.width);
      plot.cssH = Math.max(1, rect.height);
      plot.canvas.width = Math.round(plot.cssW * dpr);
      plot.canvas.height = Math.round(plot.cssH * dpr);
      plot.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  plotBox(plot) {
    const { t, r, b, l } = this.pad;
    return { x: l, y: t, w: plot.cssW - l - r, h: plot.cssH - t - b };
  }

  toScreen(plot, x, y) {
    const box = this.plotBox(plot);
    return {
      x: box.x + ((x - this.xMin) / (this.xMax - this.xMin)) * box.w,
      y: box.y + (1 - (y - plot.yMin) / (plot.yMax - plot.yMin)) * box.h
    };
  }

  xFromPointer(plot, mx) {
    const box = this.plotBox(plot);
    if (mx < box.x - 10 || mx > box.x + box.w + 10) return null;
    const t = (mx - box.x) / box.w;
    let x = this.xMin + t * (this.xMax - this.xMin);
    x = Math.max(this.xMin, Math.min(this.xMax, x));
    let snap = x;
    let snapD = 0.08;
    for (const c of this.crit) {
      const d = Math.abs(x - c);
      if (d < snapD) {
        snapD = d;
        snap = c;
      }
    }
    return snap;
  }

  onMove(plot, e) {
    const rect = plot.canvas.getBoundingClientRect();
    const x = this.xFromPointer(plot, e.clientX - rect.left);
    this.hover = x;
    this.updateReadout(x);
    this.draw();
  }

  fmt(n) {
    const v = Math.abs(n) < 0.005 ? 0 : n;
    return (v >= 0 ? "+" : "") + v.toFixed(2);
  }

  updateReadout(x) {
    if (x == null) {
      this.els.verdict.textContent = "—";
      return;
    }
    const y = this.f(x);
    const slope = this.df(x);
    const accel = this.ddf(x);
    const flat = Math.abs(slope) < 0.35;
    if (flat && accel < -0.25) {
      const peak = Math.max(...this.crit.filter((c) => this.ddf(c) < 0).map((c) => this.f(c)));
      this.els.verdict.textContent = y >= peak - 0.08 ? "Global maximum" : "Local maximum";
    } else if (flat && accel > 0.25) {
      let visMin = Infinity;
      for (let i = 0; i <= 80; i++) {
        const t = this.xMin + (this.xMax - this.xMin) * (i / 80);
        visMin = Math.min(visMin, this.f(t));
      }
      this.els.verdict.textContent = y <= visMin + 0.1 ? "Global minimum" : "Local minimum";
    } else if (flat) this.els.verdict.textContent = "Inflection";
    else this.els.verdict.textContent = "Neither";
  }

  drawAxes(plot) {
    const ctx = plot.ctx;
    const origin = this.toScreen(plot, 0, 0);
    const box = this.plotBox(plot);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
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

  drawCurve(plot) {
    const ctx = plot.ctx;
    const box = this.plotBox(plot);
    const steps = 220;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / steps);
      const p = this.toScreen(plot, x, plot.fn(x));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(230,230,230,0.88)";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }

  drawHover(plot, x) {
    const ctx = plot.ctx;
    const y = plot.fn(x);
    const p = this.toScreen(plot, x, y);
    const box = this.plotBox(plot);

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(p.x, box.y);
    ctx.lineTo(p.x, box.y + box.h);
    ctx.strokeStyle = "rgba(210,210,210,0.55)";
    ctx.lineWidth = 1.15;
    ctx.stroke();

    if (plot.key === "f") {
      const slope = this.df(x);
      const span = 0.55;
      const a = this.toScreen(plot, x - span, y - slope * span);
      const b = this.toScreen(plot, x + span, y + slope * span);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = "rgba(180,180,180,0.95)";
      ctx.lineWidth = 1.35;
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.6, 0, Math.PI * 2);
    ctx.fillStyle = "#eee";
    ctx.fill();
    ctx.strokeStyle = "rgba(10,10,10,0.7)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  draw() {
    this.plots.forEach((plot) => {
      plot.ctx.clearRect(0, 0, plot.cssW, plot.cssH);
      this.drawAxes(plot);
      this.drawCurve(plot);
      if (this.hover != null) this.drawHover(plot, this.hover);
    });
  }
}
