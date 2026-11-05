# Layer transform design

## Decision

Shapes are tessellated **once, in their own local coordinates**. Position,
rotation, scale and opacity are applied on the GPU through a per-draw affine
matrix and an opacity value. Animating a layer is a uniform update, not a
geometry rebuild.

Before this change the spike baked the output scale into the vertices and
rewrote them to move anything. That made every animated frame cost CPU time and
buffer uploads proportional to vertex count.

## Pieces

| Piece | File | Notes |
|---|---|---|
| Affine math | `src/core/affine.ts` | `[a,b,c,d,e,f]`, y-down, positive rotation is clockwise. |
| Layer matrices | `src/core/layerTransform.ts` | `localMatrix`, `worldMatrix` (parent chain), `opacityAt`. Pure, runs in Node. |
| Tessellation LOD | `src/geometry/lod.ts` | When a mesh must be rebuilt. |
| GPU path | `src/render/meshRenderer.ts` | `Draw.transform`, `Draw.opacity`, `setTransform(i, m, opacity)`. |

## Semantics (After Effects-style)

`local = translate(position) * rotate(rotation) * scale(scale) * translate(-anchor)`

- The anchor is a point in the layer's own space. Rotation and scale act about it, and position says where it lands in the parent.
- World matrix = parent's world matrix * local matrix, up to the root. A cycle or a missing parent throws.
- Opacity is **not** inherited from the parent.
- Defaults for an empty track: anchor 0, position 0, scale 1, rotation 0, opacity 1.

## When geometry must be rebuilt

Curves are flattened to a tolerance in local units, so a mesh looks coarser when
drawn larger. The tolerance is chosen from the largest scale the mesh is
expected to be drawn at (`localTolerance`). Rebuild (`needsRetessellation`) only
when the layer is zoomed well past that scale.

No rebuild is needed for: move, rotate, fade, scale down, or parent changes.

Rebuild is needed for: path edits, stroke width or join changes, zooming in past
the built scale, and **trim paths** (they change which part of the outline exists).

The 0.05 px error budget and 1.5x headroom are starting values to tune on the iPad.

## Known gaps

- **Non-uniform scale** stretches strokes with the layer, as in After Effects. A stroke that must stay constant width under scale needs a rebuild.
- **Semi-transparent strokes** still double-blend where stroke pieces overlap (see the tessellation spike). Opacity here is applied per draw, so it has the same issue until strokes are rendered to a layer.
- No skew, 3D, motion blur, masks/mattes or precomps.
- Batching: each draw has its own uniform buffer and draw call. Fine for tens of layers; revisit before hundreds.
- `setScene` skips draws with no triangles, so indices passed to `setTransform` count only the draws that were kept. Callers should not assume the input array index.
