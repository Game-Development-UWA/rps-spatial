/** Tunables for the deck. Edit this file; everything else reads from it. */
const CONFIG = {
  field: {
    background: 31,
    bandDepth: 15,
    lineMin: 3,
    lineRange: 10,
    lineWidth: 1.15,
    levels: 40,
    zMin: -0.55,
    zMax: 0.58,

    // World window sampled onto the canvas.
    xMin: -2.8,
    xMax: 2.8,
    yMin: -2,
    yMax: 2,
    worldScale: 0.34,
    warp: 0.32,
    octaves: 3,
    persistence: 0.40,
    seed: 42,

    // Landscape drift (noise-space units per second). Contours slide as a bitmap.
    panSpeed: 0.014,
    // Extra screens baked on the left/right so pan does not rebuild lines.
    panPad: 2,

    cellPx: 10,
    minOpenPoints: 4,
    minClosedPoints: 8
  },

  agents: {
    count: 2,
    t1: 4,
    t2: 10,
    repeat: true,
    // Extra world, as a fraction of the visible span, on each side.
    searchMargin: 0.5,
    speed: 0.16,
    probe: 0.22,
    inertia: 0.9,
    climbOctaves: 2,
    radius: 3.2,
    color: "#454545"
  }
};
