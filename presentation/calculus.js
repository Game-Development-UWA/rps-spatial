class CubicProbe {
  constructor(canvas, readout) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.readout = readout;
    this.els = {
      slope: readout.querySelector('[data-k="slope"]'),
      accel: readout.querySelector('[data-k="accel"]'),
      verdict: readout.querySelector('[data-k="verdict"]')
    };
    this.pad = { t: 22, r: 22, b: 32, l: 40 };
    this.xMin = -1.68;
    this.xMax = 1.78;
    this.yMin = -1.35;
    this.yMax = 2.28;
    this.hover = null;
    this.cssW = 0;
    this.cssH = 0;
    this.crit = [];
    this.findCrit();
    this.resize();
    this.bind();
    this.draw();
  }

  f(x) {
    return -x * x * x * x + 2.4 * x * x + 0.45 * x;
  }

  df(x) {
    return -4 * x * x * x + 4.8 * x + 0.45;
  }

  ddf(x) {
    return -12 * x * x + 4.8;
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
    }).observe(this.canvas);
    this.canvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.updateReadout(null);
      this.draw();
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  plotBox() {
    const { t, r, b, l } = this.pad;
    return { x: l, y: t, w: this.cssW - l - r, h: this.cssH - t - b };
  }

  toScreen(x, y) {
    const box = this.plotBox();
    return {
      x: box.x + ((x - this.xMin) / (this.xMax - this.xMin)) * box.w,
      y: box.y + (1 - (y - this.yMin) / (this.yMax - this.yMin)) * box.h
    };
  }

  nearestOnCurve(mx, my) {
    const box = this.plotBox();
    if (mx < box.x - 8 || mx > box.x + box.w + 8 || my < box.y - 8 || my > box.y + box.h + 8) {
      return null;
    }
    let best = null;
    const steps = 280;
    for (let i = 0; i <= steps; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / steps);
      const p = this.toScreen(x, this.f(x));
      const d = Math.hypot(p.x - mx, p.y - my);
      if (!best || d < best.d) best = { x, d, p };
    }
    if (!best || best.d > 28) return null;
    let snap = best.x;
    let snapD = 0.12;
    for (const c of this.crit) {
      const d = Math.abs(best.x - c);
      if (d < snapD) {
        snapD = d;
        snap = c;
      }
    }
    return snap;
  }

  onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = this.nearestOnCurve(e.clientX - rect.left, e.clientY - rect.top);
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
      this.els.slope.textContent = "—";
      this.els.accel.textContent = "—";
      this.els.verdict.textContent = "Hover the curve";
      return;
    }
    const y = this.f(x);
    const slope = this.df(x);
    const accel = this.ddf(x);
    this.els.slope.textContent = this.fmt(slope);
    this.els.accel.textContent = this.fmt(accel);
    const flat = Math.abs(slope) < 0.14;
    if (flat && accel < -0.15) {
      const peak = Math.max(...this.crit.filter((c) => this.ddf(c) < 0).map((c) => this.f(c)));
      this.els.verdict.textContent = y >= peak - 0.04 ? "Global maximum" : "Local maximum";
    } else if (flat && accel > 0.15) {
      let visMin = Infinity;
      for (let i = 0; i <= 80; i++) {
        const t = this.xMin + (this.xMax - this.xMin) * (i / 80);
        visMin = Math.min(visMin, this.f(t));
      }
      this.els.verdict.textContent = y <= visMin + 0.05 ? "Global minimum" : "Local minimum";
    } else if (flat) this.els.verdict.textContent = "Inflection";
    else this.els.verdict.textContent = "Neither";
  }

  drawAxes() {
    const ctx = this.ctx;
    const origin = this.toScreen(0, 0);
    const box = this.plotBox();
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

  drawCurve() {
    const ctx = this.ctx;
    const box = this.plotBox();
    const steps = 220;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = this.xMin + (this.xMax - this.xMin) * (i / steps);
      const p = this.toScreen(x, this.f(x));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(230,230,230,0.88)";
    ctx.lineWidth = 2.1;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }

  drawHover(x) {
    const ctx = this.ctx;
    const y = this.f(x);
    const slope = this.df(x);
    const p = this.toScreen(x, y);
    const box = this.plotBox();
    const span = 0.85;
    const a = this.toScreen(x - span, y - slope * span);
    const b = this.toScreen(x + span, y + slope * span);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(180,180,180,0.95)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = "#eee";
    ctx.fill();
    ctx.strokeStyle = "rgba(10,10,10,0.7)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const label = "slope " + this.fmt(slope);
    ctx.font = "600 13px system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    let lx = p.x + 12;
    let ly = p.y - 12;
    if (lx + tw + 10 > this.cssW) lx = p.x - tw - 14;
    if (ly < 16) ly = p.y + 22;
    ctx.fillStyle = "rgba(12,12,12,0.72)";
    ctx.fillRect(lx - 6, ly - 13, tw + 12, 20);
    ctx.fillStyle = "#eee";
    ctx.fillText(label, lx, ly);
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    this.drawAxes();
    this.drawCurve();
    if (this.hover != null) this.drawHover(this.hover);
  }
}