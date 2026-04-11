import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { InferenceBootstrapStatus } from './types';

type ModelUrlConfig = {
  drGradingUrl?: string;
  glaucomaUrl?: string;
};

export type RegisteredModel = {
  id: string;
  task: 'dr-grading' | 'glaucoma-screening';
  input: {
    width: number;
    height: number;
    channels: 3;
    color: 'rgb';
  };
  localFileName: string;
  remoteUrl?: string;
  labelMap?: Record<number, string>;
};

export const REGISTERED_MODELS: RegisteredModel[] = [
  {
    id: 'aptos-mobilenetv2-dr-grading',
    task: 'dr-grading',
    input: {
      width: 224,
      height: 224,
      channels: 3,
      color: 'rgb',
    },
    localFileName: 'dr_aptos_mobilenet_v2.tflite',
    remoteUrl: undefined,
    labelMap: {
      0: 'No DR',
      1: 'Mild',
      2: 'Moderate',
      3: 'Severe',
      4: 'Proliferative DR',
    },
  },
  {
    id: 'swinv2-glaucoma-binary',
    task: 'glaucoma-screening',
    input: {
      width: 224,
      height: 224,
      channels: 3,
      color: 'rgb',
    },
    localFileName: 'glaucoma_screening.tflite',
    remoteUrl: undefined,
  },
];

const MODEL_DIR = `${FileSystem.documentDirectory ?? ''}models/`;

function getConfiguredModelUrls(): ModelUrlConfig {
  const raw = (Constants.expoConfig?.extra as { aiModels?: ModelUrlConfig } | undefined)?.aiModels;
  if (!raw) {
    return {};
  }
  return {
    drGradingUrl: typeof raw.drGradingUrl === 'string' ? raw.drGradingUrl : undefined,
    glaucomaUrl: typeof raw.glaucomaUrl === 'string' ? raw.glaucomaUrl : undefined,
  };
}

function getEffectiveRemoteUrl(model: RegisteredModel): string | undefined {
  const configured = getConfiguredModelUrls();
  if (model.task === 'dr-grading' && configured.drGradingUrl) {
    return configured.drGradingUrl;
  }
  if (model.task === 'glaucoma-screening' && configured.glaucomaUrl) {
    return configured.glaucomaUrl;
  }
  return model.remoteUrl;
}

export function getModelFileUri(fileName: string): string {
  return `${MODEL_DIR}${fileName}`;
}

export async function prepareInferenceRuntime(): Promise<void> {
  if (!FileSystem.documentDirectory) {
    return;
  }

  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });

  await Promise.all(
    REGISTERED_MODELS.map(async (model) => {
      const uri = getModelFileUri(model.localFileName);
      const info = await FileSystem.getInfoAsync(uri);
      const remoteUrl = getEffectiveRemoteUrl(model);
      if (info.exists || !remoteUrl) {
        return;
      }
      await FileSystem.downloadAsync(remoteUrl, uri);
    }),
  );
}

export async function getInferenceBootstrapStatus(): Promise<InferenceBootstrapStatus> {
  if (Constants.appOwnership === 'expo') {
    return {
      availability: 'unavailable',
      reason:
        'Expo Go cannot load native TFLite modules. Use a development build (expo run:android / expo run:ios or EAS dev build).',
    };
  }

  if (!FileSystem.documentDirectory) {
    return {
      availability: 'unavailable',
      reason: 'File system document directory is unavailable on this device.',
    };
  }

  const requiredUris = REGISTERED_MODELS.map((model) => getModelFileUri(model.localFileName));
  const checks = await Promise.all(requiredUris.map((uri) => FileSystem.getInfoAsync(uri)));

  const missing = checks
    .map((info, index) => ({ info, model: REGISTERED_MODELS[index] }))
    .filter((entry) => !entry.info.exists)
    .map((entry) => entry.model);

  if (missing.length > 0) {
    const configured = getConfiguredModelUrls();
    const hasConfiguredUrls = Boolean(configured.drGradingUrl && configured.glaucomaUrl);
    const missingFileNames = missing.map((m) => m.localFileName).join(', ');

    return {
      availability: 'unavailable',
      reason: hasConfiguredUrls
        ? `Model download did not complete. Missing: ${missingFileNames}. Check network and retry AI setup.`
        : `Missing model artifacts: ${missingFileNames}. Configure expo.extra.aiModels.drGradingUrl and expo.extra.aiModels.glaucomaUrl in app.json, then retry AI setup.`,
    };
  }

  return {
    availability: 'ready',
  };
}
