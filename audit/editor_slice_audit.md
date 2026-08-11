# Validity audit — visual editor vertical slice

**Subject:** `cyberpunk-room` visual placement editor, commits `48ebe65..773407e`.
**Date:** 2026-08-11. **Threat layers run:** T1 (claims false) + T2 (unclaimed but bites).
T3 (fitness) not run — not requested.
**Domain packs:** system-review (S1–S7) + code. Not a quantitative-research audit.

Verdict summary: **2 of 7 claims fail, 1 is true-but-narrower-than-stated, 4 hold.**
Neither failure is repaired as of this commit. T2 lost two of its three reproduced
escapes in `773407e` but the third (§4 O-1) is still open, so the claim remains false.
T5 cannot be fixed without an outward-facing action and stands as a withdrawn claim.
This audit is therefore **not a pass**; it is a record of what is true, what was
repaired, and what is still broken on purpose.

---

## 1. Claims under audit

Claims 1–7 are the builder's own list, supplied when the audit was opened. Claims
8–10 come from step 1b (halo check): a cold reviewer read the deliverable without
seeing that list and extracted claims independently. The difference set is what the
builder never put up for audit but which shares the "audited" halo.

| # | Claim | Verdict |
|---|---|---|
| C1 | Semantic IDs do not depend on build order | **PASS — but tautological, and an adjacent order dependency is unguarded** |
| C2 | Editor writes go through the same build path the gate uses | **PASS (verifiable, not tautological)** |
| T1 | Registry lifecycle is the caller's job, and gate/runtime agree | **PASS** |
| T2 | The editor owns input exclusively while open | **FAIL — three independent escapes reproduced; two fixed in `773407e`, the third (§4 O-1) still open, so the claim is still false at this commit** |
| T3 | Override validation is two-phase and never half-applies | **PASS as now worded; the earlier wording overclaimed** |
| T4 | Save is transactional (gate FAIL ⇒ file unchanged); read failure aborts | **PASS (control pair run)** |
| T5 | CI runs `npm run verify` | **FAIL — has never run once** |
| H8 | The gate catches bad placements written by the editor | **FAILED before `773407e`; now partially true — one blind spot remains open** |
| H9 | Clicking a prop in the editor selects it | **FAILED before `773407e`; now true** |
| H10 | Saving preserves other entities' edits | **Latent FAIL — cannot bite today, blocks expansion** |

---

## 2. Findings that changed the code

### P1-A — the gate could not see an entity leaving the room (H8)

Every placement check was **scope-conditional**. The wall census only considers meshes
whose world AABB intersects a wall slab; the below-floor check only fired in a narrow
band. Both are correct for static authored geometry and both decline jurisdiction the
moment an editor can write an arbitrary transform — the further out of bounds you go,
the fewer checks apply.

Reproduced by POSTing override documents through `OVERRIDES_PATH` into the real gate
(`tools/gate/scene.mjs:80`). Measured before the fix, all of these **PASSed, exit 0**:

| override on `room.monitor.main` | before | after |
|---|---|---|
| `position:[-6.2,2,0]` (through the wall) | PASS | FAIL · 1 OUT-OF-ROOM |
| `position:[-20,2,0]` | PASS | FAIL · 1 OUT-OF-ROOM |
| `position:[0,-2.9,0]` (just under the floor) | PASS | FAIL · 1 OUT-OF-ROOM |
| `position:[0,-50,0]` (fallen through) | PASS | FAIL · 1 OUT-OF-ROOM |
| `position:[0,2,-30]` | PASS | FAIL · 1 OUT-OF-ROOM |

Controls, run in the same batch — these must not move, or the new check is just a
blanket rejector:

| control | result |
|---|---|
| empty override doc (the checked-in `overrides.json`) | PASS, exit 0 |
| `position:[5.5,1.5,3.4]` — a legal move inside the room | PASS, exit 0 |
| `position:[5.85 / 5.90 / 5.95, 1.75, 0]` — buried in the wall | FAIL · 2 / 2 / 3 WALL-NEW (pre-existing check still fires) |
| `scale:[40,40,40]` | FAIL |

