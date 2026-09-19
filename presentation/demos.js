class DemoHost {
  constructor() {
    this.bySlide = new Map();
    this.current = null;
  }

  attach(slide, demo) {
    if (!this.bySlide.has(slide)) this.bySlide.set(slide, []);
    this.bySlide.get(slide).push(demo);
  }

  show(slide) {
    if (this.current === slide) return;
    this.forEach(this.current, (d) => d.leave && d.leave());
    this.current = slide;
    this.forEach(slide, (d) => d.enter && d.enter());
  }

  forEach(slide, fn) {
    const list = slide && this.bySlide.get(slide);
    if (list) list.forEach(fn);
  }

  tick(dt) {
    this.forEach(this.current, (d) => d.tick && d.tick(dt));
  }
}

function bindPlace(view, plot, onPlace) {
  view.canvas.style.cursor = "crosshair";
  view.canvas.addEventListener("pointerdown", (e) => {
    const rect = view.canvas.getBoundingClientRect();
    const x = plot.xFromPointer(e.clientX - rect.left);
    if (x != null) onPlace(x);
  });
}

function bindPlace2D(view, plot, onPlace) {
  view.canvas.style.cursor = "crosshair";
  view.canvas.addEventListener("pointerdown", (e) => {
    const rect = view.canvas.getBoundingClientRect();
    const p = plot.fromPointer(e.clientX - rect.left, e.clientY - rect.top);
    if (p != null) onPlace(plot.clamp(p));
  });
}

class AscentDemo {
  constructor(panel) {
    this.view = new PanelView(panel, [
      { type: "button", key: "step", icon: "step", label: "Step", onClick: () => this.stepOnce() },
      { type: "button", key: "play", icon: "play", label: "Play", onClick: () => this.toggle() }
    ]);
    this.plot = new CurvePlot(this.view);
    this.alpha = 0.07;
    this.x = -2.15;
    this.probe = null;
    this.flash = null;
    this.pending = null;
    this.running = false;
    this.cool = 0;
    this.phases = new Phases(
      [
        { id: "point", dur: 0.45 },
        { id: "tangent", dur: 0.7 },
        { id: "sample", dur: 0.55 },
        { id: "move", dur: 0.7 }
      ],
      (id) => this.onPhase(id)
    );
    this.view.onResize = () => {
      this.plot.layout();
      this.draw();
    };
    bindPlace(this.view, this.plot, (x) => this.place(x));
  }

  proposed() {
    return World1D.clamp(this.x + this.alpha * World1D.df(this.x));
  }

  place(x) {
    this.x = x;
    this.probe = null;
    this.flash = null;
    this.pending = null;
    this.running = false;
    this.cool = 0;
    this.phases.reset(false);
    this.view.setPlay(false);
    this.draw();
  }

  enter() {
    this.place(-2.15);
  }

  leave() {
    this.running = false;
    this.phases.playing = false;
    this.view.setPlay(false);
  }

  toggle() {
    if (this.running) {
      this.running = false;
      this.view.setPlay(false);
      return;
    }
    if (this.pending != null) this.x = this.pending;
    this.pending = null;
    this.probe = null;
    this.flash = null;
    this.phases.reset(false);
    if (this.stalled()) return;
    this.running = true;
    this.cool = 1;
    this.view.setPlay(true);
  }

  stalled() {
    return Math.abs(World1D.df(this.x)) < World1D.flat;
  }

  takeMove() {
    const nxt = this.proposed();
    const better = World1D.f(nxt) > World1D.f(this.x) + 1e-4;
    if (better && !this.stalled()) this.x = nxt;
    else {
      this.running = false;
      this.view.setPlay(false);
    }
  }

  onPhase(id) {
    if (id === "point") {
      if (this.pending != null) this.x = this.pending;
      this.pending = null;
      this.probe = null;
      this.flash = null;
    } else if (id === "sample") {
      this.probe = this.proposed();
      this.flash = null;
    } else if (id === "move") {
      if (this.probe == null) this.probe = this.proposed();
      const better = World1D.f(this.probe) > World1D.f(this.x) + 1e-4;
      const moving = better && !this.stalled();
      this.flash = moving ? "accept" : "reject";
      this.pending = moving ? this.probe : null;
      if (!moving && this.phases.playing) {
        this.phases.playing = false;
        this.view.setPlay(false);
      }
    }
    this.draw();
  }

  stepOnce() {
    this.running = false;
    this.phases.playing = false;
    this.view.setPlay(false);
    this.phases.advance();
    this.draw();
  }

  tick(dt) {
    if (this.running) {
      this.cool += dt;
      if (this.cool >= 1) {
        this.cool = 0;
        this.takeMove();
      }
    } else this.phases.tick(dt);
    this.draw();
  }

