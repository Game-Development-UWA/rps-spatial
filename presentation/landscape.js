function landscapeHeight(noise, c, px, py, octaves) {
  const oct = octaves == null ? c.octaves : octaves;
  const wx = px + c.warp * noise.fbm(px + 3.1, py, Math.min(3, oct), c.persistence);
  const wy = py + c.warp * noise.fbm(px + 17.7, py + 8.2, Math.min(3, oct), c.persistence);
  return noise.fbm(wx, wy, oct, c.persistence);
}

function landscapeTileWorld(c, vis, overlapPx, cssW, index) {
  const overlapWorld = (overlapPx / cssW) * vis;
  return {
    x0: c.xMin + index * vis - overlapWorld,
    x1: c.xMin + (index + 1) * vis + overlapWorld,
    y0: c.yMin,
    y1: c.yMax
  };
}

function sampleLandscapeTile(z, cols, rows, nx, range, noise, c) {
  for (let j = 0; j <= rows; j++) {
    const y = range.y0 + (range.y1 - range.y0) * (j / rows);
    for (let i = 0; i <= cols; i++) {
      const x = range.x0 + (range.x1 - range.x0) * (i / cols);
      z[j * nx + i] = landscapeHeight(noise, c, x * c.worldScale, y * c.worldScale);
    }
  }
}

function landscapeShade(c, lut, t) {
  if (!lut.length) {
    for (let i = 0; i <= 32; i++) {
      const u = i / 32;
      const g = Math.round(c.background + c.lineMin + u * c.lineRange);
      lut.push("rgb(" + g + "," + g + "," + g + ")");
    }
  }
  return lut[Math.round(Math.max(0, Math.min(1, t)) * 32)];
}

function landscapePolyline(ctx, pts, closed) {
  const n = pts.length;
  if (n < 2) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < n; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  if (closed) ctx.closePath();
}

function bakeLandscapeTile(ctx, spec) {
  const { config: c, cols, rows, nx, cssH, tileCssW: w, pixelW, pixelH, index } = spec;
  const vis = c.xMax - c.xMin;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgb(" + c.background + "," + c.background + "," + c.background + ")";
  ctx.fillRect(0, 0, pixelW, pixelH);
  const dpr = pixelW / w;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const range = landscapeTileWorld(c, vis, spec.overlapPx, spec.cssW, index);
  sampleLandscapeTile(spec.z, cols, rows, nx, range, spec.noise, c);

  const cellW = w / cols;
  const cellH = cssH / rows;
  const depth = c.bandDepth || 0;
  if (depth > 0) {
    const low = Math.max(0, c.background - depth);
    ctx.fillStyle = "rgb(" + low + "," + low + "," + low + ")";
    ctx.fillRect(0, 0, w, cssH);
    for (let L = 0; L < c.levels; L++) {
      const u = L / (c.levels - 1);
      const level = c.zMin + (c.zMax - c.zMin) * (0.08 + 0.84 * u);
      const g = Math.max(0, c.background - Math.round((1 - u) * depth));
      ctx.beginPath();
      Contours.addAbove(ctx, spec.z, cols, rows, nx, level, cellW, cellH, 0, 0);
      ctx.fillStyle = "rgb(" + g + "," + g + "," + g + ")";
      ctx.fill();
    }
  }

  ctx.lineWidth = c.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const lut = spec.shadeLut;
  for (let L = 0; L < c.levels; L++) {
    const u = L / (c.levels - 1);
    const level = c.zMin + (c.zMax - c.zMin) * (0.08 + 0.84 * u);
    const { open, closed } = Contours.paths(spec.z, cols, rows, nx, level, cellW, cellH);
    ctx.strokeStyle = landscapeShade(c, lut, u);
    ctx.beginPath();
    for (const pts of open) {
      if (pts.length >= c.minOpenPoints) landscapePolyline(ctx, pts, false);
    }
    for (const pts of closed) {
      if (pts.length >= c.minClosedPoints) landscapePolyline(ctx, pts, true);
    }
    ctx.stroke();
  }
}
