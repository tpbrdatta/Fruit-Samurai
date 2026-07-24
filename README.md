# Fruit Samurai

A Fruit Ninja-style game where a webcam hand-tracking model is the blade —
no mouse, no touch, just your hand in front of the camera.

Built in the browser with [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
(Hand Landmarker) for tracking, plain HTML5 Canvas for rendering, no build step.

## Running locally

Camera access and ES modules both require a real origin — opening
`index.html` directly (`file://`) will not work. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just push to GitHub and use the Pages URL, which is `https://` already.

## Milestones

- [x] **01 — Tracking calibration.** Camera feed + raw 21-point landmark
      overlay, FPS and inference-latency readout. No game logic — just
      confirming detection quality across distance/lighting before
      building anything on top of it. Detection runs in a Web Worker so
      rendering stays smooth regardless of inference speed.
- [x] **02 — Filtered fingertip.** Index fingertip run through a One Euro
      filter, with live `minCutoff`/`beta` sliders and a raw-vs-filtered
      overlay for tuning by eye. Per-hand filter state resets cleanly when
      a hand drops out and re-enters.
- [ ] **03 — Blade trail.** Render a trail from the filtered point.
- [ ] **04 — Fruit physics.** Spawn/arc/gravity, no slicing yet.
- [ ] **05 — Collision + slicing.** Trail vs. fruit hitbox detection.
- [ ] **06 — Score, lives, HUD.** The actual game loop.
- [ ] **07 — Modes, power-ups, sound, polish.**

## Stack

- MediaPipe Tasks Vision (Hand Landmarker, GPU delegate, loaded from CDN)
- Vanilla JS + Canvas 2D — no framework, no build step
- Hosted on GitHub Pages