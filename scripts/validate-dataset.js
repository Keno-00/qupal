const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ratio(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function formatPct(value) {
  return `${Math.round(value * 10000) / 100}%`;
}

function buildPredictionMap(predictions) {
  ensure(Array.isArray(predictions.samples), 'predictions.samples must be an array.');
  const map = new Map();

  for (const sample of predictions.samples) {
    ensure(typeof sample.id === 'string' && sample.id.length > 0, 'Each prediction sample needs a non-empty string id.');
    if (map.has(sample.id)) {
      throw new Error(`Duplicate prediction id found: ${sample.id}`);
    }
    map.set(sample.id, sample);
  }

  return map;
}

function validateManifest(manifest) {
  ensure(Array.isArray(manifest.samples), 'manifest.samples must be an array.');
  const seen = new Set();

  for (const sample of manifest.samples) {
    ensure(typeof sample.id === 'string' && sample.id.length > 0, 'Each manifest sample needs a non-empty string id.');
    ensure(sample.task === 'dr-grading' || sample.task === 'glaucoma-screening', `Invalid task for sample ${sample.id}.`);

    if (seen.has(sample.id)) {
      throw new Error(`Duplicate manifest id found: ${sample.id}`);
    }
    seen.add(sample.id);

    if (sample.task === 'dr-grading') {
      ensure(Number.isInteger(sample.label) && sample.label >= 0 && sample.label <= 4, `DR sample ${sample.id} must have an integer label in [0, 4].`);
    } else {
      ensure((sample.label === 0 || sample.label === 1), `Glaucoma sample ${sample.id} must have label 0 or 1.`);
    }
  }
}

function evaluate(manifest, predictions) {
  const predictionMap = buildPredictionMap(predictions);

  let drTotal = 0;
  let drCorrect = 0;

  let glTotal = 0;
  let glCorrect = 0;

  const missingPredictionIds = [];

  for (const sample of manifest.samples) {
    const predicted = predictionMap.get(sample.id);
    if (!predicted) {
      missingPredictionIds.push(sample.id);
      continue;
    }

    if (sample.task === 'dr-grading') {
      drTotal += 1;
      if (predicted.drSeverity === sample.label) {
        drCorrect += 1;
      }
    } else {
      glTotal += 1;
      const prob = Number(predicted.glaucomaProbability);
      if (!Number.isFinite(prob)) {
        continue;
      }
      const predictedLabel = prob >= 0.5 ? 1 : 0;
      if (predictedLabel === sample.label) {
        glCorrect += 1;
      }
    }
  }

  const drAccuracy = ratio(drCorrect, drTotal);
  const glAccuracy = ratio(glCorrect, glTotal);

  return {
    drTotal,
    drCorrect,
    drAccuracy,
    glTotal,
    glCorrect,
    glAccuracy,
    missingPredictionIds,
  };
}

function main() {
  const manifestArg = process.argv[2] || 'validation/manifest.json';
  const predictionsArg = process.argv[3] || 'validation/predictions.json';

  const manifestPath = path.resolve(process.cwd(), manifestArg);
  const predictionsPath = path.resolve(process.cwd(), predictionsArg);

  ensure(fs.existsSync(manifestPath), `Manifest file not found: ${manifestPath}`);
  ensure(fs.existsSync(predictionsPath), `Predictions file not found: ${predictionsPath}`);

  const manifest = readJson(manifestPath);
  const predictions = readJson(predictionsPath);

  validateManifest(manifest);

  const thresholds = {
    drAccuracyMin: Number(manifest?.thresholds?.drAccuracyMin ?? 0.5),
    glaucomaAccuracyMin: Number(manifest?.thresholds?.glaucomaAccuracyMin ?? 0.7),
  };

  ensure(Number.isFinite(thresholds.drAccuracyMin), 'thresholds.drAccuracyMin must be a number.');
  ensure(Number.isFinite(thresholds.glaucomaAccuracyMin), 'thresholds.glaucomaAccuracyMin must be a number.');

  const result = evaluate(manifest, predictions);

  console.log('Validation summary');
  console.log(`- DR accuracy: ${formatPct(result.drAccuracy)} (${result.drCorrect}/${result.drTotal})`);
  console.log(`- Glaucoma accuracy@0.5: ${formatPct(result.glAccuracy)} (${result.glCorrect}/${result.glTotal})`);
  console.log(`- Missing predictions: ${result.missingPredictionIds.length}`);

  if (result.missingPredictionIds.length > 0) {
    console.log(`  Missing ids: ${result.missingPredictionIds.join(', ')}`);
  }

  const drPass = result.drTotal === 0 ? true : result.drAccuracy >= thresholds.drAccuracyMin;
  const glPass = result.glTotal === 0 ? true : result.glAccuracy >= thresholds.glaucomaAccuracyMin;

  if (!drPass || !glPass) {
    console.error('Validation failed: threshold(s) not met.');
    console.error(`- Required DR accuracy >= ${formatPct(thresholds.drAccuracyMin)}`);
    console.error(`- Required Glaucoma accuracy >= ${formatPct(thresholds.glaucomaAccuracyMin)}`);
    process.exit(1);
  }

  console.log('Validation passed.');
}

main();
