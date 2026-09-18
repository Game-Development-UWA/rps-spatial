class Deck {
  constructor(slideSelector, counterSelector) {
    this.slides = [...document.querySelectorAll(slideSelector)];
    this.counter = document.querySelector(counterSelector);
    this.index = 0;
    this.bind();
    this.show(0);
  }

  bind() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        this.show(this.index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        this.show(this.index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        this.show(0);
      } else if (e.key === "End") {
        e.preventDefault();
        this.show(this.slides.length - 1);
      }
    });
  }

  show(n) {
    this.index = Math.max(0, Math.min(n, this.slides.length - 1));
    this.slides.forEach((slide, k) => slide.classList.toggle("active", k === this.index));
    if (this.counter) this.counter.textContent = (this.index + 1) + " / " + this.slides.length;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new Deck(".slide", "#counter");
  const field = new TerrainField(document.getElementById("field"), CONFIG.field);
  const seekers = new PeakSeekers(field, CONFIG.agents);
  field.afterDraw = (seconds, dt) => {
    seekers.step(seconds, dt);
    seekers.draw(field.ctx, seconds);
  };
  field.start();
});
