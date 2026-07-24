// Camera setup, frame capture, filtering, and rendering live here on the
// main thread. Detection itself runs in worker.js so it never blocks
// rendering.

import { OneEuroFilter } from "./filters.js";

// ---- DOM ----
const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const renderFpsEl = document.getElementById("fps");
const detectFpsEl = document.getElementById("detectFps");
const handsCountEl = document.getElementById("handsCount");
const latencyEl = document.getElementById("latency");
const startBtn = document.getElementById("startBtn");
const minCutoffInput = document.getElementById("minCutoff");
const betaInput = document.getElementById("beta");
const minCutoffValueEl = document.getElementById("minCutoffValue");
const betaValueEl = document.getElementById("betaValue");
const showRawInput = document.getElementById("showRaw");

// ---- Hand skeleton connections (MediaPipe's 21-point layout) ----
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],        // index
  [5, 9], [9, 10], [10, 11], [11, 12],   // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20],// pinky
  [0, 17],                                // palm base
];
const INDEX_FINGERTIP = 8;

let cameraStarted = false;
let awaitingFrame = false;       // true while a frame is in-flight to the worker
let latestLandmarks = [];        // most recent raw detection result
let lastRenderTime = performance.now();
let lastDetectionTime = performance.now();

// One filter pair (x, y) per possible hand slot. Reset to null when a hand
// drops out so re-entry starts clean instead of smoothing from a stale value.
const fingertipFilters = [null, null];

function getFilterParams() {
  return {
    minCutoff: parseFloat(minCutoffInput.value),
    beta: parseFloat(betaInput.value),
  };
}

function filteredFingertip(handIndex, rawX, rawY, timestampMs) {
  if (!fingertipFilters[handIndex]) {
    const { minCutoff, beta } = getFilterParams();
    fingertipFilters[handIndex] = {
      x: new OneEuroFilter({ minCutoff, beta }),
      y: new OneEuroFilter({ minCutoff, beta }),
    };
  }
  const pair = fingertipFilters[handIndex];
  const { minCutoff, beta } = getFilterParams();
  pair.x.minCutoff = minCutoff;
  pair.x.beta = beta;
  pair.y.minCutoff = minCutoff;
  pair.y.beta = beta;

  return {
    x: pair.x.filter(rawX, timestampMs),
    y: pair.y.filter(rawY, timestampMs),
  };
}

minCutoffInput.addEventListener("input", () => {
  minCutoffValueEl.textContent = parseFloat(minCutoffInput.value).toFixed(2);
});
betaInput.addEventListener("input", () => {
  betaValueEl.textContent = parseFloat(betaInput.value).toFixed(2);
});

// ---- Worker setup ----
const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});

let modelReady = false;

// The model file is several MB; on a slow connection loading genuinely
// takes a while. These just keep you informed instead of leaving you
// staring at a status that never changes.
const slowLoadTimer = setTimeout(() => {
  if (!modelReady) {
    statusEl.textContent = "still loading (large model file — hang tight)";
  }
}, 8000);
const stuckLoadTimer = setTimeout(() => {
  if (!modelReady) {
    statusEl.textContent =
      "taking unusually long — check your connection, or open the console (F12) for errors";
  }
}, 20000);

worker.onerror = (err) => {
  clearTimeout(slowLoadTimer);
  clearTimeout(stuckLoadTimer);
  statusEl.textContent = `worker crashed: ${err.message || "see console (F12)"}`;
};

worker.onmessage = (event) => {
  const { type } = event.data;

  if (type === "ready") {
    modelReady = true;
    clearTimeout(slowLoadTimer);
    clearTimeout(stuckLoadTimer);
    statusEl.textContent = `model ready (${event.data.delegate})`;
    startBtn.disabled = false;
    startBtn.textContent = "start camera";
    return;
  }

  if (type === "error") {
    clearTimeout(slowLoadTimer);
    clearTimeout(stuckLoadTimer);
    statusEl.textContent = `model failed to load: ${event.data.message}`;
    return;
  }

  if (type === "result") {
    const { landmarks, inferenceMs } = event.data;
    latestLandmarks = landmarks;
    handsCountEl.textContent = String(landmarks.length);
    latencyEl.textContent = `${inferenceMs.toFixed(1)}ms`;

    // Clear filter state for any slot that no longer has a hand in it.
    for (let i = 0; i < fingertipFilters.length; i++) {
      if (i >= landmarks.length) fingertipFilters[i] = null;
    }

    const now = performance.now();
    const dt = now - lastDetectionTime;
    lastDetectionTime = now;
    detectFpsEl.textContent = String(Math.round(1000 / dt));

    awaitingFrame = false; // clear to send the next frame
  }
};

// ---- Camera ----
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  statusEl.textContent = "requesting camera";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });
    await video.play();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    cameraStarted = true;
    statusEl.textContent = "tracking";
    startBtn.textContent = "camera running";

    lastRenderTime = performance.now();
    requestAnimationFrame(renderLoop);
    captureLoop();
  } catch (err) {
    statusEl.textContent = `camera error: ${err.message}`;
    startBtn.disabled = false;
  }
});

// ---- Frame capture: pull-based, tied to real new video frames ----
async function captureLoop() {
  if (!cameraStarted) return;

  if (!awaitingFrame) {
    awaitingFrame = true;
    try {
      const bitmap = await createImageBitmap(video);
      worker.postMessage(
        { type: "frame", bitmap, timestamp: performance.now() },
        [bitmap]
      );
    } catch {
      awaitingFrame = false;
    }
  }

  if (video.requestVideoFrameCallback) {
    video.requestVideoFrameCallback(captureLoop);
  } else {
    requestAnimationFrame(captureLoop);
  }
}

// ---- Render loop: runs at full display refresh rate, independent of detection ----
function renderLoop() {
  if (!cameraStarted) return;

  const now = performance.now();
  const dt = now - lastRenderTime;
  lastRenderTime = now;
  renderFpsEl.textContent = String(Math.round(1000 / dt));

  draw(latestLandmarks, now);
  requestAnimationFrame(renderLoop);
}

function draw(landmarksList, timestampMs) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // The <canvas> element is mirrored via CSS (transform: scaleX(-1)), matching
  // the mirrored <video>. We draw in raw (unmirrored) coordinates here — the
  // display flip is purely CSS, so detection still reads the true camera frame.
  landmarksList.forEach((landmarks, handIndex) => {
    // Dim skeleton for context.
    ctx.strokeStyle = "rgba(94, 234, 212, 0.25)";
    ctx.lineWidth = 1.5;
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    }
    landmarks.forEach((pt, i) => {
      if (i === INDEX_FINGERTIP) return; // drawn separately below, bigger
      const x = pt.x * canvas.width;
      const y = pt.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(94, 234, 212, 0.35)";
      ctx.fill();
    });

    // Raw fingertip (small, dim) vs filtered fingertip (bright blade tip).
    const tip = landmarks[INDEX_FINGERTIP];
    const rawX = tip.x * canvas.width;
    const rawY = tip.y * canvas.height;

    if (showRawInput.checked) {
      ctx.beginPath();
      ctx.arc(rawX, rawY, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(248, 113, 113, 0.85)"; // dim red = raw signal
      ctx.fill();
    }

    const filtered = filteredFingertip(handIndex, rawX, rawY, timestampMs);
    ctx.beginPath();
    ctx.arc(filtered.x, filtered.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = "#fbbf24"; // amber ring = filtered blade tip
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(filtered.x, filtered.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
  });
}