Fix: `ROOM_ENVELOPE` at `src/dev/placement_audit.ts:62`, new `OUT-OF-ROOM` issue kind
at `src/dev/placement_audit.ts:75`, check at `src/dev/placement_audit.ts:350`.
Containment is deliberately scoped to **editor-owned subtrees only**, found by walking
the ancestor chain for `userData.editorId` (`src/dev/placement_audit.ts:223`) — testing
all meshes would false-positive on the authored exterior, where the skyline and signage
live outside the room by design. Because that scope could silently become empty, the
audit result now reports which editables it actually tested
(`src/dev/placement_audit.ts:402`, printed at `src/dev/placement_audit.ts:446`), and
prints `— NONE FOUND` rather than passing quietly.

**Secondary defect found while fixing this one.** `check_wall_clip.mjs` built its
verdict line from a hand-written list of issue kinds, so the first `OUT-OF-ROOM` run
printed `FAIL (1 issue(s): )` — correct exit code, blank explanation. This is the same
failure family as the bug being fixed: an enumeration that silently drops what it does
not know about. The breakdown is now derived from the issues themselves
(`tools/gate/check_wall_clip.mjs:139`).

### P1-B — real mouse selection had never worked (H9)

`BookReader` parks a hidden `Group` on the camera holding five **visible** meshes about
half a metre in front of the lens (`src/player/bookreader.ts:60`,
`src/player/bookreader.ts:61`). `Object3D.traverse` descends into hidden subtrees, and a
non-recursive `intersectObjects` never checks ancestors, so a book page won the raycast
on every editor click and selection reported "not editable"
(`src/editor/editor.ts:180`).

Every prior test passed because they all selected through the `__editorSelectById` hook,
which does not go through the raycast at all. **The test suite and the shipped path had
never met.**

Reproduced in Firefox against the dev server, treatment vs control:

```
TREATMENT (app as shipped)          editor said ["[editor] not editable"]              selected=false
CONTROL   (camera children detached) editor said ["[editor] selected: room.monitor.main"] selected=true
```

Fix: `collectSelectableMeshes()` at `src/editor/editor.ts:80` walks the ancestor chain
for visibility and excludes the gizmo; the pointerdown handler consumes it at
`src/editor/editor.ts:163`. After the fix the shipped app reports `selected=true`.

Regression test: `tools/gate/editor_pick.test.ts` (8 assertions), including two controls
that fail if the filter excludes meshes for the wrong reason.

### P1-C — the editor does not actually own input (T2)

Two independent escapes, each reproduced with a validated detector.

**C-1 · `InteractSystem` is outside the ownership boundary.** The editor's adapter
(`src/main.ts:1361`) sets only `controls.enabled`. Every other mode in the file sets
`interact.enabled` too (`src/main.ts:410`, `src/main.ts:416`, `src/main.ts:725`,
`src/main.ts:878`), and `interact.update()` runs unconditionally each frame
(`src/main.ts:1398`). So `E` still fires world interactions while the editor is open
(`src/player/interact.ts:22`).

```
CONTROL- unbound key       key=KeyQ  "light" -> "light"  fired=false
TREATMENT editor open      key=KeyE  "light" -> "heavy"  fired=true
CONTROL- unbound key       key=KeyQ  "heavy" -> "heavy"  fired=false
CONTROL+ editor closed     key=KeyE  "heavy" -> "off"    fired=true
DETECTOR_VALID=true   LEAK_CONFIRMED=true
```

Honest note on how this was reached: **the first two detectors I wrote were invalid.**
v1 watched only the toast text, and the target's `onUse` does not write to the toast, so
even the positive control read "did not fire". v2 fingerprinted the sum of every light's
intensity — the room's neon flickers every frame, so all 25 rows read `fired=true`,
including ones that could not have fired. v2's control only checked that *something*
fired; it never checked that a no-op reads as not-fired. v3 above uses one discrete
non-animated observable and adds that missing negative control. Only v3's result is
evidence.

