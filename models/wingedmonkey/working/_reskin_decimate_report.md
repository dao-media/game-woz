# Reskin — decimate + heat rebind

- Source (untouched): `models/wingedmonkey/working/Monkey_reskin_gargoyle_baked.blend`
- Working: `models/wingedmonkey/working/Monkey_reskin_gargoyle_decimated.blend`
- Studio GLB: `models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb` (37.43 MB)

## Mesh

- Before: {'verts': 321302, 'edges': 817426, 'faces': 499960}
- After clean: {'verts': 249965, 'edges': 749937, 'faces': 499958}
- After reduce: {'verts': 7486, 'edges': 22500, 'faces': 15000} (method=collapse)
- Topology: before={'boundary_edges': 0, 'nonmanifold_edges': 0} after={'boundary_edges': 0, 'nonmanifold_edges': 0}
- Why remesh: Clean merge closed the shell; collapse to ~12–18k faces.
- Silhouette: {'mesh_size': [0.0061, 0.0041, 0.01], 'wing_bone_span_x': 0.0012, 'mesh_width_x': 0.0061, 'height_z': 0.01, 'wing_risk': 'ok'}

## Heat bind

- {'method': 'HEAT_CAGE_DATA_TRANSFER', 'groups': 112, 'weighted_verts': 7486, 'total_verts': 7486, 'pct': 100.0, 'cage': {'cage_weighted': 482, 'transfer_weighted': 7486}, 'note': 'Direct ARMATURE_AUTO on Tripo mesh assigns 0 verts; weights projected from a successful heat cage via Data Transfer.'}

## Verify

### Idle — mesh_animates=True travel=0.0827m
| Region | Verdict | Δ |
|---|---|---|
| torso | minor | 0.0003 m |
| head | minor | 0.0003 m |
| arms | minor | 0.0003 m |
| hands | minor | 0.0003 m |
| legs | minor | 0.0003 m |
| wings | minor | 0.0003 m |

### Walk — mesh_animates=True travel=0.3942m
| Region | Verdict | Δ |
|---|---|---|
| torso | minor | 0.0021 m |
| head | minor | 0.0035 m |
| arms | minor | 0.0029 m |
| hands | minor | 0.0023 m |
| legs | minor | 0.0021 m |
| wings | minor | 0.0019 m |

### FlyIdleLoop — mesh_animates=True travel=0.4342m
| Region | Verdict | Δ |
|---|---|---|
| torso | clean | 0.0169 m |
| head | clean | 0.016 m |
| arms | clean | 0.0166 m |
| hands | clean | 0.0171 m |
| legs | clean | 0.0171 m |
| wings | clean | 0.0175 m |

### FlyForward — mesh_animates=True travel=0.4328m
| Region | Verdict | Δ |
|---|---|---|
| torso | clean | 0.0167 m |
| head | clean | 0.0158 m |
| arms | clean | 0.0163 m |
| hands | clean | 0.0169 m |
| legs | clean | 0.0169 m |
| wings | clean | 0.0166 m |

### Attack01 — mesh_animates=True travel=1.8706m
| Region | Verdict | Δ |
|---|---|---|
| torso | minor | 0.011 m |
| head | minor | 0.0111 m |
| arms | minor | 0.0113 m |
| hands | minor | 0.0102 m |
| legs | minor | 0.0107 m |
| wings | minor | 0.0114 m |

GLB optimized 37.43 MB → 1.15 MB (resize 1K + webp q90 + draco)
