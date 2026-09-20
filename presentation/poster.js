document.addEventListener("DOMContentLoaded", () => {
  const fieldConfig = Object.assign({}, CONFIG.field, {
    cellPx: CONFIG.field.cellPx / 4
  });
  const field = new TerrainField(document.getElementById("field"), fieldConfig);
  const seekers = new PeakSeekers(field, CONFIG.agents);
  field.afterDraw = (seconds, dt) => {
    seekers.step(seconds, dt);
    seekers.draw(field.ctx, seconds);
  };
  field.start();
});