**C-2 · `setLocked()` was a second unguarded door** onto the same state as
`requestLock()`. Touch and XR engage movement through it, so guarding only
`requestLock()` (`src/player/fp-controls.ts:112`) left a path able to hand input back
while another subsystem owned it. Fixed at `src/player/fp-controls.ts:97` — taking the
lock is refused when `!enabled`, releasing is always allowed. Re-running the T2
input-ownership harness after the change: `CONTROL_GROUP_VALID=true`,
`AC7b_CLICK_BLOCKED=true`, `AC7a_RESTORED_ON_F2_OFF=true`.

**A third door is identified but NOT fixed — see §4.**

---

## 3. Claims that survived, and whether the check could have failed

Marking each PASS as **tautological** (true by construction, cannot fail — not evidence)
or **contingent** (could have failed).

- **C1 — semantic IDs, PASS, tautological.** IDs are literal strings in source
  (`src/world/room.ts:678`), so "does not depend on build order" is true by
  construction. It is a design property, not a test result, and must not be cited as
  evidence that anything was verified. **The adjacent claim is weaker than it looks:**
  the *authored-transform snapshot* taken inside `registerEditable` does depend on call
  order — it must be called after the transform is set, which
  `src/world/editable.ts:44` states as a caller obligation with no machine check. A
  builder that registers too early gets a silently wrong baseline.
- **C2 — shared build path, PASS, contingent.** Runtime (`src/main.ts:180`) and gate
  (`tools/gate/scene.mjs:84`) both call the same `applyOverrides` from
  `src/world/editable.ts:176`. A second implementation would show up as a second import
  site; there is none.
- **T1 — registry lifecycle, PASS, contingent.** `resetEditableRegistry` is called
  exactly once per build, by the caller, in both environments: `src/main.ts:89` and
  `tools/gate/scene.mjs:65`. The duplicate call inside `room.ts` was removed this round;
  `src/world/room.ts` now only registers (`src/world/room.ts:678`).
- **T3 — two-phase validation, PASS, contingent, but the wording was wrong.** Phase 1
  validates the whole document without touching the scene; phase 2 only runs if phase 1
  completes (`src/world/editable.ts:264`). The docstring previously said "the scene is
  guaranteed to be unchanged", which claims more than the code delivers — phase 2 has no
  rollback. Corrected in place at `src/world/editable.ts:168` to state the guarantee's
  actual scope. **Withdrawal, not explanation.**
- **T4 — transactional save, PASS, contingent, control pair run.** POSTed directly at
  the middleware (`vite.config.ts:289`):

  ```
  FAIL case  {"ok":false,"gateExit":1,...OUT-OF-ROOM}   overrides.json md5 unchanged
  PASS case  {"ok":true, "gateExit":0,...}              overrides.json md5 changed
  ```

  Both directions observed, so the check is not vacuous. Mechanism at
  `vite.config.ts:353`–`vite.config.ts:395`: candidate file → gate → rename on pass,
  unlink on fail. **A second overstated comment was corrected**: the code credited the
  pid suffix for serialising concurrent saves; the actual reason is that steps 1–4
  contain no `await`, so `spawnSync` blocks Node's single thread
  (`vite.config.ts:359`). Within one dev server every request shares a pid, so the
  suffix changes nothing. Two dev servers on the same tree still race on the final
  rename, last writer wins, with no lost-update detection.

---

## 4. Open — reproduced, not fixed

### O-1 · A third door into input ownership: `stand()` (T2, severity high)

`src/main.ts:520` registers a **capture-phase** window keydown that, while `seated`,
calls `stopPropagation()` and `stand()` for W/A/S/D/E/Space. `stand()` sets
`controls.enabled = true` directly (`src/main.ts:510`) — it does not know the editor
exists. Two consequences follow from the adapter caching the previous value
(`src/main.ts:1361`):

1. Sitting down, then opening the editor, then pressing S hands movement back to the
   player **while the editor is still open**.
2. The `S` keypress is also swallowed before the editor's bubble-phase handler
   (`src/editor/editor.ts:276`) can see it, so both the scale modal and `Ctrl+S` lose
   their first press in that state.

Consequence 1 is **reproduced in the browser** (`/tmp/v_seat_escape3.mjs`, run
`/tmp/seat3a.out`). Detector = a counter wrapped around `requestPointerLock`, which
`FpControls.requestLock()` only reaches when `enabled` (`src/player/fp-controls.ts:112`):

