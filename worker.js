// Classic (non-module) worker — deliberately, not by default. MediaPipe's
// WASM loader calls importScripts() internally, and importScripts() is
// disallowed inside module workers. We stay classic and reach the ES module
// export via dynamic import() instead of a static `import` statement, since
// dynamic import works in classic worker scope but importScripts doesn't
// work in module scope.

let handLandmarker = null;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function createLandmarker(HandLandmarker, delegate, filesetResolver) {
  return HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

async function init() {
  try {
    const { HandLandmarker, FilesetResolver } = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14"
    );

    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    // GPU context creation inside a Worker isn't reliably supported across
    // browsers/drivers. Try GPU first (fastest), fall back to CPU if it fails.
    try {
      handLandmarker = await createLandmarker(HandLandmarker, "GPU", filesetResolver);
      postMessage({ type: "ready", delegate: "GPU" });
      return;
    } catch (gpuErr) {
      console.warn("GPU delegate failed in worker, falling back to CPU:", gpuErr);
    }

    handLandmarker = await createLandmarker(HandLandmarker, "CPU", filesetResolver);
    postMessage({ type: "ready", delegate: "CPU" });
  } catch (err) {
    postMessage({ type: "error", message: err?.message || String(err) });
  }
}

// Pull-based: main thread only sends a new frame once we've finished the last one.
self.onmessage = (event) => {
  const { type } = event.data;
  if (type !== "frame" || !handLandmarker) return;

  const { bitmap, timestamp } = event.data;
  const inferenceStart = performance.now();
  const result = handLandmarker.detectForVideo(bitmap, timestamp);
  const inferenceMs = performance.now() - inferenceStart;
  bitmap.close();

  postMessage({
    type: "result",
    landmarks: result.landmarks,
    inferenceMs,
  });
};

init();