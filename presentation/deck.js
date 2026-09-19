function easeInOut(t, easeIn, easeOut) {
  t = Math.max(0, Math.min(1, t));
  const a = Math.max(0.01, easeIn);
  const b = Math.max(0.01, easeOut);
  if (t < 0.5) return Math.pow(2 * t, a) / 2;
  return 1 - Math.pow(2 * (1 - t), b) / 2;
}

class Deck {
  constructor(slideSelector, pagerSelector, config, field) {
    this.slides = [...document.querySelectorAll(slideSelector)];
    this.pager = document.querySelector(pagerSelector);
    this.config = config;
    this.field = field;
    this.index = 0;
    this.motion = null;
    this.pos = this.slides.map((_, i) => (i === 0 ? 0 : 100));
    this.bias0Index = 0;
    this.buildPager();
    this.bind();
    this.parkAll();
    this.place(this.slides[0], 0);
    this.updatePager();
  }

  bind() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        this.go(this.index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        this.go(this.index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        this.go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        this.go(this.slides.length - 1);
      }
    });
  }

  parkAll() {
    this.slides.forEach((slide) => this.place(slide, 100));
  }

  place(slide, pct) {
    slide.style.transform = "translate3d(" + pct + "%,0,0)";
  }

  buildPager() {
    if (!this.pager) return;
    this.pager.innerHTML = "";
    const ms = ((this.config.duration || 0.7) * 1000) + "ms";
    this.dots = this.slides.map(() => {
      const dot = document.createElement("span");
      dot.style.transitionDuration = ms;
      this.pager.appendChild(dot);
      return dot;
    });
  }

  updatePager() {
    if (!this.dots) return;
    this.dots.forEach((dot, k) => dot.classList.toggle("current", k === this.index));
  }

  targetsFor(index) {
    return this.slides.map((_, i) => {
      if (i === index) return 0;
      return i < index ? -100 : 100;
    });
  }

  go(n) {
    n = Math.max(0, Math.min(n, this.slides.length - 1));
    if (n === this.index) return;
    const vis = this.field.config.xMax - this.field.config.xMin;
    const startPos = this.pos.slice();
    const targetPos = this.targetsFor(n);
    for (let i = 0; i < startPos.length; i++) {
      const a = startPos[i];
      const b = targetPos[i];
      if (Math.abs(a) > 90 && Math.abs(b) > 90 && Math.sign(a) !== Math.sign(b)) {
        startPos[i] = b;
        this.pos[i] = b;
        this.place(this.slides[i], b);
      }
    }
    this.motion = {
      startPos,
      targetPos,
      t0: performance.now(),
      bias0: this.field.panBiasWorld,
      bias1: this.bias0Index + n * this.config.panPush * vis
    };
    this.index = n;
    this.field.hintPanBias(this.motion.bias1);
    this.updatePager();
  }

  tick() {
    if (!this.motion) return;
    const { duration, easeIn, easeOut } = this.config;
    const t = (performance.now() - this.motion.t0) / (duration * 1000);
    const u = easeInOut(t, easeIn, easeOut);
    const { startPos, targetPos, bias0, bias1 } = this.motion;
    for (let i = 0; i < this.slides.length; i++) {
      const p = startPos[i] + (targetPos[i] - startPos[i]) * u;
      this.pos[i] = p;
      this.place(this.slides[i], p);
    }
    this.field.setPanBias(bias0 + (bias1 - bias0) * u);
    if (t >= 1) {
      this.pos = targetPos.slice();
      for (let i = 0; i < this.slides.length; i++) this.place(this.slides[i], this.pos[i]);
      this.field.setPanBias(bias1);
      this.motion = null;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const field = new TerrainField(document.getElementById("field"), CONFIG.field);
  const deck = new Deck(".slide", "#pager", CONFIG.transition, field);
  const seekers = new PeakSeekers(field, CONFIG.agents);
  const calcCanvas = document.getElementById("calc-graph");
  const calcReadout = document.getElementById("calc-readout");
  if (calcCanvas && calcReadout) new CubicProbe(calcCanvas, calcReadout);
  field.beforeDraw = () => deck.tick();
  field.afterDraw = (seconds, dt) => {
    seekers.step(seconds, dt);
    seekers.draw(field.ctx, seconds);
  };
  field.start();
});