```
CONTROL+ editor closed             plCalls=1   (must be > 0)
CONTROL- editor open, not seated   plCalls=0   (must be 0)
TREATMENT seated + editor open + S + click     plCalls=1
camera after S = {x:1.171, y:1.7, z:4}  — stand() restored savedPose
HUD line at CONTROL-: "[EDITOR ON] F2 to disable"; after S: "[EDITOR ON] F2 to disable"
DETECTOR_VALID=true   ESCAPE_CONFIRMED=true
```

The only difference between CONTROL- and TREATMENT is `seated` + the S keypress; the
editor is verifiably on in both. The camera snapping back to the pre-sit pose, and then
drifting x 0.4 → 1.171 under collision resolution, independently corroborates that
`update()` went live again while the editor was open.

Two earlier versions of this harness were invalid and are kept alongside v3 for the
record: **v1** picked the seat by regex-matching prompt text and matched
`"[E] Change rain inten**sit**y"`; **v2** aimed by writing `camera.rotation` directly,
which `update()` overwrites from its own yaw/pitch every frame
(`src/player/fp-controls.ts:149`), so the centre-screen ray stayed level and flew over
the 1.0 m sofa. v3 reaches the seat *through* the confirmed P1-C-1 leak — with the editor
open, `controls.enabled` is false so a hand-written pose survives, while `interact`
still answers E — and confirms seating by camera position against `seatBase`, not by
text. Consequence 2 is a code reading only, not separately reproduced.

Not fixed this round because the correct repair is to make input ownership a single
guarded setter rather than a boolean three subsystems assign to — a refactor larger than
this slice.

### O-2 · Shrink-to-invisible still passes the gate (H8, severity medium)

`ROOM_ENVELOPE` catches an entity leaving the room. It does not catch one collapsing in
place, because a tiny box is still inside the envelope. Measured after the fix:

```
scale:[0.0001,0.0001,0.0001]   exit=0  PASS
scale:[0.01,0.01,0.01]         exit=0  PASS
scale:[40,40,40]               exit=1  FAIL
```

The gate is asymmetric: it detects entities that get too big or go too far, not ones
that vanish. A size-ratio check against the authored scale would close it — deferred, so
recording it here rather than letting the fix's halo imply full coverage.

### O-3 · Save writes only the selected entity (H10, severity medium — latent)

`src/editor/editor.ts:354` takes `selectedRoot` alone; the comment at
`src/editor/editor.ts:353` marks it as a slice shortcut. Previously-saved overrides for
other entities survive via the merge at `src/editor/editor.ts:349`, so nothing on disk
is lost. What is lost is another entity's **unsaved in-session** edit: move A, select B,
Ctrl+S, and A's move is silently dropped while the screen still shows it moved.
**Cannot bite today** — `room.monitor.main` is the only registered editable
(`src/world/room.ts:678`) — but it becomes a live data-loss defect on the first day a
second entity is registered, which is exactly the deferred expansion.

### O-4 · Orphaned override entries skip content validation (severity low)

`src/world/editable.ts:203` pushes an unknown id to `orphaned` and `continue`s **before**
the shape, unknown-key and finite-number checks. A malformed entry under a typo'd id is
therefore never structurally validated. Reproduced with
`{"room.nonexistent.thing":{"bogusKey":"not even a vector","position":[1e999,"x",null]}}`:

```
ORPHAN-OVERRIDE: id "room.nonexistent.thing" ... not found in the scene registry
GATE check_wall_clip: FAIL (1 issue(s): 1 ORPHAN-OVERRIDE)   exit=1
```

Impact is bounded — the gate does reject it, so a garbage file cannot reach a passing
state. The defect is that the message names the wrong problem, and that the entry would
throw at a surprising later time if that id were ever registered.

### O-5 · Baseline keys embed world coordinates (severity low; reviewer's version NOT reproduced)

