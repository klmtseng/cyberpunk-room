"""Blender CLI build of the desk-side Turkish lamp (the more elaborate one).

Run via:
    blender -b -P tools/lantern/build_lantern_desk.py

Reference photos IMG_5728-31: bigger, more ornate cousin of the bar lantern.
Distinguishing features:
  - 3-tier brass base: wide rope-twist ring → pierced star+bar band → narrow
    rope-twist + flared rim. A small switch button on the lower side.
  - Egg-shaped (vertically elongated) glass body.
  - Bell-shaped top cap with rope band, then a double-bulb finial knob, plus
    a thin wire handle hoop.
  - Antiqued brass (darker than the bar lantern).

Output: public/assets/models/desk_lantern.glb

Model origin sits at the bottom of the base. Real-unit dimensions: ~26cm tall.
"""
import bpy, bmesh, math, os
from mathutils import Vector

OUT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "public", "assets", "models", "desk_lantern.glb",
))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def new_obj(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def shade_smooth(obj, angle_deg=40):
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(angle_deg)


def brass_material(name="Brass", base=(0.62, 0.40, 0.15, 1.0), rough=0.42):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = rough
    return mat


brass = brass_material("Brass")
brass_dk = brass_material("BrassDark", base=(0.34, 0.20, 0.07, 1.0), rough=0.58)
glass = bpy.data.materials.new("MosaicGlass")
glass.use_nodes = True
gb = glass.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.95, 0.92, 0.86, 1.0)
gb.inputs["Roughness"].default_value = 0.35
gb.inputs["Metallic"].default_value = 0.0


def cyl(name, r1, r2, depth, segments=64, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=cap, segments=segments,
        radius1=r1, radius2=r2, depth=depth,
    )
    m = bpy.data.meshes.new(name)
    bm.to_mesh(m); bm.free()
    return m


def beads_ring(name_prefix, radius, z, r=0.0028, count=28, mat=None):
    """A ring of small spheres around (0,0,z) — the rope-twist look."""
    objs = []
    for i in range(count):
        a = i * math.tau / count
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=r)
        m = bpy.data.meshes.new(f"{name_prefix}_{i}")
        bm.to_mesh(m); bm.free()
        o = new_obj(f"{name_prefix}_{i}", m)
        o.location = (math.cos(a) * radius, math.sin(a) * radius, z)
        if mat:
            o.data.materials.append(mat)
        objs.append(o)
    return objs


# ============================================================
# BASE — three tiers
# ============================================================
# baseline disk
disk = new_obj("Base_Disk", cyl("Base_Disk", 0.055, 0.055, 0.006))
disk.location.z = 0.003
disk.data.materials.append(brass)

# black foot (resin ring at the very bottom on the real photo)
foot = new_obj("Base_Foot", cyl("Base_Foot", 0.052, 0.052, 0.003))
foot.location.z = 0.0015
mat_foot = bpy.data.materials.new("BlackFoot")
mat_foot.use_nodes = True
fb = mat_foot.node_tree.nodes["Principled BSDF"]
fb.inputs["Base Color"].default_value = (0.05, 0.05, 0.06, 1.0)
fb.inputs["Roughness"].default_value = 0.7
foot.data.materials.append(mat_foot)

# ---- tier 1: wide rope ring ----
TIER1_Z = 0.010
TIER1_RAD = 0.050
ring1 = new_obj("Base_Tier1", cyl("Base_Tier1", TIER1_RAD, TIER1_RAD, 0.012))
ring1.location.z = TIER1_Z
ring1.data.materials.append(brass)
beads_ring("Tier1Bead", TIER1_RAD + 0.0008, TIER1_Z + 0.006, r=0.0030, count=34, mat=brass)
beads_ring("Tier1Bead", TIER1_RAD + 0.0008, TIER1_Z - 0.005, r=0.0030, count=34, mat=brass)