  draw() {
    const { plot, x } = this;
    if (this.running) {
      plot.clear();
      plot.drawAxes();
      plot.drawCurve();
      const p = plot.toScreen(x, World1D.f(x));
      drawDot(plot.view.ctx, p.x, p.y, 5, this.stalled() ? "#bbb" : "#eee");
      return;
    }
    const y = World1D.f(x);
    const p = plot.toScreen(x, y);
    plot.clear();
    plot.drawAxes();
    plot.drawCurve();
    const id = this.phases.id;
    if (id === "tangent" || id === "sample" || id === "move") plot.drawTangent(x);
    const probe = this.probe;
    if (probe != null && (id === "sample" || id === "move")) {
      const q = plot.toScreen(probe, World1D.f(probe));
      const col = this.flash === "accept"
        ? "#8aaa8a"
        : this.flash === "reject"
          ? "#aa7a7a"
          : "rgba(200,200,200,0.7)";
      const line = this.flash === "accept"
        ? "rgba(138,170,138,0.55)"
        : this.flash === "reject"
          ? "rgba(170,122,122,0.55)"
          : "rgba(200,200,200,0.4)";
      plot.drawVLine(probe, line);
      if (id === "sample") {
        const onTan = plot.toScreen(probe, y + World1D.df(x) * (probe - x));
        plot.view.ctx.save();
        plot.view.ctx.setLineDash([4, 4]);
        plot.view.ctx.beginPath();
        plot.view.ctx.moveTo(onTan.x, onTan.y);
        plot.view.ctx.lineTo(q.x, q.y);
        plot.view.ctx.strokeStyle = "rgba(180,180,180,0.45)";
        plot.view.ctx.stroke();
        plot.view.ctx.restore();
      }
      drawDot(plot.view.ctx, q.x, q.y, 4.4, col);
    }
    drawDot(plot.view.ctx, p.x, p.y, 5, this.stalled() ? "#bbb" : "#eee");
  }
}

class AlphaStepDemo {
  constructor(panel) {
    this.alpha = 0.12;
    this.view = new PanelView(panel, [
      { type: "button", key: "step", icon: "step", label: "Step", onClick: () => this.stepOnce() },
      { type: "button", key: "play", icon: "play", label: "Play", onClick: () => this.toggle() },
      {
        type: "range",
        key: "alpha",
        label: "α",
        min: 0.02,
        max: 0.42,
        step: 0.01,
        value: this.alpha,
        onInput: (v) => { this.alpha = v; this.draw(); }
      }
    ]);
    this.plot = new CurvePlot(this.view);
    this.x = -2.15;
    this.running = false;
    this.cool = 0;
    this.phases = new Phases(
      [
        { id: "point", dur: 0.4 },
        { id: "propose", dur: 0.85 },
        { id: "move", dur: 0.55 }
      ],
      (id) => this.onPhase(id)
    );
    this.view.onResize = () => {
      this.plot.layout();
      this.draw();
    };
    bindPlace(this.view, this.plot, (x) => this.place(x));
  }

  proposed() {
    return World1D.clamp(this.x + this.alpha * World1D.df(this.x));
  }

  place(x) {
    this.x = x;
    this.running = false;
    this.cool = 0;
    this.phases.reset(false);
    this.view.setPlay(false);
    this.draw();
  }

  enter() {
    this.place(-2.15);
  }

  leave() {
    this.running = false;
    this.phases.playing = false;
    this.view.setPlay(false);
  }

  stalled() {
    return Math.abs(World1D.df(this.x)) < World1D.flat;
  }

  takeMove() {
    if (this.stalled()) {
      this.running = false;
      this.view.setPlay(false);
      return;
    }
    this.x = this.proposed();
  }

  toggle() {
    if (this.running) {
      this.running = false;
      this.view.setPlay(false);
      return;
    }
    this.phases.reset(false);
    if (this.stalled()) return;
    this.running = true;
    this.cool = 1;
    this.view.setPlay(true);
  }

  onPhase(id) {
    if (id === "move") this.x = this.proposed();
    this.draw();
  }

  stepOnce() {
    this.running = false;
    this.phases.playing = false;
    this.view.setPlay(false);
    this.phases.advance();
    this.draw();
  }

  tick(dt) {
    if (this.running) {
      this.cool += dt;
      if (this.cool >= 1) {
        this.cool = 0;
        this.takeMove();
      }
    } else this.phases.tick(dt);
    this.draw();
  }

  draw() {
    const { plot, x } = this;
    plot.clear();
    plot.drawAxes();
    plot.drawCurve();
    const y = World1D.f(x);
    const p = plot.toScreen(x, y);
    if (!this.running && this.phases.id === "propose") {
      const nx = this.proposed();
      const a = plot.toScreen(x, y);
      const b = plot.toScreen(nx, y);
      drawArrow(plot.view.ctx, a.x, a.y, b.x, b.y, "rgba(200,200,200,0.9)");
      const q = plot.toScreen(nx, World1D.f(nx));
      plot.view.ctx.save();
      plot.view.ctx.setLineDash([4, 4]);
      plot.view.ctx.beginPath();
      plot.view.ctx.moveTo(b.x, b.y);
      plot.view.ctx.lineTo(q.x, q.y);
      plot.view.ctx.strokeStyle = "rgba(180,180,180,0.45)";
      plot.view.ctx.stroke();
      plot.view.ctx.restore();
      drawDot(plot.view.ctx, q.x, q.y, 4, "rgba(200,200,200,0.55)", false);
    }
    drawDot(plot.view.ctx, p.x, p.y, 5);
  }
}

