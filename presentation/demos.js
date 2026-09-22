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
    this.forEach(this.current, (d) => {
      if (d.tick && (!d.isIdle || !d.isIdle())) d.tick(dt);
    });
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

  isIdle() {
    return !this.running && !this.phases.playing;
  }

  tick(dt) {
    if (this.running) {
      this.cool += dt;
      if (this.cool >= 1) {
        this.cool = 0;
        this.takeMove();
      }
      this.draw();
      return;
    }
    if (!this.phases.playing) return;
    this.phases.tick(dt);
  }

  draw() {
    const { plot, x } = this;
    if (this.running) {
      plot.clear();
      plot.drawAxes();
      plot.drawCurve();
      const p = plot.toScreen(x, World1D.f(x));
      drawDot(plot.view.ctx, p.x, p.y, 7, this.stalled() ? "#d8d8d8" : "#f6f6f6");
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
      drawDot(plot.view.ctx, q.x, q.y, 6.2, col);
    }
    drawDot(plot.view.ctx, p.x, p.y, 7, this.stalled() ? "#d8d8d8" : "#f6f6f6");
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

  isIdle() {
    return !this.running && !this.phases.playing;
  }

  tick(dt) {
    if (this.running) {
      this.cool += dt;
      if (this.cool >= 1) {
        this.cool = 0;
        this.takeMove();
      }
      this.draw();
      return;
    }
    if (!this.phases.playing) return;
    this.phases.tick(dt);
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
      drawDot(plot.view.ctx, q.x, q.y, 6, "rgba(245,245,245,0.85)");
    }
    drawDot(plot.view.ctx, p.x, p.y, 7);
  }
}

class RidgeDemo {
  constructor(panel) {
    this.view = new PanelView(panel, [
      { type: "button", key: "play", icon: "play", label: "Play", onClick: () => this.toggle() }
    ]);
    this.plot = new CurvePlot(this.view);
    this.alpha = 0.04;
    this.mode = "climb";
    this.t = 0;
    this.reveal = 0;
    this.x = -2.05;
    this.beat = 0;
    this.playing = false;
    this.view.onResize = () => {
      this.plot.layout();
      this.draw();
    };
  }

  enter() {
    this.resetClimb();
    this.playing = false;
    this.view.setPlay(false);
    this.draw();
  }

  leave() {
    this.playing = false;
    this.view.setPlay(false);
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

  finished() {
    return this.mode === "reveal" && this.t > 1.65;
  }

  toggle() {
    if (this.playing) {
      this.playing = false;
      this.view.setPlay(false);
      return;
    }
    if (this.finished()) this.resetClimb();
    this.playing = true;
    this.view.setPlay(true);
  }

  stalled() {
    return Math.abs(World1D.df(this.x)) < World1D.flat;
  }

  isIdle() {
    return !this.playing;
  }

  tick(dt) {
    if (this.playing) {
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
        if (this.t > 1.65) {
          this.playing = false;
          this.view.setPlay(false);
        }
      }
      this.draw();
    }
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
      drawDot(plot.view.ctx, q.x, q.y, 7.2, "#f3ecd0");
      plot.view.ctx.globalAlpha = 1;
    }
    drawDot(plot.view.ctx, p.x, p.y, 7);
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

  isIdle() {
    return !this.playing;
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
      this.draw();
    }
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
      ctx.strokeStyle = "rgba(250,250,250,0.7)";
      ctx.lineWidth = 2.4;
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
    drawArrow(ctx, p.x, p.y, ax.x, ax.y, "rgba(250,250,250,0.98)");
    drawArrow(ctx, p.x, p.y, ay.x, ay.y, "rgba(250,250,250,0.98)");
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
      ctx.strokeStyle = "rgba(250,250,250,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      drawArrow(ctx, p.x, p.y, tip.x, tip.y, "rgba(255,248,210,1)");
    }
    const here = walk > 0 ? this.lerp(p, ps, walk) : p;
    drawDot(ctx, here.x, here.y, 7.2);
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

  isIdle() {
    return !this.alive;
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
      drawDot(plot.view.ctx, q.x, q.y, 6.2, col);
    }
    const p = plot.toScreen(x, World1D.f(x));
    drawDot(plot.view.ctx, p.x, p.y, 7);
  }
}

class Climb2DDemo {
  constructor(panel, opts) {
    this.k = (opts && opts.k) || 1;
    this.replace = opts && opts.replace === false ? false : true;
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

  isIdle() {
    return !this.alive;
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
        if (!this.replace || better) this.pos = best;
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
      drawDot(plot.view.ctx, s.x, s.y, 4.6, "rgba(245,245,245," + (0.7 * p.life) + ")");
    });
    if (this.chosen.length && this.phase !== "casino") {
      this.chosen.forEach((p) => {
        const s = plot.toScreen(p.x, p.y);
        const win = this.winner && p.x === this.winner.x && p.y === this.winner.y;
        const col = win
          ? (this.flash === "accept" ? "#b5d4b5" : this.flash === "reject" ? "#d4a0a0" : "#f0f0f0")
          : "rgba(248,248,248,0.88)";
        drawDot(plot.view.ctx, s.x, s.y, win ? 6.4 : 5.2, col);
      });
    }
    const s = plot.toScreen(pos.x, pos.y);
    drawDot(plot.view.ctx, s.x, s.y, 7.2);
  }
}

class SamplePairDemo {
  constructor(leftPanel, rightPanel) {
    this.left = new Climb2DDemo(leftPanel, { k: 1 });
    this.right = new Climb2DDemo(rightPanel, { k: 7, replace: false });
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

  isIdle() {
    return this.left.isIdle() && this.right.isIdle();
  }

  tick(dt) {
    this.left.tick(dt);
    this.right.tick(dt);
  }
}

class TweakPairDemo {
  constructor(leftPanel, rightPanel) {
    this.left = new Hill1DDemo(leftPanel, { kind: "uniform", param: 0.48 });
    this.right = new Hill1DDemo(rightPanel, { kind: "gaussian", param: 0.7, sigma: true });
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

  isIdle() {
    return this.left.isIdle() && this.right.isIdle();
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
        levels: 12,
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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = mini.canvas.getBoundingClientRect();
    mini.cssW = Math.max(1, rect.width);
    mini.cssH = Math.max(1, rect.height);
    const w = Math.round(mini.cssW * dpr);
    const h = Math.round(mini.cssH * dpr);
    if (mini.canvas.width === w && mini.canvas.height === h) return;
    mini.canvas.width = w;
    mini.canvas.height = h;
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

  isIdle() {
    return !this.playing;
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
      this.draw();
    }
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
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawDot(ctx, now.x, now.y, 6.6, w.color);
    });
  }
}

class SADemo {
  constructor(panel) {
    this.view = new PanelView(panel, []);
    const flush = panel.hasAttribute("data-no-meter");
    this.plot = new ContourPlot(this.view, designedJ, {
      levels: 12,
      pad: flush ? { t: 0, r: 0, b: 0, l: 0 } : undefined,
      clipRadius: flush ? 0 : undefined
    });
    this.meter = null;
    this.mctx = null;
    if (!panel.hasAttribute("data-no-meter")) {
      this.meter = document.createElement("canvas");
      this.meter.className = "sa-meter";
      panel.appendChild(this.meter);
      this.mctx = this.meter.getContext("2d");
    }
    this.dist = new Neighbourhood("gaussian", 0.18);
    this.pos = { x: 0, y: 0 };
    this.T = 0.55;
    this.rng = rngFrom(1);
    this.trail = [];
    this.marks = [];
    this.lastDf = null;
    this.flash = 0;
    this.alive = false;
    this.cool = 0;
    this.dMin = -0.55;
    this.dMax = 0.08;
    this.lineRgb = "220,160,160";
    this.view.onResize = () => {
      this.plot.layout();
      this.plot.bake();
      this.sizeMeter();
      this.draw();
    };
    this.sizeMeter();
  }

  sizeMeter() {
    if (!this.meter) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = this.meter.getBoundingClientRect();
    this.meterW = Math.max(1, rect.width);
    this.meterH = Math.max(1, rect.height);
    this.meter.width = Math.round(this.meterW * dpr);
    this.meter.height = Math.round(this.meterH * dpr);
    this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  reset(start, seed) {
    this.pos = { x: start.x, y: start.y };
    this.rng = rngFrom(seed);
    this.T = 0.6;
    this.trail = [];
    this.marks = [];
    this.flash = 0;
    this.cool = 0;
    this.lastDf = null;
  }

  enter() {}

  leave() {
    this.alive = false;
  }

  isIdle() {
    return !this.alive;
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
      const t = Math.max(this.T, 0.02);
      const p = df >= 0 ? 1 : Math.exp(df / t);
      const u = this.rng();
      const take = u < p;
      this.lastDf = df;
      this.marks.push({ df, u, take, life: 1 });
      if (this.marks.length > 80) this.marks.shift();
      if (take) {
        if (df < 0) this.flash = 0.35;
        this.trail.push({ x: this.pos.x, y: this.pos.y });
        if (this.trail.length > 40) this.trail.shift();
        this.pos = nxt;
      }
      this.T *= 0.995;
      if (this.T < 0.03) this.T = 0.6;
    }
    this.marks.forEach((m) => { m.life -= dt / 6; });
    this.marks = this.marks.filter((m) => m.life > 0);
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
    ctx.strokeStyle = this.flash > 0 ? "rgba(" + this.lineRgb + ",0.95)" : "rgba(250,250,250,0.8)";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    drawDot(ctx, now.x, now.y, 7.2, this.flash > 0 ? "#e0b0b0" : "#f6f6f6");
    this.drawMeter();
  }

  drawMeter() {
    if (!this.mctx) return;
    const ctx = this.mctx;
    const w = this.meterW;
    const h = this.meterH;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 36, r: 44, t: 14, b: 18 };
    const iw = Math.max(1, w - pad.l - pad.r);
    const ih = Math.max(1, h - pad.t - pad.b);
    const t = Math.max(this.T, 0.02);
    const xOf = (d) => pad.l + ((d - this.dMin) / (this.dMax - this.dMin)) * iw;
    const yOf = (p) => pad.t + (1 - p) * ih;
    const pOf = (d) => (d >= 0 ? 1 : Math.exp(d / t));
    const rgb = this.lineRgb;

