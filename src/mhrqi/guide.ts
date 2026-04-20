export const CAPTURE_GUIDE_FRAME_HEIGHT = 320;
export const CAPTURE_GUIDE_CIRCLE_DIAMETER = 190;

export const CAPTURE_GUIDE_RADIUS_RATIO =
  CAPTURE_GUIDE_CIRCLE_DIAMETER / (2 * CAPTURE_GUIDE_FRAME_HEIGHT);

// After center-anchored guide crop, the square side equals guide diameter.
// Radius would be 0.5 for an exact edge match; keep a slight inset to reduce border artifacts.
export const CAPTURE_GUIDE_POST_CROP_MASK_RADIUS_RATIO = 0.48;
