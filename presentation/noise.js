class Perlin {
  constructor(seed) {
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    let s = seed || 16807;
    for (let i = 255; i > 0; i--) {
      s = (s * 48271) % 2147483647;
      const j = s % (i + 1);
      const tmp = src[i];
      src[i] = src[j];
      src[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = src[i & 255];
  }

  noise2(x, y) {
    const perm = this.perm;
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const lerp = (a, b, t) => a + t * (b - a);
    const grad = (hash, gx, gy) => {
      const h = hash & 3;
      const s = h < 2 ? gx : gy;
      const t = h < 2 ? gy : gx;
      return ((h & 1) ? -s : s) + ((h & 2) ? -t : t);
    };
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v
    );
  }

  fbm(x, y, octaves, persistence) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= persistence;
      freq *= 2;
    }
    return sum / (norm || 1);
  }
}
