# Validation datasets for GLANCE

This folder supports labeled validation testing for diabetic retinopathy (DR) and glaucoma.

## Recommended labeled datasets

Use public, clinically labeled datasets with clear license terms.

- DR grading:
  - APTOS 2019 Blindness Detection (labels 0..4)
  - Messidor-2 (DR grading labels, if your use and redistribution rights are valid)
- Glaucoma screening:
  - REFUGE (glaucoma/non-glaucoma labels)
  - ORIGA (disc/cup annotations and glaucoma labels)

Important:
- Always confirm license and institutional approval for your use case.
- Do not commit raw patient images to git.

## Files

- manifest.template.json: Example label manifest schema
- predictions.template.json: Example prediction export schema

Create local files:
- manifest.json
- predictions.json
- images in validation/images/

These are git-ignored by default.

## Manifest schema

manifest.json should follow this structure:

- version: number
- thresholds:
  - drAccuracyMin: number (0..1)
  - glaucomaAccuracyMin: number (0..1)
- samples: array
  - id: unique sample id
  - task: dr-grading or glaucoma-screening
  - image: local path (for traceability)
  - label:
    - DR: integer 0..4
    - Glaucoma: 0 or 1
  - source: optional dataset name

## Predictions schema

predictions.json should follow this structure:

- version: number
- samples: array
  - id: sample id matching manifest
  - drSeverity: integer 0..4 or null
  - glaucomaProbability: number 0..1 or null

## Run validation

1) Copy templates:
- manifest.template.json -> manifest.json
- predictions.template.json -> predictions.json

2) Fill manifest.json with ground-truth labels.

3) Export model predictions into predictions.json.

4) Run:

npm run validate:dataset

The script computes:
- DR exact-match accuracy
- Glaucoma binary accuracy at threshold 0.5

It exits with non-zero status if thresholds are not met.

## Suggested minimum size

For stable signal, target at least:
- DR: 200+ samples distributed across all grades
- Glaucoma: 200+ samples with balanced positive/negative classes

Smaller sets are useful for smoke validation, but not for model acceptance decisions.