Baseline entries are keyed `Geometry|worldPosition|size` (`tools/gate/wall_baseline.json:11`),
so moving a baseline-listed mesh invalidates its key. The cold reviewer predicted that a
legal nudge would therefore **double-fail** WALL-NEW + BASELINE-UNUSED, citing
x=5.85/5.90/5.95. Re-measured: those produce **2/2/3 WALL-NEW and zero BASELINE-UNUSED**,
because `room.monitor.main` does not touch a wall at its authored position and so is not
in the baseline at all. The structural coupling is real; the reviewer's specific
prediction does not reproduce on the only entity that exists today. Recorded as
**not reproduced** rather than accepted — a reviewer's number is unverified input like
any other.

---

## 5. T5 — the CI claim is withdrawn

`npm run verify` is claimed to run in CI. Checked, in this order:

- `.github/workflows/ci.yml:1` exists in the working tree and defines the job.
- It appears in exactly one commit, `6a61607`.
- That commit is **not on the remote**: `HEAD` is `773407e`, `origin/main` is `609a601`,
  4 commits ahead.
- `gh run list` → empty, exit 0. `gh workflow list` → empty.

**The workflow has never executed. Zero runs exist.** Local `npm run verify` passing is
not evidence about CI: this repo's own history includes a squash-merge shipped on the
strength of a green local test run while CI was red from the first push.

This is left as a withdrawn claim rather than fixed, because making it true requires
`git push` — an outward-facing action that needs its own `pre_public_gate.sh` run and a
fresh instruction. It is not part of "run the audit".

---

## 6. Reproduction status

Nothing above is asserted without a reproduction. Explicitly:

| Finding | Reproduced | Control validated |
|---|---|---|
| P1-A gate blind spot | yes — 5 escape routes, before/after | yes — 2 in-room controls still PASS, WALL-NEW still fires |
| P1-A secondary (blank verdict) | yes — observed `FAIL (1 issue(s): )` | n/a |
| P1-B selection broken | yes — treatment/control console capture | yes — control selects successfully |
| P1-C-1 interact leak | yes (detector v3) | yes — unbound key reads false in both states |
| P1-C-2 `setLocked` door | yes — post-fix harness re-run | yes |
| O-1 `stand()` escape | yes (harness v3, after two invalid versions) | yes — editor-open-not-seated reads 0, editor state read from HUD text not presence |
| O-2 micro-scale | yes — exit 0 at two scales, exit 1 at scale 40 | yes |
| O-3 save scope | code-pinned, not runnable today (one entity exists) | n/a |
| O-4 orphan validation | yes — malformed doc, gate output captured | n/a |
| O-5 baseline keys | attempted; reviewer's prediction **did not** reproduce | yes |
| T4 transaction | yes | yes — both FAIL and PASS observed |
| T5 CI | yes — four independent checks | n/a |

Verification of the fixes themselves: `npm run verify` exit 0 — gate PASS with
`Containment: 1 editable(s) tested against room envelope [room.monitor.main]`, typecheck
clean, and 129 assertions across six suites (height_fog 47, render_prefs 19,
quality_live 9, RoomState 25, placement_audit 21, editor_pick 8), 0 failed.

---

## 7. What this audit does not cover

- **T3 fitness was not run.** Whether the editor is *good to use* — mobile, free mouse
  drag inside the modal, discoverability — is outside the guarantee.
- **One entity.** Every containment and selection result is measured on
  `room.monitor.main`. Passing here says nothing about the registry, save, or baseline
  behaviour at N entities; O-3 and O-5 are precisely the places that changes.
- **Rendering.** No screenshot check was run. The gate reasons about scene-graph
  transforms; it cannot see anything that looks wrong but sits at legal coordinates.
- **The gate's own baseline.** 75 entries carry placeholder `why:` strings
  (`tools/gate/wall_baseline.json:19`). The exemption list is therefore unjustified in
  writing, and this audit did not re-derive it.
- `src/dev/placement_audit.ts` still ships into the production bundle (pre-existing).
- **The browser harnesses are session-local.** Every `/tmp/…` script and run log cited
  above is scratch, not committed — they hard-code this machine's absolute paths, which
  do not belong in a public repo. The evidence that survives is the output quoted inline
  here plus the checked-in tests (`tools/gate/placement_audit.test.ts`,
  `tools/gate/editor_pick.test.ts`). Anything asserted only from a `/tmp` path is
  reproducible by re-deriving the harness, not by re-running a stored artifact.
