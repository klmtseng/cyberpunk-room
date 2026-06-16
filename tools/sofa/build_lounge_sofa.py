"""Blender CLI build of the cyberpunk L-sectional lounge sofa.

Run via:
    blender -b -P tools/sofa/build_lounge_sofa.py

Design intent: replace the 3-box primitive sofa with a curved L-sectional
that has rounded edges everywhere — no sharp box corners. Subdivision
surface + bevel modifiers give us smooth organic forms; tufting buttons
suggest plush upholstery without expensive sculpting.

Output: public/assets/models/lounge_sofa.glb

Geometry layout (real-world metres, origin at floor-centre of main sofa):
- Main seat block:   3.0 (x) × 0.42 (y) × 1.05 (z),  centre (0, 0.21, 0)
- Backrest:          3.0 (x) × 0.55 (y) × 0.25 (z),  back of main seat
- Chaise extension:  1.0 (x) × 0.42 (y) × 2.2 (z),   extends to +z, +x side
- Tufting buttons:   small spheres pressed into seat top + backrest

Three.js side (lounge_sofa.ts) places the loaded GLB at the current sofa
spot (centre 0.4, 0.0, 2.0) and applies the leather PBR material from
Polyhaven.
"""
import bpy, bmesh, math, os
from mathutils import Vector

OUT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "public", "assets", "models", "lounge_sofa.glb",
))

# clean slate
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def add_box(name, sx, sy, sz, x, y, z, bevel_w=0.08, subsurf=2):
    """Add a rounded box: cube → Bevel → SubSurf → apply."""
    bpy.ops.mesh.primitive_cube_add(size=2)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx / 2, sy / 2, sz / 2)
    obj.location = (x, y, z)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # Bevel
    bev = obj.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = bevel_w
    bev.segments = 4
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(30)
    bpy.ops.object.modifier_apply(modifier="Bevel")
    # SubSurf
    if subsurf:
        sub = obj.modifiers.new(name="SubSurf", type="SUBSURF")
        sub.levels = subsurf
        bpy.ops.object.modifier_apply(modifier="SubSurf")
    # auto-smooth shading
    bpy.ops.object.shade_smooth()
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(40)
    return obj


def add_cushion(name, sx, sy, sz, x, y, z, bevel_w=0.06, subsurf=3):
    """Soft cushion = heavily bevelled+subdivided box."""
    return add_box(name, sx, sy, sz, x, y, z, bevel_w=bevel_w, subsurf=subsurf)


def add_tuft_button(name, x, y, z, radius=0.022):
    """Small sphere pressed into upholstery — tufting button."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=12, ring_count=8)
    obj = bpy.context.active_object
    obj.name = name
    obj.location = (x, y, z)
    obj.scale = (1.0, 0.6, 1.0)   # flatten so it sinks slightly
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    return obj


# ----------------------------------------------------------------
# Materials — placeholder. Three.js side will override with the
# Polyhaven leather PBR maps, so just one material slot is fine.
# ----------------------------------------------------------------
def make_upholstery_mat():
    m = bpy.data.materials.new("Upholstery")
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.35, 0.40, 0.50, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    return m


mat_upholstery = make_upholstery_mat()


# ----------------------------------------------------------------
# MAIN SEAT BLOCK (3.0 wide, 0.42 tall, 1.05 deep)
# ----------------------------------------------------------------
# Slight wedge by making base slightly smaller than top, so the silhouette
# isn't perfectly rectangular when viewed from the side. Use cushion-style
# subdivision for soft top.
seat = add_cushion("MainSeat", 3.0, 0.42, 1.05, 0, 0.21, 0)
seat.data.materials.append(mat_upholstery)

# ----------------------------------------------------------------
# BACKREST  (3.0 wide, 0.55 tall, 0.25 deep) — sits back of main seat
# ----------------------------------------------------------------
# z position: back edge of main seat is z = -0.525, backrest centred at -0.40
back = add_box("Backrest", 3.0, 0.55, 0.25, 0, 0.42 + 0.275, -0.40)
back.data.materials.append(mat_upholstery)

# ----------------------------------------------------------------
# CHAISE EXTENSION (1.0 wide, 0.42 tall, 2.2 deep)
# ----------------------------------------------------------------
# attached to the right side, extends forward (+z direction)
# right edge of main seat is x = +1.5, chaise centred at x = +2.0
# main seat spans z = [-0.525, +0.525]; chaise spans z = [-0.525, +1.675] (longer forward)
chaise = add_cushion("Chaise", 1.0, 0.42, 2.2, 2.0, 0.21, 0.575)
chaise.data.materials.append(mat_upholstery)

# ----------------------------------------------------------------
# ARMRESTS — small cylinders on the outer ends
# ----------------------------------------------------------------
# Left arm: at x = -1.5 (left edge), arm centred at x = -1.55
# Round cylinder lying on its side along z direction
def add_armrest(name, x, y, z, length):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=length, vertices=24)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = (math.radians(90), 0, 0)  # lay on side along z
    obj.location = (x, y, z)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(40)
    return obj


arm_l = add_armrest("ArmL", -1.55, 0.42 + 0.05, 0, 1.0)
arm_l.data.materials.append(mat_upholstery)
arm_r = add_armrest("ArmR",  1.50, 0.42 + 0.05, 0, 1.0)
arm_r.data.materials.append(mat_upholstery)

# Front of chaise: small armrest end-cap so it doesn't just stop in mid-air
chaise_front = add_armrest("ChaiseFront", 2.0, 0.42 + 0.05, 1.675, 1.0)
chaise_front.rotation_euler = (0, math.radians(90), 0)   # rotate around Y to lay along x
chaise_front.data.materials.append(mat_upholstery)

# ----------------------------------------------------------------
# TUFTING BUTTONS — small spheres pressed into the backrest + seat
# ----------------------------------------------------------------
# Two rows of buttons across the backrest face
button_y_top = 0.42 + 0.55      # top of backrest
button_z = -0.40 + 0.13          # front face of backrest
button_z2 = -0.40 + 0.10
for row, by in enumerate([button_y_top - 0.18, button_y_top - 0.40]):
    offset = 0.10 if row % 2 else 0
    for bx_idx in range(7):
        bx = -1.35 + bx_idx * 0.45 + offset
        if abs(bx) > 1.45:
            continue
        add_tuft_button(f"BtnB{row}_{bx_idx}", bx, by, button_z if row == 0 else button_z2)

# Seat buttons (2 × 5 grid on main seat top)
seat_top_y = 0.42 - 0.02
for row in range(2):
    for bx_idx in range(5):
        bx = -1.30 + bx_idx * 0.65
        bz = -0.30 + row * 0.50
        if abs(bx) > 1.45:
            continue
        add_tuft_button(f"BtnS{row}_{bx_idx}", bx, seat_top_y, bz)

# Chaise tufting (single row down the long axis)
for i in range(3):
    bz = -0.05 + i * 0.55
    add_tuft_button(f"BtnC_{i}", 2.0, seat_top_y, bz)

# ----------------------------------------------------------------
# EXPORT
# ----------------------------------------------------------------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
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
print(f"[OK] wrote {OUT} ({os.path.getsize(OUT)//1024} KB)")
