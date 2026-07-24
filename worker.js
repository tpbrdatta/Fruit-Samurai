import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

let handLandmarker = null;

async function init() {
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
  postMessage({ type: "ready" });
}

// Pull-based: main thread only sends a new frame once we've finished the last one.
self.onmessage = (event) => {
  const { type } = event.data;
  if (type !== "frame" || !handLandmarker) return;

  const { bitmap, timestamp } = event.data;
  const inferenceStart = performance.now();
  const result = handLandmarker.detectForVideo(bitmap, timestamp);
  const inferenceMs = performance.now() - inferenceStart;
  bitmap.close(); // release the transferred frame

  postMessage({
    type: "result",
    landmarks: result.landmarks,
    inferenceMs,
  });
};

init();