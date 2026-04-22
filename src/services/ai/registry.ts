import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { InferenceBootstrapStatus } from './types';

type ModelUrlConfig = {
  drGradingUrl?: string;
  glaucomaUrl?: string;
  glaucomaSegmentationUrl?: string;
};

export type RegisteredModel = {
  id: string;
  task: 'dr-grading' | 'glaucoma-screening' | 'glaucoma-segmentation' | 'reasoning-foundation';
  required?: boolean;
  input: {
    width: number;
    height: number;
    channels: 3;
    color: 'rgb';
  };
  localFileName: string;
  remoteUrl?: string;
  asset?: any; // Reference to require() for local assets
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
  {
    id: 'odoc-segmentation',
    task: 'glaucoma-segmentation',
    required: false,
    input: {
      width: 224,
      height: 224,
      channels: 3,
      color: 'rgb',
    },
    localFileName: 'glaucoma_odoc_segmentation.tflite',
    remoteUrl: undefined,
  },
  {
    id: 'lfm-2.5-1.2b-instruct',
    task: 'reasoning-foundation',
    required: true,
    input: {
      width: 0, // LLM doesn't have fixed image input dimensions
      height: 0,
      channels: 3,
      color: 'rgb',
    },
    localFileName: 'LFM2.5-1.2B-Instruct-Q4_K_M.gguf',
    remoteUrl: undefined,
    asset: require('../../../assets/models/LFM2.5-1.2B-Instruct-Q4_K_M.gguf'),
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
    glaucomaSegmentationUrl:
      typeof raw.glaucomaSegmentationUrl === 'string' ? raw.glaucomaSegmentationUrl : undefined,
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
  if (model.task === 'glaucoma-segmentation' && configured.glaucomaSegmentationUrl) {
    return configured.glaucomaSegmentationUrl;
  }
  return model.remoteUrl;
}

export function getModelFileUri(fileName: string): string {
  return `${MODEL_DIR}${fileName}`;
}

function hasNativeTfliteRuntime(): { ok: true } | { ok: false; reason: string } {
  try {
    const moduleRef = require('react-native-fast-tflite') as {
      loadTensorflowModel?: unknown;
    };
    if (typeof moduleRef?.loadTensorflowModel !== 'function') {
      return {
        ok: false,
        reason:
          'Native TFLite runtime is not available in this binary. Rebuild and run a development client that includes react-native-fast-tflite.',
      };
    }
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    return {
      ok: false,
      reason:
        `Native TFLite runtime failed to initialize${detail}. Rebuild the app (npx expo run:android) and relaunch the development client.`,
    };
  }
}

export async function prepareInferenceRuntime(options?: { forceRedownload?: boolean }): Promise<void> {
  if (!FileSystem.documentDirectory) {
    return;
  }

  const forceRedownload = options?.forceRedownload === true;

  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });

  await Promise.all(
    REGISTERED_MODELS.map(async (model) => {
      const uri = getModelFileUri(model.localFileName);
      const info = await FileSystem.getInfoAsync(uri);
      const remoteUrl = getEffectiveRemoteUrl(model);
      if (!remoteUrl && info.exists) {
        return;
      }

      if (forceRedownload && info.exists) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }

      const afterDeleteInfo = forceRedownload ? await FileSystem.getInfoAsync(uri) : info;
      if (afterDeleteInfo.exists) {
        return;
      }

      if (model.asset) {
        // Copy from assets to document directory
        try {
          const { Asset } = require('expo-asset');
          const asset = Asset.fromModule(model.asset);
          await asset.downloadAsync();
          await FileSystem.copyAsync({
            from: asset.localUri || asset.uri,
            to: uri,
          });
        } catch (e) {
          console.error(`Failed to copy asset ${model.localFileName}:`, e);
        }
      } else if (remoteUrl) {
        await FileSystem.downloadAsync(remoteUrl, uri);
      }
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

  const nativeRuntime = hasNativeTfliteRuntime();
  if (!nativeRuntime.ok) {
    return {
      availability: 'unavailable',
      reason: nativeRuntime.reason,
    };
  }

  const requiredModels = REGISTERED_MODELS.filter((model) => model.required !== false);
  const requiredUris = requiredModels.map((model) => getModelFileUri(model.localFileName));
  const checks = await Promise.all(requiredUris.map((uri) => FileSystem.getInfoAsync(uri)));

  const missing = checks
    .map((info, index) => ({ info, model: requiredModels[index] }))
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
