// Camera setup, frame capture, and rendering live here on the main thread.
// Detection itself runs in worker.js so it never blocks rendering.

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

// ---- Hand skeleton connections (MediaPipe's 21-point layout) ----
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],        // index
  [5, 9], [9, 10], [10, 11], [11, 12],   // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20],// pinky
  [0, 17],                                // palm base
];
const FINGERTIP_INDICES = new Set([4, 8, 12, 16, 20]);

let cameraStarted = false;
let awaitingFrame = false;       // true while a frame is in-flight to the worker
let latestLandmarks = [];        // most recent detection result, drawn every render frame
let lastRenderTime = performance.now();
let lastDetectionTime = performance.now();

// ---- Worker setup ----
const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});

worker.onmessage = (event) => {
  const { type } = event.data;

  if (type === "ready") {
    statusEl.textContent = "model ready";
    startBtn.disabled = false;
    startBtn.textContent = "start camera";
    return;
  }

  if (type === "result") {
    const { landmarks, inferenceMs } = event.data;
    latestLandmarks = landmarks;
    handsCountEl.textContent = String(landmarks.length);
    latencyEl.textContent = `${inferenceMs.toFixed(1)}ms`;

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

  draw(latestLandmarks);
  requestAnimationFrame(renderLoop);
}

function draw(landmarksList) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // The <canvas> element is mirrored via CSS (transform: scaleX(-1)), matching
  // the mirrored <video>. We draw in raw (unmirrored) coordinates here — the
  // display flip is purely CSS, so detection still reads the true camera frame.
  for (const landmarks of landmarksList) {
    ctx.strokeStyle = "rgba(94, 234, 212, 0.7)";
    ctx.lineWidth = 2;
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    }

    landmarks.forEach((pt, i) => {
      const x = pt.x * canvas.width;
      const y = pt.y * canvas.height;
      const isTip = FINGERTIP_INDICES.has(i);
      ctx.beginPath();
      ctx.arc(x, y, isTip ? 6 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? "#fbbf24" : "#5eead4";
      ctx.fill();
    });
  }
}