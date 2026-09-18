class PeakSeekers {
  constructor(field, config) {
    this.field = field;
    this.config = config;
    this.agents = [];
    this.spawned = 0;
    this.cycle = 0;
  }

  searchBounds() {
    const w = this.field.config;
    const mx = this.config.searchMargin * (w.xMax - w.xMin);
    const my = this.config.searchMargin * (w.yMax - w.yMin);
    return {
      x0: w.xMin - mx,
      x1: w.xMax + mx,
      y0: w.yMin - my,
      y1: w.yMax + my
    };
  }

  spawnTimes(cycle) {
    const { count, t1, t2 } = this.config;
    const span = Math.max(0, t2 - t1);
    const origin = t1 + cycle * (span || t2 || 1);
    if (count <= 0) return [];
    if (count === 1) return [origin];
    return Array.from({ length: count }, (_, i) => origin + span * (i / (count - 1)));
  }

  spawnDue(seconds) {
    const { count, repeat } = this.config;
    if (count <= 0) return;
    const times = this.spawnTimes(this.cycle);
    while (this.spawned < count && seconds >= times[this.spawned]) {
      this.agents.push(this.makeAgent(seconds));
      this.spawned += 1;
    }
    if (repeat && this.spawned >= count && seconds >= times[count - 1]) {
      this.spawned = 0;
      this.cycle += 1;
    }
  }

  makeAgent(seconds) {
    const w = this.field.config;
    const x = w.xMin + Math.random() * (w.xMax - w.xMin);
    const y = w.yMin + Math.random() * (w.yMax - w.yMin);
    const p = this.field.toLandscape(x, y, seconds);
    return { px: p.px, py: p.py, vx: 0, vy: 0 };
  }

  landscapeBounds(seconds) {
    const b = this.searchBounds();
    const a = this.field.toLandscape(b.x0, b.y0, seconds);
    const c = this.field.toLandscape(b.x1, b.y1, seconds);
    return {
      x0: Math.min(a.px, c.px),
      x1: Math.max(a.px, c.px),
      y0: Math.min(a.py, c.py),
      y1: Math.max(a.py, c.py)
    };
  }

  step(seconds, dt) {
    this.spawnDue(seconds);
    if (!this.agents.length) return;
    const box = this.landscapeBounds(seconds);
    const clamp = (px, py) => ({
      px: Math.min(box.x1, Math.max(box.x0, px)),
      py: Math.min(box.y1, Math.max(box.y0, py))
    });
    const scale = this.field.config.worldScale;
    const probe = this.config.probe * scale;
    const maxSpeed = this.config.speed * scale;
    const follow = 1 - Math.pow(this.config.inertia, Math.max(dt, 1 / 120) * 60);
    const oct = this.config.climbOctaves;
    for (const agent of this.agents) {
      const h = (px, py) => this.field.heightAtLandscape(px, py, oct);
      const gx = (h(agent.px + probe, agent.py) - h(agent.px - probe, agent.py)) / (2 * probe);
      const gy = (h(agent.px, agent.py + probe) - h(agent.px, agent.py - probe)) / (2 * probe);
      const mag = Math.hypot(gx, gy);
      let tx = 0, ty = 0;
      if (mag > 1e-4) {
        tx = (gx / mag) * maxSpeed;
        ty = (gy / mag) * maxSpeed;
      }
      agent.vx += (tx - agent.vx) * follow;
      agent.vy += (ty - agent.vy) * follow;
      const held = clamp(agent.px + agent.vx * dt, agent.py + agent.vy * dt);
      agent.px = held.px;
      agent.py = held.py;
    }
  }

  toScreen(px, py, seconds) {
    const w = this.field.config;
    const { x, y } = this.field.toWorld(px, py, seconds);
    return [
      ((x - w.xMin) / (w.xMax - w.xMin)) * this.field.cssW,
      ((y - w.yMin) / (w.yMax - w.yMin)) * this.field.cssH
    ];
  }

  draw(ctx, seconds) {
    const r = this.config.radius;
    ctx.fillStyle = this.config.color;
    for (const agent of this.agents) {
      const [sx, sy] = this.toScreen(agent.px, agent.py, seconds);
      if (sx < -r || sy < -r || sx > this.field.cssW + r || sy > this.field.cssH + r) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
