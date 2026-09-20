importScripts("noise.js", "contours.js", "landscape.js");

const state = {
  generation: 0,
  config: null,
  layout: null,
  noise: null,
  z: null,
  shadeLut: []
};

function bake(index) {
  const { config: c, layout: L, noise, z, shadeLut } = state;
  const canvas = new OffscreenCanvas(L.pixelW, L.pixelH);
  const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
  bakeLandscapeTile(ctx, {
    config: c,
    cols: L.cols,
    rows: L.rows,
    nx: L.nx,
    cssW: L.cssW,
    cssH: L.cssH,
    tileCssW: L.tileCssW,
    pixelW: L.pixelW,
    pixelH: L.pixelH,
    overlapPx: L.overlapPx,
    index,
    noise,
    z,
    shadeLut
  });
  return canvas.transferToImageBitmap();
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "setup") {
    state.generation = msg.generation;
    state.config = msg.config;
    state.layout = msg.layout;
    state.noise = new Perlin(msg.config.seed);
    state.z = new Float32Array(msg.layout.nx * (msg.layout.rows + 1));
    state.shadeLut = [];
    return;
  }
  if (msg.type === "bake") {
    if (msg.generation !== state.generation || !state.layout) return;
    try {
      const bitmap = bake(msg.index);
      postMessage({ type: "tile", index: msg.index, generation: msg.generation, bitmap }, [bitmap]);
    } catch (err) {
      postMessage({ type: "error", index: msg.index, generation: msg.generation, message: String(err) });
    }
  }
};
