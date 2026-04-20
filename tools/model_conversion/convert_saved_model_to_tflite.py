import argparse
import pathlib
import tensorflow as tf


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Convert TensorFlow SavedModel to TFLite.')
    parser.add_argument('--saved-model-dir', required=True, help='Path to SavedModel directory')
    parser.add_argument('--output', required=True, help='Output .tflite path')
    parser.add_argument(
        '--quantization',
        choices=['none', 'float16', 'dynamic'],
        default='float16',
        help='Optional TFLite optimization mode',
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    converter = tf.lite.TFLiteConverter.from_saved_model(args.saved_model_dir)

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


if __name__ == '__main__':
    main()