class RidgeDemo {
  constructor(panel) {
    this.view = new PanelView(panel);
    this.plot = new CurvePlot(this.view);
    this.alpha = 0.04;
    this.mode = "climb";
    this.t = 0;
    this.reveal = 0;
    this.x = -2.05;
    this.beat = 0;
    this.view.onResize = () => {
      this.plot.layout();
      this.draw();
    };
  }

  enter() {
    this.resetClimb();
  }

  leave() {
    this.view.hideBubble();
  }

  resetClimb() {
    this.x = -2.05;
    this.mode = "climb";
    this.t = 0;
    this.reveal = 0;
    this.beat = 0;
    this.view.hideBubble();
  }

  stalled() {
    return Math.abs(World1D.df(this.x)) < World1D.flat;
  }

  tick(dt) {
    if (this.mode === "climb") {
      if (this.stalled()) {
        this.mode = "boast";
        this.t = 0;
      } else {
        this.t += dt;
        const durs = [0.28, 0.38];
        if (this.t >= durs[this.beat]) {
          this.t = 0;
          if (this.beat === 1) {
            this.x = World1D.clamp(this.x + this.alpha * World1D.df(this.x));
            this.beat = 0;
          } else this.beat += 1;
        }
      }
    } else if (this.mode === "boast") {
      this.t += dt;
      const p = this.plot.toScreen(this.x, World1D.f(this.x));
      this.view.showBubble("I'm on top of the world!", p.x, p.y);
      if (this.t > 1.15) {
        this.mode = "reveal";
        this.t = 0;
      }
    } else if (this.mode === "reveal") {
      this.t += dt;
      this.reveal = Math.min(1, this.t / 0.7);
      if (this.t > 1.65) this.resetClimb();
    }
    this.draw();
  }

  draw() {
    const { plot, x } = this;
    plot.clear();
    plot.drawAxes();
    plot.drawCurve(this.reveal);
    if (this.mode === "climb") plot.drawTangent(x);
    const p = plot.toScreen(x, World1D.f(x));
    if (this.reveal > 0) {
      const g = World1D.globalPeak();
      const q = plot.toScreen(g, World1D.f(g));
      plot.view.ctx.globalAlpha = this.reveal;
      plot.drawVLine(g, "rgba(220,220,180,0.55)");
      drawDot(plot.view.ctx, q.x, q.y, 6, "#e8e0b8");
      plot.view.ctx.globalAlpha = 1;
    }
    drawDot(plot.view.ctx, p.x, p.y, 5);
    if (this.mode === "boast" || this.mode === "reveal") {
      const p2 = plot.toScreen(x, World1D.f(x));
      this.view.showBubble("I'm on top of the world!", p2.x, p2.y);
    }
  }
}

class KnobsDemo {
  constructor(panel) {
    this.view = new PanelView(panel);
    this.plot = new ContourPlot(this.view, knobsJ);
    this.start = { x: 0.02, y: -0.52 };
    this.theta = { x: this.start.x, y: this.start.y };
    this.scale = 0.28;
    this.u = 0;
    this.playing = false;
    this.trail = [];
    this.view.onResize = () => {
      this.plot.layout();
      this.plot.bake();
      this.draw();
    };
  }

  enter() {
    this.restart();
  }

  leave() {
    this.playing = false;
  }

  restart() {
    this.theta = { x: this.start.x, y: this.start.y };
    this.trail = [];
    this.u = 0;
    this.playing = true;
    this.draw();
  }

  grad() {
    return numGrad(knobsJ, this.theta.x, this.theta.y, 0.04);
  }

  target() {
    const g = this.grad();
    return this.plot.clamp({
      x: this.theta.x + g.gx * this.scale,
      y: this.theta.y + g.gy * this.scale
    });
  }

  stalled() {
    const g = this.grad();
    return Math.hypot(g.gx, g.gy) < 0.12;
  }

  tick(dt) {
    if (this.playing) {
      this.u = Math.min(1, this.u + dt / 1.0);
      if (this.u >= 1) {
        const nxt = this.target();
        this.trail.push({ x: this.theta.x, y: this.theta.y });
        if (this.trail.length > 24) this.trail.shift();
        this.theta = nxt;
        this.u = 0;
        if (this.stalled()) this.playing = false;
      }
    }
    this.draw();
  }

  lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  draw() {
    const { plot, theta } = this;
    plot.clear();
    plot.drawField();
    const ctx = plot.view.ctx;
    if (this.trail.length) {
      ctx.beginPath();
      this.trail.forEach((p, i) => {
        const s = plot.toScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      const now = plot.toScreen(theta.x, theta.y);
      ctx.lineTo(now.x, now.y);
      ctx.strokeStyle = "rgba(200,200,200,0.35)";
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    const g = this.grad();
    const p = plot.toScreen(theta.x, theta.y);
    const px = plot.toScreen(theta.x + g.gx * this.scale, theta.y);
    const py = plot.toScreen(theta.x, theta.y + g.gy * this.scale);
    const tgt = this.target();
    const ps = plot.toScreen(tgt.x, tgt.y);
    const axes = Math.min(1, this.u / 0.38);
    const sum = Math.max(0, Math.min(1, (this.u - 0.38) / 0.32));
    const walk = Math.max(0, (this.u - 0.7) / 0.3);
    const ax = this.lerp(p, px, axes);
    const ay = this.lerp(p, py, axes);
    drawArrow(ctx, p.x, p.y, ax.x, ax.y, "rgba(200,200,200,0.85)");
    drawArrow(ctx, p.x, p.y, ay.x, ay.y, "rgba(200,200,200,0.85)");
    if (sum > 0) {
      const tip = this.lerp(p, ps, sum);
      ctx.save();
      ctx.globalAlpha = sum * (1 - walk);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px.x, px.y);
      ctx.lineTo(ps.x, ps.y);
      ctx.moveTo(py.x, py.y);
      ctx.lineTo(ps.x, ps.y);
      ctx.strokeStyle = "rgba(180,180,180,0.45)";
      ctx.stroke();
      ctx.restore();
      drawArrow(ctx, p.x, p.y, tip.x, tip.y, "rgba(235,235,210,0.95)");
    }
    const here = walk > 0 ? this.lerp(p, ps, walk) : p;
    drawDot(ctx, here.x, here.y, 5);
  }
}

class Hill1DDemo {
  constructor(panel, opts) {
    this.dist = new Neighbourhood(
      (opts && opts.kind) || "uniform",
      (opts && opts.param) != null ? opts.param : 0.42
    );
    const controls = (opts && opts.sigma)
      ? [{
          type: "range",
          key: "sigma",
          label: "σ",
          min: 0.08,
          max: 2.4,
          step: 0.01,
          value: this.dist.param,
          onInput: (v) => { this.dist.param = v; }
        }]
      : [];
    this.view = new PanelView(panel, controls);
    this.plot = new CurvePlot(this.view, { strip: true });
    this.rng = rngFrom(7);
    this.x = 0;
    this.rejects = 0;
    this.phase = "casino";
    this.t = 0;
    this.flickers = [];
    this.chosen = [];
    this.flash = null;
    this.alive = false;
    this.view.onResize = () => {
      this.plot.layout();
      this.draw();
    };
  }

  enter() {
    this.rng = rngFrom((Math.random() * 1e9) | 0);
    this.x = 0;
    this.rejects = 0;
    this.beginCasino();
    this.alive = true;
  }

  leave() {
    this.alive = false;
  }

  beginCasino() {
    this.phase = "casino";
    this.t = 0;
    this.flickers = [];
    this.chosen = [];
    this.flash = null;
  }

  sampleX() {
    return World1D.clamp(this.x + this.dist.sample(this.rng));
  }

  tick(dt) {
    if (!this.alive) return;
    this.t += dt;
    if (this.phase === "casino") {
      if (this.t > 0.045) {
        this.t = 0;
        this.flickers.push(this.sampleX());
        if (this.flickers.length > 8) this.flickers.shift();
        if (this.flickers.length >= 8) {
          this.chosen = [this.sampleX()];
          this.phase = "show";
          this.t = 0;
        }
      }
    } else if (this.phase === "show") {
      if (this.t > 0.38) {
        const x2 = this.chosen[0];
        const better = World1D.f(x2) > World1D.f(this.x);
        this.flash = better ? "accept" : "reject";
        this.phase = "resolve";
        this.t = 0;
        if (better) {
          this.x = x2;
          this.rejects = 0;
        } else this.rejects += 1;
      }
    } else if (this.phase === "resolve") {
      if (this.t > 0.42) {
        if (this.rejects >= 14) {
          this.x = World1D.clamp(-2.1 + this.rng() * 4.2);
          this.rejects = 0;
        }
        this.beginCasino();
      }
    }
    this.draw();
  }

  draw() {
    const { plot, x } = this;
    plot.clear();
    plot.drawAxes();
    plot.drawCurve();
    DistStrip.draw(plot.view.ctx, plot.stripBox, {
      axis: "x",
      origin: x,
      neighbourhood: this.dist,
      ticks: this.flickers,
      chosen: this.phase === "casino" ? [] : this.chosen,
      world0: plot.xMin,
      world1: plot.xMax
    });
    if (this.chosen.length && this.phase !== "casino") {
      const x2 = this.chosen[0];
      const q = plot.toScreen(x2, World1D.f(x2));
      const col = this.flash === "accept"
        ? "#8aaa8a"
        : this.flash === "reject"
          ? "#aa7a7a"
          : "rgba(200,200,200,0.7)";
      plot.drawVLine(x2, "rgba(200,200,200,0.25)");
      drawDot(plot.view.ctx, q.x, q.y, 4.4, col);
    }
    const p = plot.toScreen(x, World1D.f(x));
    drawDot(plot.view.ctx, p.x, p.y, 5);
  }
}

class Climb2DDemo {
  constructor(panel, opts) {
    this.k = (opts && opts.k) || 1;
    this.dist = new Neighbourhood("uniform", (opts && opts.width) || 0.22);
    this.fn = (opts && opts.fn) || perlinJ;
    this.view = new PanelView(panel);
    this.plot = new ContourPlot(this.view, this.fn, { strips: true });
    this.pos = { x: -0.4, y: 0.2 };
    this.rng = rngFrom(1);
    this.phase = "casino";
    this.t = 0;
    this.flickers = [];
    this.chosen = [];
    this.flash = null;
    this.linger = [];
    this.alive = false;
    this.view.onResize = () => {
      this.plot.layout();
      this.plot.bake();
      this.draw();
    };
  }

  reset(start, seed) {
    this.pos = { x: start.x, y: start.y };
    this.rng = rngFrom(seed);
    this.linger = [];
    this.beginCasino();
  }

  teleport(p) {
    this.pos = { x: p.x, y: p.y };
    this.linger = [];
    this.winner = null;
    this.beginCasino();
  }

  enter() {}

  leave() {
    this.alive = false;
  }

  beginCasino() {
    this.phase = "casino";
    this.t = 0;
    this.flickers = [];
    this.chosen = [];
    this.flash = null;
  }

  sample() {
    return this.plot.clamp({
      x: this.pos.x + this.dist.sample(this.rng),
      y: this.pos.y + this.dist.sample(this.rng)
    });
  }

  tick(dt) {
    if (!this.alive) return;
    this.t += dt;
    this.linger = this.linger.filter((p) => {
      p.life -= dt;
      return p.life > 0;
    });
    const need = Math.max(8, this.k * 3);
    if (this.phase === "casino") {
      if (this.t > 0.04) {
        this.t = 0;
        this.flickers.push(this.sample());
        if (this.flickers.length > need) this.flickers.shift();
        if (this.flickers.length >= need) {
          this.chosen = Array.from({ length: this.k }, () => this.sample());
          this.phase = "show";
          this.t = 0;
        }
      }
    } else if (this.phase === "show") {
      if (this.t > 0.42) {
        let best = this.chosen[0];
        let bestH = this.fn(best.x, best.y);
        for (const p of this.chosen) {
          const h = this.fn(p.x, p.y);
          if (h > bestH) {
            best = p;
            bestH = h;
          }
        }
        const cur = this.fn(this.pos.x, this.pos.y);
        const better = bestH > cur;
        this.flash = better ? "accept" : "reject";
        this.chosen.forEach((p) => {
          if (p !== best) this.linger.push({ x: p.x, y: p.y, life: 0.7 });
        });
        if (better) this.pos = best;
        this.winner = best;
        this.phase = "resolve";
        this.t = 0;
      }
    } else if (this.phase === "resolve") {
      if (this.t > 0.4) this.beginCasino();
    }
    this.draw();
  }

  draw() {
    const { plot, pos } = this;
    plot.clear();
    plot.drawField();
    const fx = this.flickers.map((p) => p.x);
    const fy = this.flickers.map((p) => p.y);
    const cx = this.phase === "casino" ? [] : this.chosen.map((p) => p.x);
    const cy = this.phase === "casino" ? [] : this.chosen.map((p) => p.y);
    DistStrip.draw(plot.view.ctx, plot.stripXBox, {
      axis: "x",
      origin: pos.x,
      neighbourhood: this.dist,
      ticks: fx,
      chosen: cx,
      world0: plot.xMin,
      world1: plot.xMax
    });
    DistStrip.draw(plot.view.ctx, plot.stripYBox, {
      axis: "y",
      origin: pos.y,
      neighbourhood: this.dist,
      ticks: fy,
      chosen: cy,
      world0: plot.yMin,
      world1: plot.yMax
    });
    this.linger.forEach((p) => {
      const s = plot.toScreen(p.x, p.y);
      drawDot(plot.view.ctx, s.x, s.y, 3, "rgba(180,180,180," + (0.45 * p.life) + ")", false);
    });
    if (this.chosen.length && this.phase !== "casino") {
      this.chosen.forEach((p) => {
        const s = plot.toScreen(p.x, p.y);
        const win = this.winner && p.x === this.winner.x && p.y === this.winner.y;
        const col = win
          ? (this.flash === "accept" ? "#8aaa8a" : this.flash === "reject" ? "#aa7a7a" : "#ccc")
          : "rgba(200,200,200,0.55)";
        drawDot(plot.view.ctx, s.x, s.y, win ? 4.4 : 3.2, col);
      });
    }
    const s = plot.toScreen(pos.x, pos.y);
    drawDot(plot.view.ctx, s.x, s.y, 5);
  }
}

class SamplePairDemo {
  constructor(leftPanel, rightPanel) {
    this.left = new Climb2DDemo(leftPanel, { k: 1 });
    this.right = new Climb2DDemo(rightPanel, { k: 7 });
    const go = (p) => this.teleport(p);
    bindPlace2D(this.left.view, this.left.plot, go);
    bindPlace2D(this.right.view, this.right.plot, go);
  }

  teleport(p) {
    this.left.teleport(p);
    this.right.teleport(p);
  }

  enter() {
    const rng = rngFrom((Math.random() * 1e9) | 0);
    const start = { x: -0.7 + rng() * 0.5, y: -0.2 + rng() * 0.6 };
    const seed = (rng() * 1e9) | 0;
    this.left.reset(start, seed);
    this.right.reset(start, seed + 91);
    this.left.alive = true;
    this.right.alive = true;
  }

  leave() {
    this.left.leave();
    this.right.leave();
  }

  tick(dt) {
    this.left.tick(dt);
    this.right.tick(dt);
  }
}

class TweakPairDemo {
  constructor(leftPanel, rightPanel) {
    this.left = new Hill1DDemo(leftPanel, { kind: "uniform", param: 0.48 });
    this.right = new Hill1DDemo(rightPanel, { kind: "gaussian", param: 0.22, sigma: true });
  }

  enter() {
    this.left.enter();
    this.right.enter();
    this.left.x = 0;
    this.right.x = 0;
    this.left.beginCasino();
    this.right.beginCasino();
  }

  leave() {
    this.left.leave();
    this.right.leave();
  }

  tick(dt) {
    this.left.tick(dt);
    this.right.tick(dt);
  }
}

class ExploreDemo {
  constructor(panel) {
    this.view = new PanelView(panel, [
      { type: "button", key: "play", icon: "play", label: "Play", onClick: () => this.toggle() }
    ]);
    const stage = this.view.stage;
    stage.innerHTML = "";
    stage.className = "demo-stage explore-grid";
    const corner = document.createElement("div");
    stage.appendChild(corner);
    ["few samples", "many samples"].forEach((text) => {
      const lab = document.createElement("div");
      lab.className = "explore-xlab";
      lab.textContent = text;
      stage.appendChild(lab);
    });
    this.walkers = [
      { step: 0.1, k: 1, color: "#c8c8c8" },
      { step: 0.1, k: 8, color: "#9ec5b2" },
      { step: 0.34, k: 1, color: "#c5b09e" },
      { step: 0.34, k: 8, color: "#a8a8d0" }
    ].map((spec, i) => {
      if (i === 0 || i === 2) {
        const lab = document.createElement("div");
        lab.className = "explore-ylab";
        lab.textContent = i === 0 ? "small steps" : "large steps";
        stage.appendChild(lab);
      }
      const cell = document.createElement("div");
      cell.className = "explore-cell";
      const canvas = document.createElement("canvas");
      cell.appendChild(canvas);
      stage.appendChild(cell);
      const mini = {
        canvas,
        ctx: canvas.getContext("2d"),
        cssW: 1,
        cssH: 1
      };
      const plot = new ContourPlot(mini, designedJ, {
        cols: 36,
        rows: 28,
        levels: 16,
        pad: { t: 4, r: 4, b: 4, l: 4 }
      });
      return { ...spec, x: 0, y: 0, trail: [], mini, plot };
    });
    this.playing = false;
    this.cool = 0;
    this.walkers.forEach((w) => {
      bindPlace2D(w.mini, w.plot, (p) => this.teleport(p));
    });
    this.view.onResize = () => this.resize();
    this.resize();
  }

  sizeMini(mini) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = mini.canvas.getBoundingClientRect();
    mini.cssW = Math.max(1, rect.width);
    mini.cssH = Math.max(1, rect.height);
    mini.canvas.width = Math.round(mini.cssW * dpr);
    mini.canvas.height = Math.round(mini.cssH * dpr);
    mini.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize() {
    this.walkers.forEach((w) => {
      this.sizeMini(w.mini);
      w.plot.layout();
      w.plot.bake();
    });
    this.draw();
  }

  teleport(p) {
    this.walkers.forEach((w) => {
      w.x = p.x;
      w.y = p.y;
      w.trail = [];
    });
    this.draw();
  }

  toggle() {
    this.playing = !this.playing;
    this.view.setPlay(this.playing);
  }

  enter() {
    this.resize();
    const plot = this.walkers[0].plot;
    const rng = rngFrom((Math.random() * 1e9) | 0);
    this.teleport({
      x: plot.xMin + rng() * (plot.xMax - plot.xMin),
      y: plot.yMin + rng() * (plot.yMax - plot.yMin)
    });
  }

  leave() {
    this.playing = false;
    this.view.setPlay(false);
  }

  stepWalker(w, rng) {
    const dist = new Neighbourhood("uniform", w.step);
    let best = { x: w.x, y: w.y };
    let bestH = designedJ(w.x, w.y);
    for (let i = 0; i < w.k; i++) {
      const p = w.plot.clamp({
        x: w.x + dist.sample(rng),
        y: w.y + dist.sample(rng)
      });
      const h = designedJ(p.x, p.y);
      if (h > bestH) {
        best = p;
        bestH = h;
      }
    }
    if (best.x !== w.x || best.y !== w.y) {
      w.trail.push({ x: w.x, y: w.y });
      if (w.trail.length > 28) w.trail.shift();
      w.x = best.x;
      w.y = best.y;
    }
  }

  tick(dt) {
    if (this.playing) {
      this.cool += dt;
      if (this.cool > 0.28) {
        this.cool = 0;
        this.walkers.forEach((w) => {
          const rng = rngFrom((Math.random() * 1e9) | 0);
          this.stepWalker(w, rng);
        });
      }
    }
    this.draw();
  }

  draw() {
    this.walkers.forEach((w) => {
      const { plot } = w;
      plot.clear();
      plot.drawField();
      const ctx = plot.view.ctx;
      ctx.beginPath();
      w.trail.forEach((p, i) => {
        const s = plot.toScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      const now = plot.toScreen(w.x, w.y);
      if (w.trail.length) ctx.lineTo(now.x, now.y);
      ctx.strokeStyle = w.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawDot(ctx, now.x, now.y, 4.4, w.color);
    });
  }
}

class SADemo {
  constructor(panel, opts) {
    this.onReplay = opts && opts.onReplay;
    this.view = new PanelView(panel, [
      { type: "button", key: "play", icon: "play", label: "Play", onClick: () => this.onReplay && this.onReplay() }
    ]);
    this.plot = new ContourPlot(this.view, designedJ, { cols: 54, rows: 42, levels: 18 });
    this.dist = new Neighbourhood("gaussian", 0.18);
    this.pos = { x: 0, y: 0 };
    this.T = 0.55;
    this.rng = rngFrom(1);
    this.trail = [];
    this.flash = 0;
    this.alive = false;
    this.cool = 0;
    this.view.onResize = () => {
      this.plot.layout();
      this.plot.bake();
      this.draw();
    };
  }

  reset(start, seed) {
    this.pos = { x: start.x, y: start.y };
    this.rng = rngFrom(seed);
    this.T = 0.6;
    this.trail = [];
    this.flash = 0;
    this.cool = 0;
  }

  enter() {}

  leave() {
    this.alive = false;
  }

  tick(dt) {
    if (!this.alive) return;
    this.cool += dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.cool > 0.07) {
      this.cool = 0;
      const nxt = this.plot.clamp({
        x: this.pos.x + this.dist.sample(this.rng),
        y: this.pos.y + this.dist.sample(this.rng)
      });
      const df = designedJ(nxt.x, nxt.y) - designedJ(this.pos.x, this.pos.y);
      const take = df >= 0 || this.rng() < Math.exp(df / Math.max(this.T, 0.02));
      if (take) {
        if (df < 0) this.flash = 0.35;
        this.trail.push({ x: this.pos.x, y: this.pos.y });
        if (this.trail.length > 40) this.trail.shift();
        this.pos = nxt;
      }
      this.T *= 0.995;
      if (this.T < 0.03) this.T = 0.6;
    }
    this.draw();
  }

  draw() {
    const { plot, pos } = this;
    plot.clear();
    plot.drawField();
    const ctx = plot.view.ctx;
    ctx.beginPath();
    this.trail.forEach((p, i) => {
      const s = plot.toScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    const now = plot.toScreen(pos.x, pos.y);
    if (this.trail.length) ctx.lineTo(now.x, now.y);
    ctx.strokeStyle = this.flash > 0 ? "rgba(190,140,140,0.8)" : "rgba(200,200,200,0.45)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    drawDot(ctx, now.x, now.y, 5, this.flash > 0 ? "#c99" : "#eee");
    ctx.fillStyle = "rgba(180,180,180,0.75)";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("T " + this.T.toFixed(2), 12, 18);
    ctx.fillRect(12, 24, 64 * Math.min(1, this.T / 0.6), 4);
  }
}

class ILSDemo {
  constructor(panel, opts) {
    this.onReplay = opts && opts.onReplay;
    this.view = new PanelView(panel, [
      { type: "button", key: "play", icon: "play", label: "Play", onClick: () => this.onReplay && this.onReplay() }
    ]);
    this.plot = new ContourPlot(this.view, designedJ, { cols: 54, rows: 42, levels: 18 });
    this.local = new Neighbourhood("uniform", 0.16);
    this.kick = new Neighbourhood("gaussian", 0.72);
    this.pos = { x: 0, y: 0 };
    this.rng = rngFrom(1);
    this.trail = [];
    this.stalls = 0;
    this.kicking = 0;
    this.alive = false;
    this.cool = 0;
    this.view.onResize = () => {
      this.plot.layout();
      this.plot.bake();
      this.draw();
    };
  }

  reset(start, seed) {
    this.pos = { x: start.x, y: start.y };
    this.rng = rngFrom(seed);
    this.trail = [];
    this.stalls = 0;
    this.kicking = 0;
    this.cool = 0;
  }

  enter() {}

  leave() {
    this.alive = false;
  }

  tick(dt) {
    if (!this.alive) return;
    this.cool += dt;
    this.kicking = Math.max(0, this.kicking - dt);
    if (this.cool > 0.07) {
      this.cool = 0;
      if (this.stalls >= 4) {
        const nxt = this.plot.clamp({
          x: this.pos.x + this.kick.sample(this.rng),
          y: this.pos.y + this.kick.sample(this.rng)
        });
        this.trail.push({ x: this.pos.x, y: this.pos.y, kick: true });
        if (this.trail.length > 40) this.trail.shift();
        this.pos = nxt;
        this.stalls = 0;
        this.kicking = 0.4;
      } else {
        let best = null;
        let bestH = designedJ(this.pos.x, this.pos.y);
        for (let i = 0; i < 6; i++) {
          const nxt = this.plot.clamp({
            x: this.pos.x + this.local.sample(this.rng),
            y: this.pos.y + this.local.sample(this.rng)
          });
          const h = designedJ(nxt.x, nxt.y);
          if (h > bestH) {
            best = nxt;
            bestH = h;
          }
        }
        if (best) {
          this.trail.push({ x: this.pos.x, y: this.pos.y });
          if (this.trail.length > 40) this.trail.shift();
          this.pos = best;
          this.stalls = 0;
        } else this.stalls += 1;
      }
    }
    this.draw();
  }

  draw() {
    const { plot, pos } = this;
    plot.clear();
    plot.drawField();
    const ctx = plot.view.ctx;
    ctx.beginPath();
    this.trail.forEach((p, i) => {
      const s = plot.toScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    const now = plot.toScreen(pos.x, pos.y);
    if (this.trail.length) ctx.lineTo(now.x, now.y);
    ctx.strokeStyle = this.kicking > 0 ? "rgba(180,180,220,0.85)" : "rgba(200,200,200,0.45)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    drawDot(ctx, now.x, now.y, 5, this.kicking > 0 ? "#c8c8ee" : "#eee");
  }
}

class EscapePairDemo {
  constructor(leftPanel, rightPanel) {
    this.left = new SADemo(leftPanel, { onReplay: () => this.replay() });
    this.right = new ILSDemo(rightPanel, { onReplay: () => this.replay() });
    const go = (p) => this.teleport(p);
    bindPlace2D(this.left.view, this.left.plot, go);
    bindPlace2D(this.right.view, this.right.plot, go);
    this.home = { x: 0, y: 0 };
    this.seed = 1;
  }

  teleport(p) {
    this.home = { x: p.x, y: p.y };
    this.replay();
  }

  replay() {
    const seed = (Math.random() * 1e9) | 0;
    this.seed = seed;
    this.left.reset(this.home, seed);
    this.right.reset(this.home, seed + 4);
    this.left.alive = true;
    this.right.alive = true;
  }

  enter() {
    const rng = rngFrom((Math.random() * 1e9) | 0);
    this.home = {
      x: this.left.plot.xMin + rng() * (this.left.plot.xMax - this.left.plot.xMin),
      y: this.left.plot.yMin + rng() * (this.left.plot.yMax - this.left.plot.yMin)
    };
    this.replay();
  }

  leave() {
    this.left.leave();
    this.right.leave();
  }

  tick(dt) {
    this.left.tick(dt);
    this.right.tick(dt);
  }
}

function mountDemos(host) {
  const slideOf = (el) => el.closest(".slide");
  const panel = (name) => document.querySelector('[data-demo="' + name + '"]');
  const add = (name, make) => {
    const el = panel(name);
    if (!el) return null;
    const demo = make(el);
    host.attach(slideOf(el), demo);
    return demo;
  };
  add("ascent", (el) => new AscentDemo(el));
  add("step-alpha", (el) => new AlphaStepDemo(el));
  add("ridge", (el) => new RidgeDemo(el));
  add("knobs", (el) => new KnobsDemo(el));
  add("hill1d", (el) => new Hill1DDemo(el));
  const fc = panel("first-choice");
  const st = panel("steepest");
  if (fc && st) host.attach(slideOf(fc), new SamplePairDemo(fc, st));
  const tu = panel("tweak-uniform");
  const tg = panel("tweak-gaussian");
  if (tu && tg) host.attach(slideOf(tu), new TweakPairDemo(tu, tg));
  add("explore", (el) => new ExploreDemo(el));
  const sa = panel("sa");
  const ils = panel("ils");
  if (sa && ils) host.attach(slideOf(sa), new EscapePairDemo(sa, ils));
}