    ctx.beginPath();
    ctx.moveTo(xOf(this.dMin), pad.t);
    for (let i = 0; i <= 80; i++) {
      const d = this.dMin + (this.dMax - this.dMin) * (i / 80);
      ctx.lineTo(xOf(d), yOf(pOf(d)));
    }
    ctx.lineTo(xOf(this.dMax), pad.t);
    ctx.closePath();
    ctx.fillStyle = "rgba(" + rgb + ",0.38)";
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const d = this.dMin + (this.dMax - this.dMin) * (i / 80);
      const x = xOf(d);
      const y = yOf(pOf(d));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(" + rgb + ",0.95)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + ih);
    ctx.lineTo(pad.l + iw, pad.t + ih);
    ctx.stroke();

    this.marks.forEach((m) => {
      const d = Math.max(this.dMin, Math.min(this.dMax, m.df));
      const x = xOf(d);
      const y = yOf(m.u);
      ctx.beginPath();
      ctx.arc(x, y, m.take ? 2.6 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = m.take
        ? "rgba(246,246,246," + (0.15 + 0.85 * m.life) + ")"
        : "rgba(" + rgb + "," + (0.2 + 0.8 * m.life) + ")";
      ctx.fill();
    });

    ctx.fillStyle = "rgba(200,200,200,0.72)";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("e\u0394/T", pad.l + 4, pad.t + 10);
    ctx.textAlign = "right";
    ctx.fillText("1", pad.l - 5, pad.t + 4);
    ctx.fillText("0", pad.l - 5, pad.t + ih + 3);
    ctx.textAlign = "center";
    ctx.fillText("0", xOf(0), h - 4);

    if (this.lastDf != null) {
      const shown = Math.max(this.dMin, Math.min(this.dMax, this.lastDf));
      const x = xOf(shown);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ih);
      ctx.strokeStyle = "rgba(246,246,246,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const label = (this.lastDf >= 0 ? "+" : "") + this.lastDf.toFixed(2);
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.fillStyle = "#eee";
      ctx.textAlign = x > pad.l + iw * 0.72 ? "right" : "left";
      ctx.fillText("\u0394 " + label, x + (x > pad.l + iw * 0.72 ? -5 : 5), pad.t + 11);
    }
  }
}