# ---- tier 2: pierced star+bar band ----
TIER2_Z = 0.027
TIER2_RAD = 0.045
band = new_obj("Base_Band", cyl("Base_Band", TIER2_RAD, TIER2_RAD, 0.026, cap=False))
band.location.z = TIER2_Z
band.data.materials.append(brass)
# pierced stars + bars — small dark insets around the band
N = 8
for i in range(N):
    a = i * math.tau / N
    # 5-point star
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=5,
        radius1=0.0050, radius2=0.0050, depth=0.0012,
    )
    m = bpy.data.meshes.new(f"star_{i}")
    bm.to_mesh(m); bm.free()
    st = new_obj(f"Base_Star_{i}", m)
    st.location = (math.cos(a) * (TIER2_RAD + 0.0002),
                   math.sin(a) * (TIER2_RAD + 0.0002),
                   TIER2_Z + 0.004)
    st.rotation_euler = (math.pi/2, 0, a + math.pi/2)
    st.data.materials.append(brass_dk)
    # vertical bar between stars
    a2 = a + math.pi / N
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=0.001)
    bmesh.ops.scale(bm, vec=(1, 9.5, 2), verts=bm.verts)
    m = bpy.data.meshes.new(f"bar_{i}")
    bm.to_mesh(m); bm.free()
    bar = new_obj(f"Base_Bar_{i}", m)
    bar.location = (math.cos(a2) * (TIER2_RAD + 0.0002),
                    math.sin(a2) * (TIER2_RAD + 0.0002),
                    TIER2_Z - 0.001)
    bar.rotation_euler = (0, math.pi/2, a2)
    bar.data.materials.append(brass_dk)

# ---- tier 3: narrow rope-twist + flared rim where the glass sits ----
TIER3_Z = 0.052
TIER3_RAD = 0.046
top_ring = new_obj("Base_Tier3", cyl("Base_Tier3", TIER3_RAD, TIER3_RAD, 0.010))
top_ring.location.z = TIER3_Z
top_ring.data.materials.append(brass)
beads_ring("Tier3Bead", TIER3_RAD + 0.0008, TIER3_Z + 0.005, r=0.0028, count=28, mat=brass)
beads_ring("Tier3Bead", TIER3_RAD + 0.0008, TIER3_Z - 0.004, r=0.0028, count=28, mat=brass)

# flared rim
rim = new_obj("Base_Rim", cyl("Base_Rim", TIER3_RAD - 0.001, TIER3_RAD - 0.010, 0.014))
rim.location.z = TIER3_Z + 0.014
rim.data.materials.append(brass)

# ---- side switch button (small circular pad) ----
btn = new_obj("Base_Switch",
              cyl("Base_Switch", 0.005, 0.0035, 0.0035, segments=14))
btn.location = (TIER2_RAD + 0.0035, 0, TIER2_Z + 0.003)
btn.rotation_euler = (math.pi / 2, 0, 0)
btn.data.materials.append(brass_dk)

base_top_z = TIER3_Z + 0.021

for o in scene.objects:
    if o.name.startswith("Base_") or o.name.startswith("Tier"):
        shade_smooth(o)


# ============================================================
# BODY — egg-shaped glass dome
# ============================================================
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=72, v_segments=42, radius=0.060)
for v in bm.verts:
    v.co.z *= 1.18  # vertically elongated → egg shape
# trim bottom flat so it rests on the rim
bmesh.ops.bisect_plane(
    bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
    plane_co=(0, 0, -0.038), plane_no=(0, 0, 1), clear_inner=True,
)
# trim top for the cap opening
bmesh.ops.bisect_plane(
    bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
    plane_co=(0, 0, 0.054), plane_no=(0, 0, -1), clear_inner=True,
)
m = bpy.data.meshes.new("Glass_Body")
bm.to_mesh(m); bm.free()
body = new_obj("Glass_Body", m)
body.location.z = base_top_z + 0.038
body.data.materials.append(glass)
shade_smooth(body, 60)
# sphere UV project so the equirect mosaic wraps clean
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.sphere_project()
bpy.ops.object.mode_set(mode="OBJECT")
body.select_set(False)

