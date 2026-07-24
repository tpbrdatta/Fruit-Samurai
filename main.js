import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ---- DOM ----
const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");
const handsCountEl = document.getElementById("handsCount");
const latencyEl = document.getElementById("latency");
const startBtn = document.getElementById("startBtn");

// ---- Hand skeleton connections (MediaPipe's 21-point layout) ----
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [5, 9], [9, 10], [10, 11], [11, 12],  // middle
  [9, 13], [13, 14], [14, 15], [15, 16],// ring
  [13, 17], [17, 18], [18, 19], [19, 20],// pinky
  [0, 17],                               // palm base
];
const FINGERTIP_INDICES = new Set([4, 8, 12, 16, 20]);

let handLandmarker = null;
let running = false;
let lastVideoTime = -1;
let lastFrameStamp = performance.now();

async function initModel() {
  statusEl.textContent = "loading model";
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
  statusEl.textContent = "ready";
}

async function startCamera() {
  try {
    statusEl.textContent = "requesting camera";
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

    running = true;
    statusEl.textContent = "tracking";
    lastFrameStamp = performance.now();
    requestAnimationFrame(renderLoop);
  } catch (err) {
    statusEl.textContent = `camera error: ${err.message}`;
  }
}

function renderLoop() {
  if (!running) return;

  const now = performance.now();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    const inferenceStart = performance.now();
    const result = handLandmarker.detectForVideo(video, now);
    const inferenceMs = performance.now() - inferenceStart;

    draw(result);
    handsCountEl.textContent = String(result.landmarks.length);
    latencyEl.textContent = `${inferenceMs.toFixed(1)}ms`;
  }

  const dt = now - lastFrameStamp;
  lastFrameStamp = now;
  fpsEl.textContent = String(Math.round(1000 / dt));

  requestAnimationFrame(renderLoop);
}

function draw(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Note: the <canvas> element itself is mirrored via CSS (transform: scaleX(-1)),
  // matching the mirrored <video>. So we draw in raw (unmirrored) coordinates here
  // and the display flip is handled purely by CSS — detection still reads the
  // camera's true, unmirrored frame.
  for (const landmarks of result.landmarks) {
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

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "starting…";
  if (!handLandmarker) await initModel();
  await startCamera();
  startBtn.textContent = "camera running";
});

initModel();