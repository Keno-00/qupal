# Model Conversion And URL Deployment

This folder provides scripts to export models to `.tflite` and publish them via GitHub URLs.

## 1) Create Python environment

Windows PowerShell:

```powershell
python -m venv .venv-models
.\.venv-models\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r tools/model_conversion/requirements.txt
```

## 2) Convert models

### A) Convert Keras model to TFLite

```powershell
python tools/model_conversion/convert_keras_to_tflite.py \
  --model path/to/model.h5 \
  --output assets/models/glaucoma_screening.tflite \
  --quantization float16
```

### B) Convert SavedModel to TFLite

```powershell
python tools/model_conversion/convert_saved_model_to_tflite.py \
  --saved-model-dir path/to/saved_model \
  --output assets/models/your_model.tflite \
  --quantization float16
```

### C) Export SegFormer OD/OC segmentation to TFLite

```powershell
python tools/model_conversion/convert_segformer_odoc_to_tflite.py \
  --hf-model pamixsun/segformer_for_optic_disc_cup_segmentation \
  --input-size 224 \
  --output assets/models/glaucoma_odoc_segmentation.tflite \
  --quantization float16
```

## 3) Commit and publish model files

If model files are large, use Git LFS before adding files:

```powershell
git lfs install
git lfs track "assets/models/*.tflite"
```

Then commit and push:

```powershell
git add .gitattributes assets/models/*.tflite app.json tools/model_conversion/*
git commit -m "Add converted TFLite models and conversion tooling"
git push origin <your-branch>
```

## 4) Use GitHub raw URLs in app.json

Use the raw file URL format:

`https://raw.githubusercontent.com/<owner>/<repo>/<branch>/assets/models/<file>.tflite`

Set in app.json:

- expo.extra.aiModels.drGradingUrl
- expo.extra.aiModels.glaucomaUrl
- expo.extra.aiModels.glaucomaSegmentationUrl

Optional segmentation mapping config:

- expo.extra.aiModels.glaucomaSegmentationConfig.inputSize
- expo.extra.aiModels.glaucomaSegmentationConfig.discClassIndex
- expo.extra.aiModels.glaucomaSegmentationConfig.cupClassIndex

## 5) Refresh models on device

In the app, use "Retry AI setup (refresh models)" or rebuild and relaunch.
