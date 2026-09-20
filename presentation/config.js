/** Tunables for the deck. Edit this file; everything else reads from it. */
const CONFIG = {
  field: {
    background: 31,
    bandDepth: 20,
    lineMin: 10,
    lineRange: 40,
    lineWidth: 1.1,
    levels: 14,
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

    // Landscape drift (noise-space units per second). Contours slide as tiles.
    panSpeed: 0.01,
    // Cap the field loop. 0 = uncapped (display refresh).
    maxFps: 30,

    cellPx: 16,
    minOpenPoints: 4,
    minClosedPoints: 8
  },

  demo: {
    // Height-mapped colours for plots, low → high. Mix red, green, and blue.
    palette: ["#2a62c8", "#2f9d62", "#d43c3c"],
    // Colour-field cell size in CSS pixels. Smaller = sharper bands.
    cellPx: 7
  },

  panel: {
    // Text / demo card fill. "transparent" or any CSS colour.
    background: "rgba(10, 10, 10, 0.00)",
    // Backdrop blur on content and demo cards, in px.
    blur: 4
  },

  pager: {
    // How far chips sit apart, in px. Used for the stacked peek and the open fan.
    spread: 8
  },

  transition: {
    duration: 0.4,
    // Higher = slower start / softer landing. 1 is linear on that half.
    easeIn: 2.6,
    easeOut: 2.2,
    // Extra screens the landscape is shoved when advancing.
    panPush:0.8
  },

  agents: {
    count: 2,
    t1: 4,
    t2: 6,
    repeat: true,
    // Extra world, as a fraction of the visible span, on each side.
    searchMargin: 0.5,
    speed: 0.1,
    probe: 0.22,
    inertia: 0.9,
    climbOctaves: 2,
    radius: 3.2,
    color: "#707070"
  }
};
