// One Euro Filter (Casiez, Roussel, Vogel 2012).
// Smooths noisy input while keeping lag low during fast movement — heavy
// smoothing when the signal is nearly still (kills jitter), almost no
// smoothing when it's moving fast (kills lag). Exactly the profile we want
// for a blade tip: steady while aiming, snappy while swiping.

class LowPassFilter {
  constructor(alpha) {
    this.alpha = alpha;
    this.s = 0;
    this.initialized = false;
  }

  setAlpha(alpha) {
    this.alpha = alpha;
  }

  filter(value) {
    if (!this.initialized) {
      this.s = value;
      this.initialized = true;
    } else {
      this.s = this.alpha * value + (1 - this.alpha) * this.s;
    }
    return this.s;
  }

  lastValue() {
    return this.s;
  }
}

export class OneEuroFilter {
  // minCutoff: lower = smoother at rest, but more lag.
  // beta: higher = less lag during fast movement, but more jitter allowed through.
  constructor({ minCutoff = 1.5, beta = 0.3, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter(this._alpha(minCutoff, 1 / 30));
    this.dxFilter = new LowPassFilter(this._alpha(dCutoff, 1 / 30));
    this.lastTimestamp = null;
  }

  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  // value: the raw signal (e.g. a pixel coordinate). timestampMs: performance.now()-style ms.
  filter(value, timestampMs) {
    let dt = 1 / 30;
    if (this.lastTimestamp !== null) {
      dt = Math.max((timestampMs - this.lastTimestamp) / 1000, 1e-6);
    }
    this.lastTimestamp = timestampMs;

    const prevValue = this.xFilter.lastValue();
    const dx = this.xFilter.initialized ? (value - prevValue) / dt : 0;

    this.dxFilter.setAlpha(this._alpha(this.dCutoff, dt));
    const edx = this.dxFilter.filter(dx);

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.xFilter.setAlpha(this._alpha(cutoff, dt));
    return this.xFilter.filter(value);
  }
}