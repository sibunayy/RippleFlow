/**
 * Tessellation level-of-detail policy.
 *
 * Meshes are built once in a layer's local coordinates, then drawn through a
 * transform. Curves are flattened to a tolerance in local units, so the same
 * mesh looks coarser when scaled up. We pick the tolerance from the largest
 * scale the mesh is expected to be drawn at, and rebuild only when the layer is
 * zoomed in beyond that. Moving, rotating, fading and scaling down never
 * require re-tessellation.
 *
 * The numbers here are defaults to tune on device, not measured values.
 */

/** Max on-screen deviation of a flattened curve from the true curve, in pixels. */
export const PIXEL_ERROR_BUDGET = 0.05;

/** Local-space flattening tolerance for a mesh that will be drawn at up to `maxScale`. */
export function localTolerance(maxScale: number, pixelBudget = PIXEL_ERROR_BUDGET): number {
  return pixelBudget / Math.max(maxScale, 1e-6);
}

/**
 * True if a mesh built for `builtScale` is now drawn too large to meet the
 * error budget. `headroom` avoids rebuilding on every small zoom step.
 */
export function needsRetessellation(builtScale: number, currentScale: number, headroom = 1.5): boolean {
  return currentScale > builtScale * headroom;
}
