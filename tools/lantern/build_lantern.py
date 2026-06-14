"""Blender CLI build of the brass-+-mosaic-glass bar lantern.

Run via:
    blender -b -P tools/lantern/build_lantern.py

Reference photos: IMG_5714.jpeg, IMG_5715.jpeg — small Turkish/Ottoman style
mosaic table lamp with brass top cap (rope-twist + ring + spike + handle hoop),
spherical glass body, brass base ring (rope-twist + pierced star band).

Output:  public/assets/models/bar_lantern.glb

Conventions
-----------
Real height of the prop ~22cm; the three.js side scales to taste, but we model
in real units (metres) so the GLB is reusable. Origin sits at the bottom face
of the base so we can plonk it on the counter at y = countertop_top exactly.

Named meshes are crucial — lantern.ts looks them up to swap the glass material
in at runtime (the mosaic texture isn't baked into the GLB; we apply it from
JS so the Image() route can stream and cache cleanly).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "public", "assets", "models", "bar_lantern.glb",
)
OUT = os.path.normpath(OUT)

# ---- clean slate ----
bpy.ops.wm.read_factory_settings(use_empty=True)
for c in bpy.data.collections:
    bpy.data.collections.remove(c)

scene = bpy.context.scene


def new_obj(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def shade_smooth(obj, angle_deg=40):
    for p in obj.data.polygons:
        p.use_smooth = True
    # autosmooth via custom split normals
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(angle_deg)


def brass_material():
    mat = bpy.data.materials.new("Brass")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.78, 0.54, 0.22, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.42
    return mat


def dark_brass_material():
    mat = bpy.data.materials.new("BrassDark")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.42, 0.28, 0.10, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.55
    return mat


def glass_material():
    """Placeholder — three.js replaces this with MeshPhysicalMaterial + mosaic map."""
    mat = bpy.data.materials.new("MosaicGlass")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.93, 0.88, 0.78, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.35
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


brass = brass_material()
brass_dk = dark_brass_material()
glass_m = glass_material()


# =================================================================
# BASE  — brass stand with two rope-twist rings + pierced star band
# =================================================================
def make_base():
    """Returns the top of the base in metres so the glass can sit on it."""
    base_grp_objs = []

    # bottom plate (thin disk, slight bevel)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=64,
        radius1=0.038, radius2=0.038, depth=0.006,
    )
    bmesh.ops.bevel(
        bm, geom=bm.edges[:] + bm.verts[:], offset=0.0008, segments=2, affect="EDGES",
    )
    m = bpy.data.meshes.new("Base_Plate")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Base_Plate", m)
    obj.location.z = 0.003
    obj.data.materials.append(brass)
    base_grp_objs.append(obj)

    # lower rope-twist torus (decorative ring)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=8, radius=0.0055)
    # squish into a torus-like band by deleting top/bottom — easier: use torus
    bm.free()
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=96, radius1=0.034, radius2=0.034, depth=0.011)
    m = bpy.data.meshes.new("Base_RopeLow")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Base_RopeLow", m)
    obj.location.z = 0.012
    obj.data.materials.append(brass)
    base_grp_objs.append(obj)
    # Add a finer rope-effect via a thin band of beads
    for i in range(24):
        a = i * math.tau / 24
        bead = bpy.data.meshes.new(f"bead_lo_{i}")
        bm2 = bmesh.new()
        bmesh.ops.create_uvsphere(bm2, u_segments=8, v_segments=6, radius=0.0028)
        bm2.to_mesh(bead); bm2.free()
        bo = new_obj(f"BaseBeadLo_{i}", bead)
        bo.location = (math.cos(a)*0.0345, math.sin(a)*0.0345, 0.0125)
        bo.data.materials.append(brass)
        base_grp_objs.append(bo)

    # pierced star band — the lacy cylinder section. We model the solid wall
    # then approximate piercings with small dark recesses (small inset boxes).
    # True boolean cutouts are pretty for raster but expensive; the small lit
    # band is read from 2m away so this is plenty.
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=False, segments=64, radius1=0.030, radius2=0.030, depth=0.022)
    m = bpy.data.meshes.new("Base_Band")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Base_Band", m)
    obj.location.z = 0.029
    obj.data.materials.append(brass)
    base_grp_objs.append(obj)
    # star piercings — small dark stars distributed around the cylinder
    N_STARS = 10
    for i in range(N_STARS):
        a = i * math.tau / N_STARS
        # a tiny dark inset disk inside the band — reads as a hole
        bm2 = bmesh.new()
        bmesh.ops.create_cone(
            bm2, cap_ends=True, segments=5, radius1=0.0045, radius2=0.0045, depth=0.001)
        m2 = bpy.data.meshes.new(f"piercing_{i}")
        bm2.to_mesh(m2); bm2.free()
        po = new_obj(f"BasePiercing_{i}", m2)
        po.location = (math.cos(a)*0.0301, math.sin(a)*0.0301, 0.029)
        po.rotation_euler = (math.pi/2, 0, a + math.pi/2)
        po.data.materials.append(brass_dk)
        base_grp_objs.append(po)

    # upper rope-twist torus + beads (same as lower)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=96, radius1=0.034, radius2=0.034, depth=0.011)
    m = bpy.data.meshes.new("Base_RopeHi")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Base_RopeHi", m)
    obj.location.z = 0.046
    obj.data.materials.append(brass)
    base_grp_objs.append(obj)
    for i in range(24):
        a = i * math.tau / 24
        bead = bpy.data.meshes.new(f"bead_hi_{i}")
        bm2 = bmesh.new()
        bmesh.ops.create_uvsphere(bm2, u_segments=8, v_segments=6, radius=0.0028)
        bm2.to_mesh(bead); bm2.free()
        bo = new_obj(f"BaseBeadHi_{i}", bead)
        bo.location = (math.cos(a)*0.0345, math.sin(a)*0.0345, 0.0465)
        bo.data.materials.append(brass)
        base_grp_objs.append(bo)

    # rim that the glass sphere rests on
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=64, radius1=0.030, radius2=0.026, depth=0.006)
    m = bpy.data.meshes.new("Base_Rim")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Base_Rim", m)
    obj.location.z = 0.055
    obj.data.materials.append(brass)
    base_grp_objs.append(obj)

    for o in base_grp_objs:
        shade_smooth(o)
    return 0.058  # top of base in z


base_top = make_base()


# =================================================================
# GLASS BODY — mosaic sphere (slightly oblate, like the photo)
# =================================================================
def make_glass(base_top_z):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=0.055)
    # slight oblate squish for that "almost egg" silhouette
    for v in bm.verts:
        v.co.z *= 1.05
    bm.to_mesh(bpy.data.meshes.new("__tmp_glass")); bm.free()
    # build mesh fresh now we know transform
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=0.055)
    for v in bm.verts:
        v.co.z *= 1.05
    # cut the bottom flat so it sits on the rim (matches photo where the body
    # mates to the brass base)
    bmesh.ops.bisect_plane(
        bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:],
        plane_co=(0, 0, -0.040), plane_no=(0, 0, 1), clear_inner=True,
    )
    # cut the top opening for the cap
    bmesh.ops.bisect_plane(
        bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:],
        plane_co=(0, 0, 0.046), plane_no=(0, 0, -1), clear_inner=True,
    )
    m = bpy.data.meshes.new("Glass_Body")
    bm.to_mesh(m); bm.free()

    # IMPORTANT: UV unwrap so the mosaic texture wraps correctly.
    # Spherical unwrap from the temp mesh works fine; we re-create after.
    obj = new_obj("Glass_Body", m)
    obj.location.z = base_top_z + 0.040  # sphere center sits above the rim
    obj.data.materials.append(glass_m)
    shade_smooth(obj, 60)

    # use Blender's smart UV project — sphere unwrap would be ideal but smart
    # project produces acceptable results without needing edit-mode operators
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.sphere_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    return obj.location.z + 0.054  # top of glass dome z


glass_top = make_glass(base_top)


# =================================================================
# TOP CAP — brass dome + rope ring + spike finial + handle hoop
# =================================================================
def make_top_cap(z_anchor):
    objs = []
    # collar ring (sits on glass opening)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=64, radius1=0.026, radius2=0.024, depth=0.006)
    m = bpy.data.meshes.new("Cap_Collar")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Cap_Collar", m)
    obj.location.z = z_anchor + 0.000
    obj.data.materials.append(brass)
    objs.append(obj)

    # rope-twist around the collar
    for i in range(28):
        a = i * math.tau / 28
        bead = bpy.data.meshes.new(f"cap_bead_{i}")
        bm2 = bmesh.new()
        bmesh.ops.create_uvsphere(bm2, u_segments=8, v_segments=6, radius=0.0025)
        bm2.to_mesh(bead); bm2.free()
        bo = new_obj(f"CapBead_{i}", bead)
        bo.location = (math.cos(a)*0.0260, math.sin(a)*0.0260, z_anchor + 0.000)
        bo.data.materials.append(brass)
        objs.append(bo)

    # dome cap
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.022)
    bmesh.ops.bisect_plane(
        bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:],
        plane_co=(0, 0, 0.000), plane_no=(0, 0, -1), clear_inner=True,
    )
    m = bpy.data.meshes.new("Cap_Dome")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Cap_Dome", m)
    obj.location.z = z_anchor + 0.005
    obj.data.materials.append(brass)
    objs.append(obj)

    # spike finial — small cone on top of dome
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=12, radius1=0.005, radius2=0.0005, depth=0.018)
    m = bpy.data.meshes.new("Cap_Spike")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Cap_Spike", m)
    obj.location.z = z_anchor + 0.030
    obj.data.materials.append(brass)
    objs.append(obj)

    # tiny bauble at spike base
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.004)
    m = bpy.data.meshes.new("Cap_Bauble")
    bm.to_mesh(m); bm.free()
    obj = new_obj("Cap_Bauble", m)
    obj.location.z = z_anchor + 0.022
    obj.data.materials.append(brass)
    objs.append(obj)

    # handle hoop — torus rotated so the loop arches above the spike on a side
    # In the photo the handle is a thin wire arc with mounting nubs.
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.0026)
    bm.to_mesh(bpy.data.meshes.new("__tmp")); bm.free()

    # Build hoop as a thin torus, then mount it offset
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.020, minor_radius=0.0014,
        major_segments=48, minor_segments=10,
    )
    hoop = bpy.context.active_object
    hoop.name = "Cap_Handle"
    hoop.rotation_euler = (math.pi/2, 0, 0)
    hoop.location = (0.0, 0.0, z_anchor + 0.034)
    hoop.data.materials.append(brass)
    objs.append(hoop)

    for o in objs:
        shade_smooth(o)


make_top_cap(glass_top)


# =================================================================
# EXPORT
# =================================================================
os.makedirs(os.path.dirname(OUT), exist_ok=True)
# select everything
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
print(f"\n[OK] wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
print(f"     ~base_top={base_top:.3f}  glass_top={glass_top:.3f}  total≈{glass_top+0.05:.3f}m")
