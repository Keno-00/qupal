import argparse
import pathlib
import tempfile
from typing import Dict

import tensorflow as tf
from transformers import AutoImageProcessor, TFSegformerForSemanticSegmentation


class SegformerExportModule(tf.Module):
    def __init__(self, model: TFSegformerForSemanticSegmentation):
        super().__init__()
        self.model = model

    @tf.function(
        input_signature=[
            tf.TensorSpec(shape=[1, None, None, 3], dtype=tf.float32, name='image'),
        ]
    )
    def __call__(self, image: tf.Tensor) -> Dict[str, tf.Tensor]:
        outputs = self.model(pixel_values=image, training=False)
        logits = outputs.logits
        # Resize logits to input spatial size for easier runtime parsing.
        input_shape = tf.shape(image)
        resized = tf.image.resize(logits, [input_shape[1], input_shape[2]], method='bilinear')
        # Return NHWC scores: [1, H, W, C]
        nhwc_scores = tf.transpose(resized, [0, 2, 3, 1])
        return {'scores': nhwc_scores}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Export SegFormer OD/OC model to TFLite.')
    parser.add_argument(
        '--hf-model',
        default='pamixsun/segformer_for_optic_disc_cup_segmentation',
        help='Hugging Face model id',
    )
    parser.add_argument('--output', required=True, help='Output .tflite path')
    parser.add_argument(
        '--quantization',
        choices=['none', 'float16', 'dynamic'],
        default='float16',
        help='Optional TFLite optimization mode',
    )
    parser.add_argument(
        '--input-size',
        type=int,
        default=224,
        help='Input size used for concrete function signature',
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Ensure processor artifacts are cached for reproducibility/docs.
    _ = AutoImageProcessor.from_pretrained(args.hf_model)
    model = TFSegformerForSemanticSegmentation.from_pretrained(args.hf_model, from_pt=True)

    export_module = SegformerExportModule(model)

    with tempfile.TemporaryDirectory() as tmp_dir:
        saved_model_dir = pathlib.Path(tmp_dir) / 'saved_model'
        concrete = export_module.__call__.get_concrete_function(
            tf.TensorSpec([1, args.input_size, args.input_size, 3], tf.float32)
        )
        tf.saved_model.save(export_module, str(saved_model_dir), signatures={'serving_default': concrete})

        converter = tf.lite.TFLiteConverter.from_saved_model(str(saved_model_dir))

        if args.quantization == 'float16':
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            converter.target_spec.supported_types = [tf.float16]
        elif args.quantization == 'dynamic':
            converter.optimizations = [tf.lite.Optimize.DEFAULT]

        tflite_model = converter.convert()

    out_path = pathlib.Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(tflite_model)
    print(f'Wrote {out_path} ({len(tflite_model)} bytes)')
    print('Set app.json -> expo.extra.aiModels.glaucomaSegmentationConfig as:')
    print('{"inputSize": %d, "discClassIndex": 1, "cupClassIndex": 2}' % args.input_size)


if __name__ == '__main__':
    main()
