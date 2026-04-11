# Model Artifacts

Runtime model loading expects files in app storage at:

- `FileSystem.documentDirectory/models/dr_aptos_mobilenet_v2.tflite`
- `FileSystem.documentDirectory/models/glaucoma_screening.tflite`

The app runs in strict model-only mode and will not process scans unless both files are present and loadable by the native runtime.

The startup preparation step can auto-download missing files when URLs are configured in `app.json` under `expo.extra.aiModels`:

- `drGradingUrl`
- `glaucomaUrl`

These URLs should point directly to downloadable `.tflite` files.

Expected model contracts:

## `dr_aptos_mobilenet_v2.tflite`
- Source: `drprajapati/APTOSBlindnessDetection`.
- Input tensor: `[1, 224, 224, 3]`, `float32`, RGB.
- Output tensor: `[1, 5]`, DR grade scores.
- Labels: `No DR`, `Mild`, `Moderate`, `Severe`, `Proliferative DR`.
- Runtime preprocessing currently uses DR-specific 0..1 normalization in app inference.

## `glaucoma_screening.tflite`
- Input tensor: `[1, 224, 224, 3]`, `float32`, RGB, scaled to `0..1`.
- Output tensor: `[1, 1]` single score (interpreted as sigmoid probability/logit in app runtime).

Use a development build (`expo run:*`/EAS dev build), not Expo Go.