body_top_z = body.location.z + 0.054


# ============================================================
# TOP CAP — bell dome + rope band + double-bulb finial + handle
# ============================================================
# rope ring sitting on the glass opening
cap_ring = new_obj("Cap_Ring", cyl("Cap_Ring", 0.026, 0.026, 0.006))
cap_ring.location.z = body_top_z
cap_ring.data.materials.append(brass)
beads_ring("CapRopeBead", 0.026 + 0.0008, body_top_z, r=0.0025, count=30, mat=brass)

# bell-shaped dome (wide bottom, narrowing up)
bm = bmesh.new()
bmesh.ops.create_cone(
    bm, cap_ends=True, segments=48,
    radius1=0.026, radius2=0.010, depth=0.022,
)
m = bpy.data.meshes.new("Cap_Bell")
bm.to_mesh(m); bm.free()
bell = new_obj("Cap_Bell", m)
bell.location.z = body_top_z + 0.014
bell.data.materials.append(brass)
shade_smooth(bell)

# pierced "vent" holes around the bell (small dark insets — heat vents on real lamp)
for i in range(6):
    a = i * math.tau / 6
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=0.0028)
    bmesh.ops.scale(bm, vec=(1, 0.4, 1.6), verts=bm.verts)
    m = bpy.data.meshes.new(f"vent_{i}")
    bm.to_mesh(m); bm.free()
    v = new_obj(f"Cap_Vent_{i}", m)
    v.location = (math.cos(a) * 0.018,
                  math.sin(a) * 0.018,
                  body_top_z + 0.022)
    v.rotation_euler = (0, 0, a)
    v.data.materials.append(brass_dk)

cap_top_z = body_top_z + 0.027  # top of the bell

# double-bulb finial knob
b1 = new_obj("Cap_Bulb1", cyl("Cap_Bulb1", 0.011, 0.009, 0.014, segments=20))
b1.location.z = cap_top_z + 0.007
b1.data.materials.append(brass)
shade_smooth(b1)

# spherical bulge on top of bulb1
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=0.0095)
m = bpy.data.meshes.new("Cap_Sphere1")
bm.to_mesh(m); bm.free()
s1 = new_obj("Cap_Sphere1", m)
s1.location.z = cap_top_z + 0.020
s1.data.materials.append(brass)
shade_smooth(s1)

# upper rim (narrow)
b2 = new_obj("Cap_Bulb2", cyl("Cap_Bulb2", 0.008, 0.006, 0.010, segments=18))
b2.location.z = cap_top_z + 0.033
b2.data.materials.append(brass)
shade_smooth(b2)

# top sphere of the finial
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=0.0070)
m = bpy.data.meshes.new("Cap_Sphere2")
bm.to_mesh(m); bm.free()
s2 = new_obj("Cap_Sphere2", m)
s2.location.z = cap_top_z + 0.041
s2.data.materials.append(brass)
shade_smooth(s2)

# handle hoop — small wire torus on top of the dome
bpy.ops.mesh.primitive_torus_add(
    major_radius=0.018, minor_radius=0.0013,
    major_segments=42, minor_segments=8,
)
hoop = bpy.context.active_object
hoop.name = "Cap_Handle"
hoop.data.name = "Cap_Handle"
hoop.rotation_euler = (math.pi/2, 0, math.pi/4)  # off-axis like in the photo
hoop.location = (0.005, 0.005, cap_top_z + 0.011)
hoop.data.materials.append(brass)
shade_smooth(hoop)


# ============================================================
# EXPORT
# ============================================================
os.makedirs(os.path.dirname(OUT), exist_ok=True)
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_normals=True,
    export_tangents=True,
    export_materials="EXPORT",
    export_yup=True,
)
total_h = cap_top_z + 0.045
print(f"\n[OK] wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
print(f"     base_top={base_top_z:.3f}  body_top={body_top_z:.3f}  total≈{total_h:.3f}m")
