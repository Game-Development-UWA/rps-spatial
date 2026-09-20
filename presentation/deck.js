function easeInOut(t, easeIn, easeOut) {
  t = Math.max(0, Math.min(1, t));
  const a = Math.max(0.01, easeIn);
  const b = Math.max(0.01, easeOut);
  if (t < 0.5) return Math.pow(2 * t, a) / 2;
  return 1 - Math.pow(2 * (1 - t), b) / 2;
}

class Deck {
  constructor(stackSelector, pagerSelector, config, field) {
    this.columns = [...document.querySelectorAll(stackSelector)].map((stack) =>
      [...stack.querySelectorAll(".slide")]
    );
    this.slides = this.columns.flat();
    this.pager = document.querySelector(pagerSelector);
    this.config = config.transition || config;
    this.pagerSpread = config.pager && config.pager.spread != null
      ? config.pager.spread
      : 8;
    this.field = field;
    this.col = 0;
    this.row = 0;
    this.motion = null;
    this.pos = this.slides.map(() => ({ x: 100, y: 0 }));
    this.bias0Index = 0;
    this.buildPager();
    this.bind();
    this.parkAll();
    this.place(this.slides[0], 0, 0);
    this.pos[0] = { x: 0, y: 0 };
    this.updatePager();
  }

  bind() {
    document.addEventListener("keydown", (e) => {
      if (e.key === " " && e.target && e.target.closest && e.target.closest("button, input, textarea")) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.goRow(this.row + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.goRow(this.row - 1);
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        this.goCol(this.col + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.goCol(this.col - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        this.go(0, 0);
      } else if (e.key === "End") {
        e.preventDefault();
        this.go(this.columns.length - 1, 0);
      }
    });
  }

  parkAll() {
    this.slides.forEach((slide) => this.place(slide, 100, 0));
  }

  place(slide, x, y) {
    slide.style.transform = "translate3d(" + x + "%," + y + "%,0)";
  }

  buildPager() {
    if (!this.pager) return;
    this.pager.innerHTML = "";
    const ms = ((this.config.duration || 0.7) * 1000) + "ms";
    this.dots = this.columns.map((slides, c) => {
      if (c > 0) {
        const rule = document.createElement("span");
        rule.className = "pager-rule";
        rule.setAttribute("aria-hidden", "true");
        rule.textContent = "|";
        this.pager.appendChild(rule);
      }
      const group = document.createElement("span");
      group.className = "pager-group";
      this.pager.appendChild(group);
      return slides.map(() => {
        const dot = document.createElement("span");
        dot.className = "pager-dot";
        dot.style.transitionDuration = ms;
        group.appendChild(dot);
        return dot;
      });
    });
  }

  spaceDots(dots, open) {
    const size = 10;
    const spread = this.pagerSpread;
    const stacked = Math.min(0, spread - size);
    const gap = open ? spread : stacked;
    dots.forEach((dot, r) => {
      dot.style.marginLeft = r === 0 ? "0px" : gap + "px";
    });
  }

  updatePager() {
    if (this.dots) {
      this.dots.forEach((group, c) => {
        const host = group[0] && group[0].parentElement;
        if (host) host.classList.toggle("active", c === this.col);
        this.spaceDots(group, c === this.col);
        group.forEach((dot, r) => dot.classList.toggle("current", c === this.col && r === this.row));
      });
    }
    document.body.classList.toggle(
      "has-down",
      this.row < this.columns[this.col].length - 1
    );
  }

  targetsFor(col, row) {
    const targets = [];
    this.columns.forEach((slides, c) => {
      slides.forEach((_, r) => {
        if (c < col) targets.push({ x: -100, y: 0 });
        else if (c > col) targets.push({ x: 100, y: 0 });
        else if (r === row) targets.push({ x: 0, y: 0 });
        else targets.push({ x: 0, y: r < row ? -100 : 100 });
      });
    });
    return targets;
  }

  goCol(n) {
    n = Math.max(0, Math.min(n, this.columns.length - 1));
    this.go(n, 0);
  }

  goRow(n) {
    const last = this.columns[this.col].length - 1;
    n = Math.max(0, Math.min(n, last));
    this.go(this.col, n);
  }

  go(col, row) {
    if (col === this.col && row === this.row) return;
    const vis = this.field.config.xMax - this.field.config.xMin;
    const startPos = this.pos.map((p) => ({ x: p.x, y: p.y }));
    const targetPos = this.targetsFor(col, row);
    for (let i = 0; i < startPos.length; i++) {
      const a = startPos[i];
      const b = targetPos[i];
      const axOff = Math.abs(a.x) > 90;
      const bxOff = Math.abs(b.x) > 90;
      const ayOff = Math.abs(a.y) > 90;
      const byOff = Math.abs(b.y) > 90;
      const hiddenHop = (axOff || ayOff) && (bxOff || byOff) && (a.x !== b.x || a.y !== b.y);
      if (hiddenHop) {
        startPos[i] = { x: b.x, y: b.y };
        this.pos[i] = { x: b.x, y: b.y };
        this.place(this.slides[i], b.x, b.y);
      }
    }
    this.motion = {
      startPos,
      targetPos,
      t0: performance.now(),
      bias0: this.field.panBiasWorld,
      bias1: this.bias0Index + col * this.config.panPush * vis
    };
    this.col = col;
    this.row = row;
    this.field.hintPanBias(this.motion.bias1);
    this.updatePager();
    if (this.onNavigate) this.onNavigate(this.columns[col][row]);
  }

  tick() {
    if (!this.motion) return;
    const { duration, easeIn, easeOut } = this.config;
    const t = (performance.now() - this.motion.t0) / (duration * 1000);
    const u = easeInOut(t, easeIn, easeOut);
    const { startPos, targetPos, bias0, bias1 } = this.motion;
    for (let i = 0; i < this.slides.length; i++) {
      const p = {
        x: startPos[i].x + (targetPos[i].x - startPos[i].x) * u,
        y: startPos[i].y + (targetPos[i].y - startPos[i].y) * u
      };
      this.pos[i] = p;
      this.place(this.slides[i], p.x, p.y);
    }
    this.field.setPanBias(bias0 + (bias1 - bias0) * u);
    if (t >= 1) {
      this.pos = targetPos.map((p) => ({ x: p.x, y: p.y }));
      for (let i = 0; i < this.slides.length; i++) this.place(this.slides[i], this.pos[i].x, this.pos[i].y);
      this.field.setPanBias(bias1);
      this.motion = null;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof renderMathInElement === "function") {
    renderMathInElement(document.body, {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false
    });
  }
  const panelBlur = CONFIG.panel && CONFIG.panel.blur != null ? CONFIG.panel.blur : 18;
  document.documentElement.style.setProperty("--panel-blur", panelBlur + "px");
  const field = new TerrainField(document.getElementById("field"), CONFIG.field);
  const deck = new Deck(".stack", "#pager", CONFIG, field);
  const seekers = new PeakSeekers(field, CONFIG.agents);
  const calcPanel = document.getElementById("calc-panel");
  const calcReadout = document.getElementById("calc-readout");
  if (calcPanel && calcReadout) new CubicProbe(calcPanel, calcReadout);
  const demos = new DemoHost();
  mountDemos(demos);
  deck.onNavigate = (slide) => demos.show(slide);
  demos.show(deck.columns[deck.col][deck.row]);
  field.beforeDraw = () => deck.tick();
  field.afterDraw = (seconds, dt) => {
    seekers.step(seconds, dt);
    seekers.draw(field.ctx, seconds);
    demos.tick(dt);
  };
  field.start();
});