class ILSDemo {
  constructor(panel) {
    this.view = new PanelView(panel, []);
    this.plot = new ContourPlot(this.view, designedJ, { levels: 12 });
    this.local = new Neighbourhood("uniform", 0.16);
    this.kick = new Neighbourhood("gaussian", 0.72);
    this.pos = { x: 0, y: 0 };
    this.homebase = { x: 0, y: 0 };
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
    this.homebase = { x: start.x, y: start.y };
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

  isIdle() {
    return !this.alive;
  }

  tick(dt) {
    if (!this.alive) return;
    this.cool += dt;
    this.kicking = Math.max(0, this.kicking - dt);
    if (this.cool > 0.07) {
      this.cool = 0;
      if (this.stalls >= 4) {
        const nxt = this.plot.clamp({
          x: this.homebase.x + this.kick.sample(this.rng),
          y: this.homebase.y + this.kick.sample(this.rng)
        });
        this.trail.push({ x: this.homebase.x, y: this.homebase.y, kick: true });
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
          if (bestH > designedJ(this.homebase.x, this.homebase.y)) {
            this.homebase = { x: best.x, y: best.y };
          }
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
    ctx.strokeStyle = this.kicking > 0 ? "rgba(200,200,240,0.95)" : "rgba(250,250,250,0.8)";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    const home = plot.toScreen(this.homebase.x, this.homebase.y);
    drawDot(ctx, home.x, home.y, 5.4, "rgba(210,210,255,0.55)");
    drawDot(ctx, now.x, now.y, 7.2, this.kicking > 0 ? "#d4d4f4" : "#f6f6f6");
  }
}

class EscapePairDemo {
  constructor(leftPanel, rightPanel) {
    this.left = new SADemo(leftPanel);
    this.right = new ILSDemo(rightPanel);
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

  isIdle() {
    return this.left.isIdle() && this.right.isIdle();
  }

  tick(dt) {
    this.left.tick(dt);
    this.right.tick(dt);
  }
}

class GwoDemo {
  constructor(panel) {
    this.view = new PanelView(panel);
    this.plot = new ContourPlot(this.view, designedJ, { levels: 12 });
    this.fn = designedJ;
    this.packs = [];
    this.frames = [];
    this.frame = 0;
    this.cool = 0;
    this.alive = false;
    this.a = 2;
    this.fps = 8;
    this.view.onResize = () => {
      this.plot.layout();
      this.plot.bake();
      this.record();
      this.draw();
    };
  }

  packColors() {
    return [
      { fill: "#e8e0c8", trail: "rgba(232,224,200,0.7)", lead: "#f4e7a0" },
      { fill: "#9ecfc4", trail: "rgba(158,207,196,0.7)", lead: "#c8f0e4" },
      { fill: "#d8a0a8", trail: "rgba(216,160,168,0.7)", lead: "#f0c4c8" },
      { fill: "#a8b8e0", trail: "rgba(168,184,224,0.7)", lead: "#d0d8f4" }
    ];
  }

  seedPacks() {
    const starts = [
      { x: -0.92, y: -0.78 },
      { x: 0.88, y: -0.7 },
      { x: -0.8, y: 0.82 },
      { x: 0.78, y: 0.86 }
    ];
    const colors = this.packColors();
    this.packs = starts.map((home, i) => this.makePack(home, colors[i], 11 + i * 17));
    this.a = 2;
  }

  makePack(home, color, seed) {
    const rng = rngFrom(seed);
    const wolves = [];
    for (let i = 0; i < 6; i++) {
      const p = this.plot.clamp({
        x: home.x + (rng() - 0.5) * 0.34,
        y: home.y + (rng() - 0.5) * 0.34
      });
      wolves.push({
        x: p.x,
        y: p.y,
        trail: [],
        rank: i < 3 ? i : 3
      });
    }
    return { wolves, color, rng };
  }

  snapshot() {
    return this.packs.map((pack) => ({
      color: pack.color,
      wolves: pack.wolves.map((w) => ({
        x: w.x,
        y: w.y,
        rank: w.rank,
        trail: w.trail.map((p) => ({ x: p.x, y: p.y }))
      }))
    }));
  }

  record() {
    this.seedPacks();
    this.frames = [this.snapshot()];
    for (let i = 0; i < 22; i++) {
      this.a = Math.max(0.15, this.a - 0.18);
      if (this.a <= 0.16) this.a = 2;
      this.packs.forEach((pack) => this.hunt(pack));
      this.frames.push(this.snapshot());
    }
    this.frame = 0;
    this.packs = this.frames[0];
  }

  rankPack(pack) {
    pack.wolves.forEach((w) => { w.fit = this.fn(w.x, w.y); });
    pack.wolves.sort((a, b) => b.fit - a.fit);
    pack.wolves.forEach((w, i) => { w.rank = Math.min(i, 3); });
  }

  hunt(pack) {
    this.rankPack(pack);
    const alpha = pack.wolves[0];
    const beta = pack.wolves[1];
    const delta = pack.wolves[2];
    const a = this.a;
    const step = (leader, wolf) => {
      const r1 = pack.rng();
      const r2 = pack.rng();
      const A = 2 * a * r1 - a;
      const C = 2 * r2;
      return {
        x: leader.x - A * Math.abs(C * leader.x - wolf.x),
        y: leader.y - A * Math.abs(C * leader.y - wolf.y)
      };
    };
    pack.wolves.forEach((w, i) => {
      if (i === 0) return;
      const p1 = step(alpha, w);
      const p2 = step(beta, w);
      const p3 = step(delta, w);
      const nxt = this.plot.clamp({
        x: (p1.x + p2.x + p3.x) / 3,
        y: (p1.y + p2.y + p3.y) / 3
      });
      w.trail.push({ x: w.x, y: w.y });
      if (w.trail.length > 12) w.trail.shift();
      w.x = nxt.x;
      w.y = nxt.y;
    });
    const wander = this.plot.clamp({
      x: alpha.x + (pack.rng() - 0.5) * 0.04 * a,
      y: alpha.y + (pack.rng() - 0.5) * 0.04 * a
    });
    alpha.trail.push({ x: alpha.x, y: alpha.y });
    if (alpha.trail.length > 12) alpha.trail.shift();
    if (this.fn(wander.x, wander.y) >= alpha.fit) {
      alpha.x = wander.x;
      alpha.y = wander.y;
    }
  }

  enter() {
    this.alive = true;
    this.cool = 0;
    this.plot.layout();
    this.plot.bake();
    this.record();
    this.draw();
  }

  leave() {
    this.alive = false;
  }

  isIdle() {
    return !this.alive;
  }

  tick(dt) {
    if (!this.alive || this.frames.length < 2) return;
    this.cool += dt;
    const step = 1 / this.fps;
    if (this.cool < step) return;
    this.cool %= step;
    this.frame = (this.frame + 1) % this.frames.length;
    this.packs = this.frames[this.frame];
    this.draw();
  }

  draw() {
    const { plot } = this;
    plot.clear();
    plot.drawField();
    const ctx = plot.view.ctx;
    this.packs.forEach((pack) => {
      pack.wolves.forEach((w) => {
        if (!w.trail.length) return;
        ctx.beginPath();
        w.trail.forEach((p, i) => {
          const s = plot.toScreen(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        const now = plot.toScreen(w.x, w.y);
        ctx.lineTo(now.x, now.y);
        ctx.strokeStyle = pack.color.trail;
        ctx.lineWidth = w.rank === 0 ? 2.2 : 1.3;
        ctx.stroke();
      });
      pack.wolves.forEach((w) => {
        const s = plot.toScreen(w.x, w.y);
        const r = w.rank === 0 ? 7.1 : w.rank < 3 ? 5.6 : 4.4;
        const fill = w.rank === 0 ? pack.color.lead : pack.color.fill;
        drawDot(ctx, s.x, s.y, r, fill);
      });
    });
  }
}

class GeistDemo {
  constructor(panel) {
    this.view = new PanelView(panel);
    this.alive = false;
    this.cycle = 0;
    this.colors = {
      thesis: "#f3e08a",
      antithesis: "#9ecfc4",
      synthesis: "#f4e7d4"
    };
    this.durs = {
      hold: 1.15,
      spawn: 0.7,
      clash: 1.85,
      merge: 0.85,
      synth: 1.35
    };
    this.resetCycle(true);
    this.view.onResize = () => this.draw();
  }

  toScreen(p) {
    const pad = 56;
    const w = Math.max(8, this.view.cssW - pad * 2);
    const h = Math.max(8, this.view.cssH - pad * 2);
    return {
      x: pad + p.x * w,
      y: pad + (1 - p.y) * h
    };
  }

  resetCycle(fromStart) {
    if (fromStart || !this.thesis) {
      this.thesis = { x: 0.5, y: 0.22 };
    }
    const y = Math.min(0.78, this.thesis.y);
    const left = this.cycle % 2 === 0;
    this.thesisStart = { x: 0.5, y };
    this.antiStart = { x: left ? 0.12 : 0.88, y: Math.max(0.12, y - 0.06) };
    this.meet = { x: 0.5, y: Math.min(0.88, y + 0.16) };
    this.thesis = { ...this.thesisStart };
    this.anti = { ...this.antiStart };
    this.phase = "hold";
    this.t = 0;
    this.antiAlpha = 0;
  }

  enter() {
    this.alive = true;
    this.cycle = 0;
    this.resetCycle(true);
    this.draw();
  }

  leave() {
    this.alive = false;
  }

  isIdle() {
    return !this.alive;
  }

  tick(dt) {
    if (!this.alive) return;
    this.t += dt;
    const d = this.durs;
    if (this.phase === "hold") {
      this.antiAlpha = 0;
      if (this.t >= d.hold) {
        this.phase = "spawn";
        this.t = 0;
      }
    } else if (this.phase === "spawn") {
      this.antiAlpha = Math.min(1, this.t / d.spawn);
      this.anti = { ...this.antiStart };
      this.thesis = { ...this.thesisStart };
      if (this.t >= d.spawn) {
        this.phase = "clash";
        this.t = 0;
        this.antiAlpha = 1;
      }
    } else if (this.phase === "clash") {
      const u = Math.min(1, this.t / d.clash);
      const e = u * u * (3 - 2 * u);
      this.thesis = {
        x: this.thesisStart.x + (this.meet.x - this.thesisStart.x) * e,
        y: this.thesisStart.y + (this.meet.y - this.thesisStart.y) * e
      };
      this.anti = {
        x: this.antiStart.x + (this.meet.x - this.antiStart.x) * e,
        y: this.antiStart.y + (this.meet.y - this.antiStart.y) * e
      };
      this.antiAlpha = 1;
      if (this.t >= d.clash) {
        this.phase = "merge";
        this.t = 0;
      }
    } else if (this.phase === "merge") {
      this.thesis = { ...this.meet };
      this.anti = { ...this.meet };
      this.antiAlpha = Math.max(0, 1 - this.t / d.merge);
      if (this.t >= d.merge) {
        this.phase = "synth";
        this.t = 0;
        this.antiAlpha = 0;
      }
    } else if (this.phase === "synth") {
      this.thesis = { ...this.meet };
      this.antiAlpha = 0;
      if (this.t >= d.synth) {
        this.cycle += 1;
        if (this.cycle >= 4) this.cycle = 0;
        this.thesis = { ...this.meet };
        this.resetCycle(this.cycle === 0);
      }
    }
    this.draw();
  }

  label(ctx, s, text, color) {
    ctx.save();
    ctx.font = "650 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(10,10,12,0.72)";
    ctx.strokeText(text, s.x, s.y - 14);
    ctx.fillStyle = color;
    ctx.fillText(text, s.x, s.y - 14);
    ctx.restore();
  }

  draw() {
    const { view } = this;
    const ctx = view.ctx;
    if (!ctx || view.cssW < 8) return;
    ctx.clearRect(0, 0, view.cssW, view.cssH);
    const th = this.toScreen(this.thesis);
    if (this.phase === "clash" || this.phase === "spawn") {
      const an = this.toScreen(this.anti);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(th.x, th.y);
      ctx.lineTo(an.x, an.y);
      ctx.strokeStyle = "rgba(240,240,240,0.28)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.restore();
    }
    if (this.phase === "synth" || this.phase === "merge") {
      drawDot(ctx, th.x, th.y, 9.4, this.colors.synthesis);
      this.label(ctx, th, "synthesis", this.colors.synthesis);
    } else {
      drawDot(ctx, th.x, th.y, 7.2, this.colors.thesis);
      this.label(ctx, th, "thesis", this.colors.thesis);
      if (this.antiAlpha > 0.04 && this.phase !== "merge") {
        const an = this.toScreen(this.anti);
        ctx.save();
        ctx.globalAlpha = this.antiAlpha;
        drawDot(ctx, an.x, an.y, 7.2, this.colors.antithesis);
        this.label(ctx, an, "antithesis", this.colors.antithesis);
        ctx.restore();
      }
    }
  }
}

class GaPipelineHeader {
  constructor(host, current) {
    this.host = host;
    this.current = current;
    this.render();
  }

  render() {
    this.host.innerHTML = "";
    const stages = [
      ["assess", "Assess", ""],
      ["select", "Select", "select"],
      ["crossover", "Crossover", "crossover"],
      ["mutate", "Mutate", "mutate"]
    ];
    stages.forEach((stage, i) => {
      if (i) {
        const arrow = document.createElement("span");
        arrow.className = "ga-arrow";
        arrow.textContent = "→";
        this.host.appendChild(arrow);
      }
      const node = document.createElement("span");
      node.className = "ga-stage " + stage[2];
      node.textContent = stage[1];
      if (stage[0] === this.current) node.classList.add("active");
      this.host.appendChild(node);
    });
  }
}

function gaButton(label, onClick, className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  if (className) btn.className = className;
  btn.addEventListener("click", onClick);
  return btn;
}

function gaIconBtn(icon, label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "demo-icon";
  btn.setAttribute("aria-label", label);
  btn.innerHTML = iconSvg(icon);
  btn.addEventListener("click", onClick);
  return btn;
}

function gaSetPlay(btn, on) {
  if (!btn) return;
  btn.setAttribute("aria-label", on ? "Pause" : "Play");
  btn.innerHTML = iconSvg(on ? "pause" : "play");
}

function gaRepeat(bar, onClick) {
  bar.appendChild(gaIconBtn("repeat", "Repeat", onClick));
}

function gaFillPanel(panel, extraBar) {
  panel.innerHTML = "";
  panel.classList.add("ga-demo");
  const body = document.createElement("div");
  body.className = "ga-method-body";
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  panel.appendChild(body);
  panel.appendChild(bar);
  if (extraBar) extraBar(bar);
  return { body, bar };
}

function gaBar(label, value, color) {
  const row = document.createElement("div");
  row.className = "ga-bar-row";
  const name = document.createElement("span");
  name.textContent = label;
  const track = document.createElement("span");
  track.className = "ga-bar-track";
  const fill = document.createElement("span");
  fill.className = "ga-bar-fill";
  fill.style.width = Math.round(value * 100) + "%";
  fill.style.background = color || "#ddd";
  track.appendChild(fill);
  row.appendChild(name);
  row.appendChild(track);
  return row;
}

class PipelineCompareDemo {
  constructor(panel) {
    panel.innerHTML = "";
    panel.classList.add("ga-pipeline-demo");
    const title = document.createElement("div");
    title.className = "ga-static-diagram";
    const make = (name, stages) => {
      const card = document.createElement("div");
      card.className = "ga-pipeline-card";
      const h = document.createElement("strong");
      h.textContent = name;
      const flow = document.createElement("div");
      flow.className = "ga-pipeline";
      stages.forEach((stage, i) => {
        if (i) {
          const arrow = document.createElement("span");
          arrow.className = "ga-arrow";
          arrow.textContent = "→";
          flow.appendChild(arrow);
        }
        const node = document.createElement("span");
        node.className = "ga-stage " + (stage[0] || "");
        node.textContent = stage[1];
        flow.appendChild(node);
      });
      card.appendChild(h);
      card.appendChild(flow);
      title.appendChild(card);
    };
    make("Genetic algorithm", [["", "Assess"], ["select", "Select"], ["crossover", "Crossover"], ["mutate", "Mutate"]]);
    make("Evolutionary strategy", [["", "Assess"], ["select", "Select"], ["mutate", "Mutate"]]);
    panel.appendChild(title);
  }
  enter() {}
  leave() {}
  tick() {}
}

class SelectionDemo {
  constructor(leftPanel, rightPanel) {
    this.fit = [32, 7, 11, 18, 6, 14, 4, 8];
    this.s = this.fit.reduce((a, b) => a + b, 0);
    this.n = this.fit.length;
    this.rng = rngFrom(11);
    this.playing = false;
    this.tnHold = 0;
    this.left = gaFillPanel(leftPanel, (bar) => {
      gaRepeat(bar, () => this.resetRoulette());
    });
    this.buildRoulette();
    this.right = gaFillPanel(rightPanel, (bar) => {
      gaRepeat(bar, () => this.resetTournament(true));
      this.tnStep = gaIconBtn("step", "Step", () => this.stepTournament());
      this.tnPlay = gaIconBtn("play", "Play", () => this.toggleTournament());
      bar.appendChild(this.tnStep);
      bar.appendChild(this.tnPlay);
    });
    this.buildTournament();
    this.resetRoulette();
    this.resetTournament(true);
  }

  buildRoulette() {
    const body = this.left.body;
    body.className = "ga-method-body ga-card sus-body";
    body.innerHTML = "";
    const chart = document.createElement("div");
    chart.className = "sus-chart";
    const row = (label, extra, trackRef) => {
      const name = document.createElement("span");
      name.className = "sus-label";
      name.textContent = label;
      const track = document.createElement("div");
      track.className = "sus-track " + extra;
      chart.appendChild(name);
      chart.appendChild(track);
      if (trackRef) this[trackRef] = track;
    };
    row("Roulette", "sus-line", "rwLine");
    row("Individuals", "sus-bar", "rwBar");
    row("", "sus-bar", "susBar");
    row("SUS ඞ", "sus-line", "susLine");
    const fillBar = (bar) => {
      this.fit.forEach((w, i) => {
        const cell = document.createElement("div");
        cell.className = "sus-cell";
        cell.style.flexGrow = String(w);
        cell.textContent = String(i + 1);
        bar.appendChild(cell);
      });
    };
    fillBar(this.rwBar);
    fillBar(this.susBar);
    body.appendChild(chart);
    this.rwCells = [...this.rwBar.children];
    this.susCells = [...this.susBar.children];
  }

  sampleS() {
    return this.rng() * this.s;
  }

  resetRoulette() {
    this.rwChosen = Array.from({ length: this.n }, () => this.sampleS());
    const step = this.s / this.n;
    const u0 = this.sampleS() % step;
    this.susChosen = Array.from({ length: this.n }, (_, i) => u0 + i * step);
    this.hold = 0;
    this.drawRoulette();
  }

  paintLine(track, chosen) {
    track.querySelectorAll(".sus-tick").forEach((el) => el.remove());
    chosen.forEach((pos) => {
      const tick = document.createElement("span");
      tick.className = "sus-tick chosen";
      tick.style.left = (pos / this.s * 100) + "%";
      track.appendChild(tick);
    });
  }

  drawRoulette() {
    this.paintLine(this.rwLine, this.rwChosen);
    this.paintLine(this.susLine, this.susChosen);
    const hitsFor = (chosen) => {
      const hits = new Set();
      chosen.forEach((pos) => {
        let acc = 0;
        for (let i = 0; i < this.fit.length; i++) {
          acc += this.fit[i];
          if (pos <= acc) {
            hits.add(i);
            return;
          }
        }
        hits.add(this.fit.length - 1);
      });
      return hits;
    };
    const rwHits = hitsFor(this.rwChosen);
    const susHits = hitsFor(this.susChosen);
    this.rwCells.forEach((cell, i) => cell.classList.toggle("hit", rwHits.has(i)));
    this.susCells.forEach((cell, i) => {
      const on = susHits.has(i);
      cell.classList.toggle("hit", on);
      cell.classList.toggle("sus-hit", on);
    });
  }

  makePerson(i, extra) {
    const el = document.createElement("div");
    el.className = "tn-person" + (extra ? " " + extra : "");
    el.dataset.i = String(i);
    const id = document.createElement("strong");
    id.textContent = String(i + 1);
    const score = document.createElement("small");
    score.textContent = String(this.fit[i]);
    el.appendChild(id);
    el.appendChild(score);
    return el;
  }

  buildTournament() {
    const body = this.right.body;
    body.className = "ga-method-body ga-card tn-body";
    body.innerHTML = "";
    const board = document.createElement("div");
    board.className = "tn-board";

    const poolBand = document.createElement("div");
    poolBand.className = "tn-band";
    const poolLabel = document.createElement("span");
    poolLabel.className = "tn-label";
    poolLabel.textContent = "Individuals";
    this.tnPool = document.createElement("div");
    this.tnPool.className = "tn-row";
    this.fit.forEach((_, i) => this.tnPool.appendChild(this.makePerson(i)));
    poolBand.appendChild(poolLabel);
    poolBand.appendChild(this.tnPool);

    const arena = document.createElement("div");
    arena.className = "tn-arena";
    this.tnArrowsIn = document.createElement("div");
    this.tnArrowsIn.className = "tn-arrows tn-arrows-in";
    this.tnArrowsIn.innerHTML = "<span>↓</span><span>↓</span>";
    const fight = document.createElement("div");
    fight.className = "tn-fight";
    this.tnSlotA = document.createElement("div");
    this.tnSlotA.className = "tn-slot";
    this.tnVs = document.createElement("span");
    this.tnVs.className = "tn-vs";
    this.tnVs.textContent = "vs";
    this.tnSlotB = document.createElement("div");
    this.tnSlotB.className = "tn-slot";
    fight.appendChild(this.tnSlotA);
    fight.appendChild(this.tnVs);
    fight.appendChild(this.tnSlotB);
    this.tnArrowsOut = document.createElement("div");
    this.tnArrowsOut.className = "tn-arrows tn-arrows-out";
    this.tnArrowsOut.textContent = "↓";
    arena.appendChild(this.tnArrowsIn);
    arena.appendChild(fight);
    arena.appendChild(this.tnArrowsOut);

    const selBand = document.createElement("div");
    selBand.className = "tn-band";
    const selLabel = document.createElement("span");
    selLabel.className = "tn-label";
    selLabel.textContent = "Selected";
    this.tnSelected = document.createElement("div");
    this.tnSelected.className = "tn-row tn-selected-row";
    selBand.appendChild(selLabel);
    selBand.appendChild(this.tnSelected);

    board.appendChild(poolBand);
    board.appendChild(arena);
    board.appendChild(selBand);
    body.appendChild(board);
  }

  samplePair() {
    const a = Math.floor(this.rng() * this.n);
    let b = Math.floor(this.rng() * this.n);
    if (b === a) b = (b + 1) % this.n;
    this.pair = [a, b];
    this.winner = this.fit[a] >= this.fit[b] ? a : b;
    this.loser = this.winner === a ? b : a;
  }

  resetTournament(keepSeed) {
    if (!keepSeed) this.rng = rngFrom((Math.random() * 1e9) | 0);
    this.playing = false;
    this.tnHold = 0;
    this.tnPhase = "idle";
    this.pair = null;
    this.winner = null;
    this.loser = null;
    this.picked = [];
    gaSetPlay(this.tnPlay, false);
    this.paintTournament();
  }

  toggleTournament() {
    if (this.playing) {
      this.playing = false;
      gaSetPlay(this.tnPlay, false);
      return;
    }
    if (this.tnPhase === "done") this.resetTournament(false);
    this.playing = true;
    gaSetPlay(this.tnPlay, true);
    if (this.tnPhase === "idle") this.advanceTournament();
  }

  stepTournament() {
    this.playing = false;
    gaSetPlay(this.tnPlay, false);
    this.advanceTournament();
  }

  phaseDur() {
    if (this.tnPhase === "pick") return 0.45;
    if (this.tnPhase === "arena") return 0.55;
    if (this.tnPhase === "compare") return 0.85;
    if (this.tnPhase === "drop") return 0.55;
    return 0.4;
  }

  advanceTournament() {
    if (this.tnPhase === "done") {
      this.resetTournament(false);
    }
    if (this.tnPhase === "idle" || this.tnPhase === "drop") {
      if (this.picked.length >= this.n) {
        this.tnPhase = "done";
        this.playing = false;
        gaSetPlay(this.tnPlay, false);
        this.paintTournament();
        return;
      }
      this.samplePair();
      this.tnPhase = "pick";
    } else if (this.tnPhase === "pick") {
      this.tnPhase = "arena";
    } else if (this.tnPhase === "arena") {
      this.tnPhase = "compare";
    } else if (this.tnPhase === "compare") {
      this.picked.push(this.winner);
      this.tnPhase = "drop";
    }
    this.tnHold = 0;
    this.paintTournament();
  }

  paintTournament() {
    const showArena = this.tnPhase === "arena" || this.tnPhase === "compare" || this.tnPhase === "drop";
    const comparing = this.tnPhase === "compare" || this.tnPhase === "drop";
    const dropping = this.tnPhase === "drop";
    this.tnPool.querySelectorAll(".tn-person").forEach((el, i) => {
      const inPair = this.pair && (i === this.pair[0] || i === this.pair[1]);
      el.classList.toggle("picked", !!inPair && this.tnPhase !== "idle" && this.tnPhase !== "done");
      el.classList.toggle("winner", comparing && i === this.winner);
      el.classList.toggle("loser", comparing && i === this.loser);
    });
    this.tnSlotA.innerHTML = "";
    this.tnSlotB.innerHTML = "";
    if (showArena && this.pair) {
      const a = this.makePerson(this.pair[0], "arena");
      const b = this.makePerson(this.pair[1], "arena");
      if (comparing) {
        a.classList.add(this.pair[0] === this.winner ? "win" : "lose");
        b.classList.add(this.pair[1] === this.winner ? "win" : "lose");
      }
      this.tnSlotA.appendChild(a);
      this.tnSlotB.appendChild(b);
    }
    this.tnArrowsIn.classList.toggle("on", this.tnPhase === "pick" || this.tnPhase === "arena");
    this.tnArrowsOut.classList.toggle("on", dropping);
    this.tnVs.classList.toggle("on", showArena);
    this.tnSelected.innerHTML = "";
    for (let i = 0; i < this.n; i++) {
      if (i < this.picked.length) this.tnSelected.appendChild(this.makePerson(this.picked[i], "kept"));
      else {
        const hole = document.createElement("div");
        hole.className = "tn-hole";
        this.tnSelected.appendChild(hole);
      }
    }
  }

  enter() {
    this.rng = rngFrom((Math.random() * 1e9) | 0);
    this.resetRoulette();
    this.resetTournament(true);
  }
  leave() {
    this.playing = false;
    gaSetPlay(this.tnPlay, false);
  }
  isIdle() {
    return !this.playing;
  }
  tick(dt) {
    if (!this.playing) return;
    this.tnHold += dt;
    if (this.tnHold >= this.phaseDur()) this.advanceTournament();
  }
}

class CrossoverDemo {
  constructor(leftPanel, rightPanel) {
    this.a = [1, 1, 0, 0, 1, 0, 0, 1];
    this.b = [0, 0, 1, 0, 1, 1, 0, 0];
    this.n = this.a.length;
    this.alpha = 0.5;
    this.beyond = false;
    this.alphaLo = 0;
    this.alphaHi = 1;
    this.va = { x: 0.86, y: 0.28 };
    this.vb = { x: 0.32, y: 0.88 };
    this.rng = rngFrom(21);
    this.discrete = gaFillPanel(leftPanel, (bar) => {
      gaRepeat(bar, () => this.resample());
    });
    this.discrete.body.className = "ga-method-body ga-genome-body";
    this.linear = gaFillPanel(rightPanel, (bar) => {
      gaRepeat(bar, () => {
        this.pickParents();
        const span = this.alphaHi - this.alphaLo;
        this.alpha = this.alphaLo + ((this.alpha - this.alphaLo + 0.25) % (span + 0.01));
        this.renderLinear();
      });
      const range = document.createElement("input");
      range.type = "range";
      range.min = this.alphaLo;
      range.max = this.alphaHi;
      range.step = 0.01;
      range.value = this.alpha;
      range.addEventListener("input", () => {
        this.alpha = Number(range.value);
        this.renderLinear();
      });
      const wrap = document.createElement("label");
      wrap.className = "demo-slider";
      const name = document.createElement("span");
      name.textContent = "α";
      const val = document.createElement("strong");
      wrap.appendChild(name);
      wrap.appendChild(range);
      wrap.appendChild(val);
      bar.appendChild(wrap);
      this.linearInput = range;
      this.linearAlphaVal = val;
      const outside = gaButton("outside", () => this.setBeyond(!this.beyond));
      bar.appendChild(outside);
      this.beyondBtn = outside;
    });
    this.linear.body.className = "ga-method-body ga-linear-body";
    this.linearCanvas = document.createElement("canvas");
    this.linear.body.appendChild(this.linearCanvas);
    this.linearCtx = this.linearCanvas.getContext("2d");
    this.linearCss = { w: 1, h: 1 };
    new ResizeObserver(() => this.renderLinear()).observe(this.linear.body);
    this.resample(true);
  }

  randInt(lo, hi) {
    return lo + Math.floor(this.rng() * (hi - lo + 1));
  }

  resample(keepSeed) {
    if (!keepSeed) this.rng = rngFrom((Math.random() * 1e9) | 0);
    this.one = this.randInt(1, this.n - 1);
    const c = this.randInt(1, this.n - 3);
    const d = this.randInt(c + 2, this.n - 1);
    this.two = [c, d];
    this.mask = Array.from({ length: this.n }, () => this.rng() < 0.5);
    if (!this.mask.some(Boolean)) this.mask[this.randInt(0, this.n - 1)] = true;
    this.pickParents();
    this.renderDiscrete();
    this.renderLinear();
  }

  pickParents() {
    this.va = { x: 0.5 + this.rng() * 0.55, y: 0.12 + this.rng() * 0.4 };
    this.vb = { x: 0.12 + this.rng() * 0.4, y: 0.5 + this.rng() * 0.55 };
  }

  setBeyond(on) {
    this.beyond = on;
    this.alphaLo = on ? -0.75 : 0;
    this.alphaHi = on ? 1.75 : 1;
    if (!on) this.alpha = Math.max(0, Math.min(1, this.alpha));
    this.linearInput.min = this.alphaLo;
    this.linearInput.max = this.alphaHi;
    this.beyondBtn.classList.toggle("on", on);
    this.renderLinear();
  }

  mixVec(alpha) {
    return {
      x: alpha * this.va.x + (1 - alpha) * this.vb.x,
      y: alpha * this.va.y + (1 - alpha) * this.vb.y
    };
  }

  maskFor(kind) {
    if (kind === "one") return this.a.map((_, i) => i >= this.one);
    if (kind === "two") return this.a.map((_, i) => i >= this.two[0] && i < this.two[1]);
    return this.mask.slice();
  }

  cutsFor(kind) {
    if (kind === "one") return [{ at: this.one, label: "c" }];
    if (kind === "two") return [{ at: this.two[0], label: "c" }, { at: this.two[1], label: "d" }];
    return [];
  }

  renderDiscrete() {
    const body = this.discrete.body;
    body.innerHTML = "";
    const stack = document.createElement("div");
    stack.className = "xo-stack";
    [
      ["one", "One-point"],
      ["two", "Two-point"],
      ["uniform", "Uniform"]
    ].forEach(([kind, title]) => {
      stack.appendChild(this.buildBoard(title, this.maskFor(kind), this.cutsFor(kind)));
    });
    body.appendChild(stack);
  }

  buildBoard(title, swap, cuts) {
    const card = document.createElement("div");
    card.className = "xo-card";
    const h = document.createElement("strong");
    h.textContent = title;
    card.appendChild(h);
    const grid = document.createElement("div");
    grid.className = "xo-grid";
    grid.style.setProperty("--n", String(this.n));
    grid.appendChild(this.bitRow(this.a, swap));
    grid.appendChild(this.bridgeRow(swap, cuts));
    grid.appendChild(this.bitRow(this.b, swap));
    grid.appendChild(this.cutRow(cuts));
    card.appendChild(grid);
    return card;
  }

  bitRow(bits, swap) {
    const row = document.createElement("div");
    row.className = "xo-bits";
    bits.forEach((bit, i) => {
      const cell = document.createElement("span");
      cell.className = "xo-cell" + (swap[i] ? " xo-swapped" : "");
      cell.textContent = String(bit);
      row.appendChild(cell);
    });
    return row;
  }

  bridgeRow(swap, cuts) {
    const row = document.createElement("div");
    row.className = "xo-bridge";
    for (let i = 0; i < this.n; i++) {
      const slot = document.createElement("span");
      slot.className = "xo-slot";
      if (swap[i]) {
        const arrow = document.createElement("span");
        arrow.className = "xo-swap";
        arrow.innerHTML = "<em>↕</em><small>Swap</small>";
        slot.appendChild(arrow);
      }
      row.appendChild(slot);
    }
    cuts.forEach((cut) => {
      const line = document.createElement("span");
      line.className = "xo-cut";
      line.style.left = "calc(" + cut.at + " / var(--n) * 100%)";
      row.appendChild(line);
    });
    return row;
  }

  cutRow(cuts) {
    const row = document.createElement("div");
    row.className = "xo-labels";
    const tight = cuts.length === 2 && cuts[1].at - cuts[0].at === 2;
    cuts.forEach((cut, i) => {
      const mark = document.createElement("span");
      mark.className = "xo-cut-label";
      mark.style.left = "calc(" + cut.at + " / var(--n) * 100%)";
      if (tight) mark.style.transform = i === 0 ? "translateX(-70%)" : "translateX(-30%)";
      mark.textContent = cut.label;
      row.appendChild(mark);
    });
    return row;
  }

  renderLinear() {
    if (!this.linearCanvas || !this.linearCtx) return;
    const canvas = this.linearCanvas;
    const ctx = this.linearCtx;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = this.linear.body.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.linearCss.w = w;
    this.linearCss.h = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const a = this.va;
    const b = this.vb;
    const c = this.mixVec(this.alpha);
    const pts = [ { x: 0, y: 0 }, a, b, c ];
    if (this.beyond) {
      pts.push(this.mixVec(this.alphaLo));
      pts.push(this.mixVec(this.alphaHi));
    }
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    pts.forEach((p) => {
      xmin = Math.min(xmin, p.x);
      xmax = Math.max(xmax, p.x);
      ymin = Math.min(ymin, p.y);
      ymax = Math.max(ymax, p.y);
    });
    const span = Math.max(xmax - xmin, ymax - ymin, 0.55) * 1.28;
    const cx = (xmin + xmax) / 2;
    const cy = (ymin + ymax) / 2;
    xmin = cx - span / 2;
    xmax = cx + span / 2;
    ymin = cy - span / 2;
    ymax = cy + span / 2;
    const pad = 26;
    const toS = (p) => ({
      x: pad + ((p.x - xmin) / (xmax - xmin)) * (w - 2 * pad),
      y: h - pad - ((p.y - ymin) / (ymax - ymin)) * (h - 2 * pad)
    });
    const o = toS({ x: 0, y: 0 });
    const sa = toS(a);
    const sb = toS(b);
    const sc = toS(c);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, o.y);
    ctx.lineTo(w - pad, o.y);
    ctx.moveTo(o.x, pad);
    ctx.lineTo(o.x, h - pad);
    ctx.stroke();

    const farA = this.mixVec(this.beyond ? 1.85 : 1);
    const farB = this.mixVec(this.beyond ? -0.85 : 0);
    const sFarA = toS(farA);
    const sFarB = toS(farB);
    ctx.setLineDash(this.beyond ? [5, 5] : [4, 6]);
    ctx.strokeStyle = this.beyond ? "rgba(243,224,138,0.35)" : "rgba(184,162,230,0.35)";
    ctx.beginPath();
    ctx.moveTo(sFarB.x, sFarB.y);
    ctx.lineTo(sFarA.x, sFarA.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const aA = { x: this.alpha * a.x, y: this.alpha * a.y };
    const aB = { x: (1 - this.alpha) * b.x, y: (1 - this.alpha) * b.y };
    const sAA = toS(aA);
    const sAB = toS({ x: aA.x + aB.x, y: aA.y + aB.y });
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(184,162,230,0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(sAA.x, sAA.y);
    ctx.lineTo(sAB.x, sAB.y);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawArrow(ctx, o.x, o.y, sa.x, sa.y, "#b8a2e6", 2.2);
    this.drawArrow(ctx, o.x, o.y, sb.x, sb.y, "#7ec8b8", 2.2);
    this.drawArrow(ctx, o.x, o.y, sc.x, sc.y, "#f3e08a", 2.8);
    this.drawDot(ctx, sa.x, sa.y, 3.4, "#b8a2e6");
    this.drawDot(ctx, sb.x, sb.y, 3.4, "#7ec8b8");
    this.drawDot(ctx, sc.x, sc.y, 4.4, "#f3e08a");

    ctx.font = "700 0.72rem system-ui, sans-serif";
    ctx.fillStyle = "#c6b5ef";
    ctx.fillText("A", sa.x + 6, sa.y - 6);
    ctx.fillStyle = "#9ed9ce";
    ctx.fillText("B", sb.x + 6, sb.y - 6);
    ctx.fillStyle = "#f3e08a";
    ctx.fillText("C", sc.x + 6, sc.y - 6);

    this.linearInput.value = this.alpha;
    if (this.linearAlphaVal) this.linearAlphaVal.textContent = this.alpha.toFixed(2);
  }

  drawArrow(ctx, x0, y0, x1, y1, color, lw) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = Math.min(11, Math.max(7, len * 0.16));
    const bx = x1 - ux * head;
    const by = y1 - uy * head;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(bx - uy * head * 0.48, by + ux * head * 0.48);
    ctx.lineTo(bx + uy * head * 0.48, by - ux * head * 0.48);
    ctx.closePath();
    ctx.fill();
  }

  drawDot(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  enter() {
    this.rng = rngFrom((Math.random() * 1e9) | 0);
    this.resample(true);
  }
  leave() {}
  tick() {}
}

const TREE_OPS = ["+", "−", "×", "÷"];
const TREE_LEAVES = ["x", "y", "t", "0", "1", "2", "3", "π", "e"];

function svgNode(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.keys(attrs || {}).forEach((key) => el.setAttribute(key, attrs[key]));
  return el;
}

class MutationDemo {
  constructor(leftPanel, rightPanel) {
    this.leftMode = 0;
    this.sigma2 = 0.004;
    this.rule = false;
    this.nid = 1;
    this.hot = new Set();
    this.note = "start";
    this.rng = rngFrom(21);
    this.cam = null;
    this.camTo = null;
    this.left = gaFillPanel(leftPanel, (bar) => {
      gaRepeat(bar, () => this.mutationStep("left"));
      const wrap = document.createElement("label");
      wrap.className = "demo-slider";
      wrap.textContent = "σ² ";
      const sigmaInput = document.createElement("input");
      sigmaInput.type = "range";
      sigmaInput.min = "0.001";
      sigmaInput.max = "0.5";
      sigmaInput.step = "0.001";
      sigmaInput.value = this.sigma2;
      sigmaInput.addEventListener("input", () => {
        this.sigma2 = Number(sigmaInput.value);
        this.renderLeft();
      });
      wrap.appendChild(sigmaInput);
      bar.appendChild(wrap);
      this.sigmaInput = sigmaInput;
      const rule = gaButton(this.rule ? "1/5 on" : "1/5 rule", () => {
        this.rule = !this.rule;
        rule.textContent = this.rule ? "1/5 on" : "1/5 rule";
        rule.classList.toggle("on", this.rule);
      });
      bar.appendChild(rule);
    });
    this.left.body.className = "ga-method-body ga-mutation-body";
    this.right = gaFillPanel(rightPanel, (bar) => {
      gaRepeat(bar, () => this.resetTree());
      bar.appendChild(gaIconBtn("step", "Step", () => this.stepTree()));
    });
    this.right.body.className = "ga-method-body ga-mutation-body ga-tree-body";
    this.buildTreeUi();
    this.resetTree(true);
    this.renderLeft();
  }

  leaf(label) {
    return { kind: "leaf", label, id: this.nid++ };
  }

  bin(op, left, right) {
    return { kind: "bin", op, left, right, id: this.nid++ };
  }

  walk(node, parent, fn) {
    fn(node, parent);
    if (node.kind === "bin") {
      this.walk(node.left, node, fn);
      this.walk(node.right, node, fn);
    }
  }

  pick(list) {
    return list[Math.floor(this.rng() * list.length)];
  }

  countLeaves() {
    let n = 0;
    this.walk(this.root, null, (node) => {
      if (node.kind === "leaf") n += 1;
    });
    return n;
  }

  mutationStep(side) {
    if (side !== "left") {
      this.stepTree();
      return;
    }
    this.leftMode = (this.leftMode + 1) % 3;
    if (this.rule) {
      const success = this.leftMode === 2 ? 0.3 : 0.1;
      this.sigma2 = Math.max(0.001, Math.min(0.5, this.sigma2 * (success > 0.2 ? 1.2 : 0.82)));
    }
    this.renderLeft();
  }

  buildTreeUi() {
    const body = this.right.body;
    body.innerHTML = "";
    this.treeStage = document.createElement("div");
    this.treeStage.className = "ga-tree-stage";
    this.treeSvg = svgNode("svg", { class: "ga-tree-svg", "aria-hidden": "true" });
    this.treeStage.appendChild(this.treeSvg);
    const foot = document.createElement("div");
    foot.className = "ga-tree-foot";
    this.treeNote = document.createElement("p");
    this.treeNote.className = "ga-note";
    this.treeExpr = document.createElement("div");
    this.treeExpr.className = "ga-tree-expr";
    foot.appendChild(this.treeNote);
    foot.appendChild(this.treeExpr);
    body.appendChild(this.treeStage);
    body.appendChild(foot);
    this.treeRo = new ResizeObserver(() => this.drawTree(false));
    this.treeRo.observe(this.treeStage);
  }

  resetTree(snap) {
    this.rng = rngFrom((Math.random() * 1e9) | 0);
    this.root = this.bin("+", this.leaf("x"), this.leaf("2"));
    this.hot = new Set();
    this.note = "start";
    this.drawTree(!!snap);
  }

  setChild(parent, oldNode, next) {
    if (!parent) this.root = next;
    else if (parent.left === oldNode) parent.left = next;
    else parent.right = next;
  }

  stepTree() {
    const leaves = [];
    const prunable = [];
    this.walk(this.root, null, (node, parent) => {
      if (node.kind === "leaf") leaves.push({ node, parent });
      if (node.kind === "bin" && (node.left.kind === "leaf" || node.right.kind === "leaf")) {
        prunable.push(node);
      }
    });
    const n = leaves.length;
    const kinds = ["change"];
    if (n < 14) kinds.push("add");
    if (prunable.length && n > 1) kinds.push("remove");
    let kind = this.pick(kinds);
    if (n >= 10 && kinds.includes("remove") && this.rng() < 0.55) kind = "remove";
    if (n <= 2 && kinds.includes("add") && this.rng() < 0.55) kind = "add";
    this.hot = new Set();
    if (kind === "add") {
      const pick = this.pick(leaves);
      const grown = this.leaf(this.pick(TREE_LEAVES));
      const op = this.pick(TREE_OPS);
      const neu = this.rng() < 0.5
        ? this.bin(op, pick.node, grown)
        : this.bin(op, grown, pick.node);
      this.setChild(pick.parent, pick.node, neu);
      this.hot.add(neu.id);
      this.hot.add(grown.id);
      this.note = "add a leaf";
    } else if (kind === "remove") {
      const parent = this.pick(prunable);
      const dropLeft = parent.left.kind === "leaf" && (parent.right.kind !== "leaf" || this.rng() < 0.5);
      const dropped = dropLeft ? parent.left : parent.right;
      const kept = dropLeft ? parent.right : parent.left;
      let owner = null;
      this.walk(this.root, null, (node, p) => {
        if (node === parent) owner = p;
      });
      this.setChild(owner, parent, kept);
      this.hot.add(kept.id);
      this.note = "drop a leaf (" + dropped.label + ")";
    } else {
      const pick = this.pick(leaves);
      const choices = TREE_LEAVES.filter((label) => label !== pick.node.label);
      pick.node.label = this.pick(choices);
      this.hot.add(pick.node.id);
      this.note = "rewrite a leaf";
    }
    this.drawTree(false);
  }

  layoutTree(node) {
    if (node.kind === "leaf") {
      node.w = 1;
      node.x = 0;
      node.y = 0;
      return;
    }
    this.layoutTree(node.left);
    this.layoutTree(node.right);
    const gap = 1.15;
    const shift = (n, dx) => {
      n.x += dx;
      if (n.kind === "bin") {
        shift(n.left, dx);
        shift(n.right, dx);
      }
    };
    const bump = (n, dy) => {
      n.y += dy;
      if (n.kind === "bin") {
        bump(n.left, dy);
        bump(n.right, dy);
      }
    };
    shift(node.right, node.left.w + gap);
    node.w = node.left.w + node.right.w + gap;
    node.x = (node.left.x + node.right.x) / 2;
    node.y = 0;
    bump(node.left, 1.28);
    bump(node.right, 1.28);
  }

  fitCam(snap) {
    const nodes = [];
    this.walk(this.root, null, (node) => nodes.push(node));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    });
    const rect = this.treeStage.getBoundingClientRect();
    const aspect = Math.max(0.72, (rect.width || 1) / Math.max(1, rect.height || 1));
    const pad = 0.82;
    let w = Math.max(2.4, maxX - minX + pad * 2);
    let h = Math.max(1.8, maxY - minY + pad * 2);
    let x = minX - pad;
    let y = minY - pad;
    if (w / h < aspect) {
      const nw = h * aspect;
      x -= (nw - w) / 2;
      w = nw;
    } else {
      const nh = w / aspect;
      y -= (nh - h) / 2;
      h = nh;
    }
    this.camTo = { x, y, w, h };
    if (snap || !this.cam) this.cam = { x, y, w, h };
    this.applyCam();
  }

  applyCam() {
    if (!this.cam || !this.treeSvg) return;
    this.treeSvg.setAttribute("viewBox", [this.cam.x, this.cam.y, this.cam.w, this.cam.h].join(" "));
  }

  exprLatex(node, parentPrec) {
    if (node.kind === "leaf") {
      if (node.label === "π") return "\\pi";
      return node.label;
    }
    const prec = node.op === "×" || node.op === "÷" ? 2 : 1;
    const op = { "+": "+", "−": "-", "×": "\\times", "÷": "\\div" }[node.op];
    const rightPrec = node.op === "−" || node.op === "÷" ? prec + 1 : prec;
    const inner = this.exprLatex(node.left, prec) + " " + op + " " + this.exprLatex(node.right, rightPrec);
    if (prec < (parentPrec || 0)) return "\\left(" + inner + "\\right)";
    return inner;
  }

  drawTree(snap) {
    if (!this.root || !this.treeSvg) return;
    this.layoutTree(this.root);
    const svg = this.treeSvg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const edges = svgNode("g", { class: "ga-tree-edges" });
    const nodes = svgNode("g", { class: "ga-tree-nodes" });
    this.walk(this.root, null, (node) => {
      if (node.kind !== "bin") return;
      [node.left, node.right].forEach((child) => {
        const midY = (node.y + child.y) / 2;
        edges.appendChild(svgNode("path", {
          d: "M" + node.x + " " + (node.y + 0.22) +
            " C " + node.x + " " + midY + ", " + child.x + " " + midY + ", " +
            child.x + " " + (child.y - 0.22)
        }));
      });
    });
    this.walk(this.root, null, (node) => {
      const g = svgNode("g", {
        class: "ga-tree-node" + (node.kind === "leaf" ? " leaf" : " op") + (this.hot.has(node.id) ? " hot" : ""),
        transform: "translate(" + node.x + " " + node.y + ")"
      });
      const w = node.kind === "leaf" ? 0.78 : 0.7;
      const h = 0.5;
      g.appendChild(svgNode("rect", {
        x: -w / 2,
        y: -h / 2,
        width: w,
        height: h,
        rx: 0.12,
        ry: 0.12
      }));
      const label = svgNode("text", { x: 0, y: 0.12, "text-anchor": "middle" });
      label.textContent = node.kind === "leaf" ? node.label : node.op;
      g.appendChild(label);
      nodes.appendChild(g);
    });
    svg.appendChild(edges);
    svg.appendChild(nodes);
    this.treeNote.textContent = this.note;
    const tex = this.exprLatex(this.root, 0);
    if (typeof katex !== "undefined" && katex.render) {
      katex.render(tex, this.treeExpr, { throwOnError: false, displayMode: false });
    } else this.treeExpr.textContent = tex;
    this.fitCam(snap);
  }

  renderLeft() {
    this.left.body.innerHTML = "";
    const sigma = document.createElement("div");
    sigma.className = "ga-sigma";
    sigma.textContent = "σ²  " + this.sigma2.toFixed(3) + "  →  small Gaussian step";
    this.left.body.appendChild(sigma);
    this.left.body.appendChild(gaBar("parent", 0.54, "#eee"));
    this.left.body.appendChild(gaBar("child", 0.54 + (this.leftMode - 1) * 0.12, "#fff"));
    if (this.sigmaInput) this.sigmaInput.value = this.sigma2;
  }

  enter() {
    this.drawTree(true);
  }

  leave() {}

  isIdle() {
    if (!this.cam || !this.camTo) return true;
    return Math.abs(this.cam.w - this.camTo.w) < 0.002 &&
      Math.abs(this.cam.h - this.camTo.h) < 0.002 &&
      Math.abs(this.cam.x - this.camTo.x) < 0.002 &&
      Math.abs(this.cam.y - this.camTo.y) < 0.002;
  }

  tick(dt) {
    if (!this.cam || !this.camTo) return;
    const k = 1 - Math.exp(-dt * 6.5);
    this.cam.x += (this.camTo.x - this.cam.x) * k;
    this.cam.y += (this.camTo.y - this.cam.y) * k;
    this.cam.w += (this.camTo.w - this.cam.w) * k;
    this.cam.h += (this.camTo.h - this.cam.h) * k;
    this.applyCam();
  }
}

class EsDemo {
  constructor(panel) {
    this.panel = panel;
    panel.innerHTML = "";
    panel.classList.add("es-panel");
    this.mu = 1;
    this.mult = 1;
    this.plus = false;
    this.sigma2 = 0.004;
    this.sigmaMin = 0.002;
    this.sigmaMax = 0.5;
    this.fifth = false;
    this.success = 0;
    this.uid = 1;
    this.rows = [];
    this.best = null;
    this.phase = "ready";
    this.t = 0;
    this.playing = false;
    this.alive = false;
    this.history = [];

    this.main = document.createElement("div");
    this.main.className = "es-main";
    this.map = document.createElement("div");
    this.map.className = "es-map";
    this.canvas = document.createElement("canvas");
    this.map.appendChild(this.canvas);
    this.cols = document.createElement("div");
    this.cols.className = "es-cols";
    this.colQ = this.makeCol("Q");
    this.colP = this.makeCol("P");
    this.cols.appendChild(this.colQ.wrap);
    this.cols.appendChild(this.colP.wrap);
    this.main.appendChild(this.map);
    this.main.appendChild(this.cols);
    panel.appendChild(this.main);

    this.bar = document.createElement("div");
    this.bar.className = "demo-bar";
    this.stepBtn = this.iconBtn("step", "Step", () => this.stepOnce());
    this.playBtn = this.iconBtn("play", "Play", () => this.toggle());
    this.bar.appendChild(this.stepBtn);
    this.bar.appendChild(this.playBtn);
    this.addSlider("μ", 1, 8, 1, this.mu, (v) => {
      this.mu = v;
      this.reset();
    }, (n) => String(n));
    this.addSlider("λ / μ", 1, 8, 1, this.mult, (v) => {
      this.mult = v;
      this.reset();
    }, (n) => String(n));
    this.repBtn = document.createElement("button");
    this.repBtn.type = "button";
    this.repBtn.addEventListener("click", () => {
      this.plus = !this.plus;
      this.syncTitle();
      this.reset();
    });
    this.bar.appendChild(this.repBtn);
    this.titleEl = document.createElement("strong");
    this.titleEl.className = "es-title";
    this.bar.appendChild(this.titleEl);
    this.sigmaSlide = this.addSlider("σ²", this.sigmaMin, this.sigmaMax, 0.001, this.sigma2, (v) => {
      this.sigma2 = v;
    }, (n) => Number(n).toFixed(3));
    this.sigmaSlide.wrap.classList.add("es-bar-end");
    this.fifthBtn = document.createElement("button");
    this.fifthBtn.type = "button";
    this.fifthBtn.textContent = "1/5 rule";
    this.fifthBtn.addEventListener("click", () => this.toggleFifth());
    this.bar.appendChild(this.fifthBtn);
    this.successSlide = this.addSlider("%fitter children", 0, 1, 0.01, 0, () => {}, (n) => Number(n).toFixed(2));
    this.successSlide.input.disabled = true;
    this.successSlide.wrap.hidden = true;
    panel.appendChild(this.bar);

    this.flow = document.createElement("div");
    this.flow.className = "es-flow";
    panel.appendChild(this.flow);

    this.mini = {
      canvas: this.canvas,
      ctx: this.canvas.getContext("2d"),
      cssW: 1,
      cssH: 1
    };
    this.plot = new ContourPlot(this.mini, designedJ, { levels: 12 });
    this.rng = rngFrom(3);
    this.view = { canvas: this.canvas };
    bindPlace2D(this.view, this.plot, (p) => this.seedAt(p, true));
    this.onResize = () => this.resize();
    new ResizeObserver(() => this.resize()).observe(this.map);
    this.reset();
  }

  makeCol(title) {
    const wrap = document.createElement("div");
    wrap.className = "es-col";
    const head = document.createElement("div");
    head.className = "es-col-head";
    head.textContent = title;
    const list = document.createElement("div");
    list.className = "es-pop";
    wrap.appendChild(head);
    wrap.appendChild(list);
    return { wrap, list };
  }

  get lambda() {
    return this.mu * this.mult;
  }

  iconBtn(icon, label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "demo-icon";
    btn.setAttribute("aria-label", label);
    btn.innerHTML = iconSvg(icon);
    btn.addEventListener("click", onClick);
    return btn;
  }

  addSlider(label, min, max, step, value, onInput, fmt) {
    const wrap = document.createElement("label");
    wrap.className = "demo-slider";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    const val = document.createElement("strong");
    val.textContent = fmt(value);
    input.addEventListener("input", () => {
      const n = Number(input.value);
      val.textContent = fmt(n);
      onInput(n);
    });
    wrap.appendChild(name);
    wrap.appendChild(input);
    wrap.appendChild(val);
    this.bar.appendChild(wrap);
    return { wrap, input, val, fmt };
  }

  setSlide(slide, value) {
    if (!slide) return;
    slide.input.value = value;
    slide.val.textContent = slide.fmt(value);
  }

  mutSigma() {
    return Math.sqrt(Math.max(this.sigmaMin, this.sigma2));
  }

  toggleFifth() {
    this.fifth = !this.fifth;
    this.fifthBtn.classList.toggle("on", this.fifth);
    this.successSlide.wrap.hidden = !this.fifth;
  }

  applyFifth(wins, n) {
    this.success = n ? wins / n : 0;
    this.setSlide(this.successSlide, this.success);
    if (!this.fifth || !n) return;
    const c2 = 0.82 * 0.82;
    if (this.success > 0.2) this.sigma2 = Math.min(this.sigmaMax, this.sigma2 / c2);
    else if (this.success < 0.2) this.sigma2 = Math.max(this.sigmaMin, this.sigma2 * c2);
    this.setSlide(this.sigmaSlide, this.sigma2);
  }

  strategyName() {
    if (this.mu === 1 && this.lambda === 1) return "Hill climb";
    if (this.mu === 1) return "Stochastic hill climb";
    return this.plus
      ? "(" + this.mu + " + " + this.lambda + ")"
      : "(" + this.mu + ", " + this.lambda + ")";
  }

  syncTitle() {
    this.titleEl.textContent = this.strategyName();
    this.repBtn.textContent = "with Replacement";
    this.repBtn.classList.toggle("on", this.plus);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = this.canvas.getBoundingClientRect();
    this.mini.cssW = Math.max(1, rect.width);
    this.mini.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.mini.cssW * dpr);
    this.canvas.height = Math.round(this.mini.cssH * dpr);
    this.mini.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.plot.layout();
    this.plot.bake();
    this.draw();
  }

  makePerson(x, y, role, parent) {
    return {
      id: this.uid++,
      x,
      y,
      role,
      parent,
      score: null,
      mark: "",
      place: "p",
      q: false,
      ghost: false
    };
  }

  seedAt(p, clustered) {
    this.rng = rngFrom((Math.random() * 1e9) | 0);
    const dist = new Neighbourhood("gaussian", 0.28);
    this.rows = [];
    for (let i = 0; i < this.lambda; i++) {
      const q = clustered
        ? this.plot.clamp({
            x: p.x + dist.sample(this.rng),
            y: p.y + dist.sample(this.rng)
          })
        : {
            x: this.plot.xMin + this.rng() * (this.plot.xMax - this.plot.xMin),
            y: this.plot.yMin + this.rng() * (this.plot.yMax - this.plot.yMin)
          };
      this.rows.push(this.makePerson(q.x, q.y, "adult", null));
    }
    this.phase = "ready";
    this.t = 0;
    this.history = [];
    this.best = null;
    this.syncTitle();
    this.renderList();
    this.renderFlow();
    this.draw();
  }

  reset() {
    this.rng = rngFrom((Math.random() * 1e9) | 0);
    const p = {
      x: this.plot.xMin + this.rng() * (this.plot.xMax - this.plot.xMin),
      y: this.plot.yMin + this.rng() * (this.plot.yMax - this.plot.yMin)
    };
    this.seedAt(p, false);
    this.playing = false;
    this.setPlay(false);
  }

  setPlay(on) {
    this.playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    this.playBtn.innerHTML = iconSvg(on ? "pause" : "play");
  }

  toggle() {
    this.playing = !this.playing;
    this.setPlay(this.playing);
  }

  enter() {
    this.alive = true;
    this.resize();
    this.reset();
  }

  leave() {
    this.alive = false;
    this.playing = false;
    this.setPlay(false);
  }

  living() {
    return this.rows.filter((r) => !r.ghost && r.place === "p");
  }

  stepOnce() {
    this.playing = false;
    this.setPlay(false);
    this.advance();
  }

  advance() {
    const order = this.plus
      ? ["assess", "rank", "qset", "breed"]
      : ["assess", "rank", "qset", "pempty", "breed"];
    if (this.phase === "ready" || this.phase === "wait") {
      this.phase = "assess";
      this.t = 0;
      this.onPhase();
      return;
    }
    if (this.phase === "breed") {
      this.finishJoin();
      return;
    }
    const i = order.indexOf(this.phase);
    this.phase = order[i + 1];
    this.t = 0;
    this.onPhase();
  }

  onPhase() {
    if (!this.history.includes(this.phase)) this.history.push(this.phase);
    if (this.phase === "assess") {
      this.living().forEach((r) => {
        r.role = "adult";
        r.mark = "";
        r.q = false;
        r.place = "p";
        r.parent = null;
        r.score = designedJ(r.x, r.y);
        if (!this.best || r.score > this.best.score) {
          this.best = { id: r.id, x: r.x, y: r.y, score: r.score };
        }
      });
    } else if (this.phase === "rank") {
      const live = this.living().slice().sort((a, b) => b.score - a.score);
      const rest = this.rows.filter((r) => live.indexOf(r) < 0);
      this.rows = live.concat(rest);
    } else if (this.phase === "qset") {
      this.living().forEach((r, i) => {
        r.q = i < this.mu;
        r.mark = r.q ? "keep" : "";
        if (r.q && !this.plus) r.place = "q";
      });
    } else if (this.phase === "pempty") {
      this.rows.forEach((r) => {
        if (!r.ghost && r.place === "p" && !r.q) {
          r.mark = "out";
          r.ghost = true;
        }
      });
    } else if (this.phase === "breed") {
      const dist = new Neighbourhood("gaussian", this.mutSigma());
      const next = [];
      let wins = 0;
      let born = 0;
      this.rows.forEach((r) => {
        next.push(r);
        if (r.ghost || !r.q) return;
        for (let i = 0; i < this.mult; i++) {
          const p = this.plot.clamp({
            x: r.x + dist.sample(this.rng),
            y: r.y + dist.sample(this.rng)
          });
          const child = this.makePerson(p.x, p.y, "child", r.id);
          child.place = "p";
          child.score = designedJ(child.x, child.y);
          born += 1;
          if (r.score != null && child.score > r.score) wins += 1;
          next.push(child);
        }
      });
      this.rows = next;
      this.applyFifth(wins, born);
    }
    this.renderList();
    this.renderFlow();
    this.draw();
  }

  finishJoin() {
    this.rows.forEach((r) => {
      if (r.ghost) return;
      if (this.plus) {
        if (r.place === "p" || r.q) {
          r.q = false;
          r.mark = "";
          r.role = "adult";
          r.place = "p";
        }
      } else if (r.q || r.place === "q") {
        r.ghost = true;
        r.q = false;
        r.mark = "";
      } else if (r.role === "child") {
        r.q = false;
        r.mark = "";
        r.role = "adult";
        r.place = "p";
      }
    });
    this.phase = "wait";
    this.history = [];
    this.t = 0;
    this.renderList();
    this.renderFlow();
    this.draw();
  }

  isIdle() {
    return !this.alive || !this.playing;
  }

  tick(dt) {
    if (!this.alive) return;
    if (this.playing) {
      this.t += dt;
      if (this.phase === "ready" || this.phase === "wait") this.advance();
      else if (this.t > 0.85) this.advance();
    }
  }

  renderFlow() {
    const addNode = (host, id, label, math) => {
      const el = document.createElement("span");
      el.className = "es-node" + (math ? " math" : "");
      el.textContent = label;
      if (this.phase === id) el.classList.add("now");
      else if (this.history.includes(id)) el.classList.add("done");
      host.appendChild(el);
      return el;
    };
    const addArrow = (host) => {
      const arrow = document.createElement("span");
      arrow.className = "es-arrow";
      arrow.textContent = "→";
      host.appendChild(arrow);
    };
    this.flow.innerHTML = "";
    addNode(this.flow, "assess", "Assess", false);
    addArrow(this.flow);
    const box = document.createElement("div");
    box.className = "es-select";
    const inner = document.createElement("div");
    inner.className = "es-select-row";
    addNode(inner, "rank", "Rank", false);
    addArrow(inner);
    addNode(inner, "qset", "Q ← {best μ}", true);
    if (!this.plus) {
      addArrow(inner);
      addNode(inner, "pempty", "P ← { }", true);
    }
    const lab = document.createElement("span");
    lab.className = "es-select-label";
    lab.textContent = "Select";
    box.appendChild(inner);
    box.appendChild(lab);
    const selectNow = this.phase === "rank" || this.phase === "qset" || this.phase === "pempty";
    const selectDone = ["rank", "qset", "pempty"].some((id) => this.history.includes(id));
    if (selectNow) box.classList.add("now");
    else if (selectDone) box.classList.add("done");
    this.flow.appendChild(box);
    addArrow(this.flow);
    addNode(this.flow, "breed", "Mutate", false);
  }

  makeRow(r) {
    const row = document.createElement("div");
    row.className = "es-row";
    if (r.role === "child" && !r.ghost) row.classList.add("child");
    if (this.phase === "qset" && r.q && !r.ghost) row.classList.add("keeper");
    if (r.ghost) row.classList.add("ghost");
    const name = document.createElement("span");
    name.className = "es-name";
    name.textContent = String(r.id);
    const score = document.createElement("span");
    score.className = "es-score";
    score.textContent = r.score == null ? "—" : r.score.toFixed(2);
    row.appendChild(name);
    row.appendChild(score);
    return row;
  }

  renderList() {
    if (!this.colQ) return;
    this.colQ.list.innerHTML = "";
    this.colP.list.innerHTML = "";
    this.rows.forEach((r) => {
      if (r.q || r.place === "q") this.colQ.list.appendChild(this.makeRow(r));
      if (r.place === "p") this.colP.list.appendChild(this.makeRow(r));
    });
  }

  draw() {
    const { plot } = this;
    if (!plot.box) return;
    plot.clear();
    plot.drawField();
    const ctx = plot.view.ctx;
    const paint = (r) => {
      const s = plot.toScreen(r.x, r.y);
      let fill = "#f2f2f2";
      let rad = 6.2;
      if (r.role === "child" && !r.ghost) {
        fill = "#8ec89a";
        rad = 5.4;
      }
      if (this.phase === "qset" && r.q && !r.ghost) fill = "#f3e08a";
      if (r.ghost) {
        fill = "rgba(180,180,180,0.28)";
        rad = 4.6;
      }
      drawDot(ctx, s.x, s.y, rad, fill);
    };
    this.rows.filter((r) => r.ghost).forEach(paint);
    this.rows.filter((r) => !r.ghost).forEach(paint);
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
  else add("sa", (el) => new SADemo(el));
  add("gwo", (el) => new GwoDemo(el));
  add("geist", (el) => new GeistDemo(el));
  add("es", (el) => new EsDemo(el));
  add("ga-es-compare", (el) => new PipelineCompareDemo(el));
  const sr = panel("selection-roulette");
  const stn = panel("selection-tournament");
  if (sr && stn) host.attach(slideOf(sr), new SelectionDemo(sr, stn));
  const cd = panel("crossover-discrete");
  const cl = panel("crossover-linear");
  if (cd && cl) host.attach(slideOf(cd), new CrossoverDemo(cd, cl));
  const mg = panel("mutation-gaussian");
  const mt = panel("mutation-tree");
  if (mg && mt) host.attach(slideOf(mg), new MutationDemo(mg, mt));
}
