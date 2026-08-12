# Validity audit — visual editor vertical slice

**Subject:** `cyberpunk-room` visual placement editor, commits `48ebe65..773407e`,
with a follow-up repair at `61d4206` (§2.1).
**Date:** 2026-08-11; T2 re-verified 2026-08-12. **Threat layers run:** T1 (claims
false) + T2 (unclaimed but bites). T3 (fitness) not run — not requested.
**Domain packs:** system-review (S1–S7) + code. Not a quantitative-research audit.

Verdict summary **as audited at `773407e`**: **2 of 7 claims fail, 1 is
true-but-narrower-than-stated, 4 hold.** Neither failure was repaired at that commit.
This audit is therefore **not a pass**; it is a record of what is true, what was
repaired, and what is still broken on purpose.

**Status at `61d4206`:** T2's three escapes are now all closed and re-verified against
detectors that pass in both directions (§2.1). The claim as originally worded is still
recorded as FAIL, because it was false when made — the repair is a later event, not a
retroactive correction of the verdict.

**Status at `f73406c`:** T5's underlying condition is now satisfied — CI ran
`npm run verify` and it passed (§5b). **This does not turn the audit into a clean pass.**
Both T2 and T5 were false when claimed and their verdicts stand. Of the remaining five,
C1 passes only as a **tautology** with little evidential value, and T3 holds **only under
the narrowed wording** adopted after the audit — the original wording overclaimed. So the
honest one-line summary remains: two claims failed and were later repaired, one is
vacuous, one was rewritten to fit the evidence, and three hold as stated.

**Status at `1836cfd` (2026-08-13):** a cold review opened after this audit closed found
that the §2.1 repair handed input back to the wrong owner (H11). Closed at
`1836cfd52456dba7b4dc514e90d9ea10cecc2c5f`; full timeline in §2.2. The verdicts above are
unchanged — H11 is a later event, not a retroactive correction.

---

## 0. Milestone and stop rule

**Milestone: Editor Vertical Slice v0.1 — Controlled-use Ready.**
Closed 2026-08-13 at `1836cfd52456dba7b4dc514e90d9ea10cecc2c5f`. CI run
[31622498663](https://github.com/klmtseng/cyberpunk-room/actions/runs/31622498663):
`npm run verify` executed and passed, **194 assertions / 0 failed**, gate
`check_wall_clip: PASS`. That 194/0 is the current baseline.

"Controlled-use ready" is deliberately narrower than "done". It means: the editor can be
used by someone who knows its limits, the save path will not corrupt `overrides.json`, and
input ownership no longer strands the player. It does **not** mean the open findings below
were resolved.

**Carried as non-blocking backlog, not fixed:**

| Item | Where | Why it does not block |
|---|---|---|
| O-2 shrink-to-invisible passes the gate | §4 | Requires deliberate misuse; gate still catches every out-of-room case |
| O-4 orphaned override entries skip content validation | §4 | Orphans are preserved, not applied; reproduced and bounded |
| O-5 baseline keys embed world coordinates | §4 | Reviewer's predicted failure did **not** reproduce |
| Gizmo behaviour | — | Never live-verified at any point in this audit; treat as unverified |
| Multi-entity live coverage | §7 | Only one editable (`room.monitor.main`) exists, so N-entity behaviour is untested by construction, not by omission |

**Stop rule — when to reopen editor engineering.** This slice is closed. Reopen it only on
one of these five signals, and not for polish, refactoring, or additional audit rounds:

1. **Data corruption** — `overrides.json` is written in a state the gate would have rejected,
   or a save loses an entity's committed edits.
2. **Reload inconsistency** — what the editor shows after a save does not match what a fresh
   page load builds from the same file.
3. **Input soft-lock** — any sequence that leaves both `controls.enabled` and
   `interact.enabled` false with no overlay on screen (the H11 failure mode, §2.2).
4. **Gate/scene contradiction** — the gate reports PASS on a placement that is visibly wrong,
   or FAIL on one that is visibly right.
5. **A real content need that cannot be met** — an actual room-authoring task is blocked by a
   missing editor capability.

Absent one of those, further work here is not justified.

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
| T2 | The editor owns input exclusively while open | **FAIL as audited — three independent escapes reproduced. Two were fixed in `773407e`; the third (O-1) needed the ownership refactor and was closed in `61d4206`. All three re-verified closed on 2026-08-12 (§2.1). The verdict stays FAIL: the claim was false when made.** The `61d4206` repair was itself later found incomplete — it returned input to the wrong owner (H11); closed at `1836cfd`, see §2.2. |
| T3 | Override validation is two-phase and never half-applies | **PASS as now worded; the earlier wording overclaimed** |
| T4 | Save is transactional (gate FAIL ⇒ file unchanged); read failure aborts | **PASS (control pair run)** |
| T5 | CI runs `npm run verify` | **FAIL as audited — had never run once. Made true later at `f73406c`: CI run 31568529846 succeeded and did execute the command (§5b). The verdict stays FAIL because the claim was false when made.** |
| H8 | The gate catches bad placements written by the editor | **FAILED before `773407e`; now partially true — one blind spot remains open** |
| H9 | Clicking a prop in the editor selects it | **FAILED before `773407e`; now true** |
| H10 | Saving preserves other entities' edits | **Latent FAIL as audited — closed at `8f932ae` (§4 O-3); the on-disk merge always worked, what was dropped was unsaved in-session edits of unselected entities** |

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

C-1 was **reproduced but not repaired at `773407e`** — it sits in this section because
the reproduction is what drove the other changes, not because a fix landed. It is filed
under §2 rather than §4 in the as-audited document, which is a mis-filing; it was caught
only when a post-fix harness exploited the leak on current code and it still worked.
Closed at `61d4206` together with O-1 (§2.1).

**C-2 · `setLocked()` was a second unguarded door** onto the same state as
`requestLock()`. Touch and XR engage movement through it, so guarding only
`requestLock()` (`src/player/fp-controls.ts:112`) left a path able to hand input back
while another subsystem owned it. Fixed at `src/player/fp-controls.ts:97` — taking the
lock is refused when `!enabled`, releasing is always allowed. Re-running the T2
input-ownership harness after the change: `CONTROL_GROUP_VALID=true`,
`AC7b_CLICK_BLOCKED=true`, `AC7a_RESTORED_ON_F2_OFF=true`.

**A third door is identified but NOT fixed — see §4.**

---

## 2.1 Follow-up repair — input ownership收斂 (`61d4206`, 2026-08-12)

Written after the audit closed, so it is reported separately rather than folded into
the verdicts above.

The structural root of T2 is that input ownership was a **boolean twelve call sites each
assigned to**. `stand()`, the sit handler, `setLocked()`, the OS/arcade/reader modes and
the editor adapter all wrote `controls.enabled` directly, and the adapter additionally
cached the previous value in `_prevEnabled` — so once another door had written the flag,
leaving the editor restored a stale one.

`src/player/input_owner.ts` (new) makes a **named owner** the state and the only writer
of `controls.enabled` / `interact.enabled`. A release is refused unless it is made in the
name of the current owner, which is what stops `stand()` from taking input back while the
editor holds it. All twelve direct assignments in `src/main.ts` now route through it, and
`_prevEnabled` is gone. `tools/gate/input_owner.test.ts` (18 assertions, `npm run
test:input-owner`) covers refusal, hand-back, the `controls.enabled === interact.enabled`
invariant, and a positive control that a legitimate transfer still succeeds.

**Independent re-verification** (`/tmp/v_ownership_after.mjs`, run `/tmp/own_after.out`,
2026-08-12) — written and run by the main thread, not by the agent that wrote the fix:

```
[1] pointer-lock detector   editor closed plCalls=1, editor open plCalls=0
    HUD: open="[EDITOR ON] F2 to disable"  closed="[EDITOR OFF] F2 to enable"
[2] C-1  CONTROL- KeyQ editor closed  "light" -> "light"  fired=false
         CONTROL+ KeyE editor closed  "light" -> "heavy"  fired=true
         CONTROL- KeyQ editor open    "heavy" -> "heavy"  fired=false
         TREATMENT KeyE editor open   "heavy" -> "heavy"  fired=false
[3] O-1  camera after E = {x:0.4, y:1.18, z:2}  SEATED=true
         HUD="[EDITOR ON]"  camera after S = {x:0.4, y:1.18, z:2}  (unmoved)
         plCalls after S + click = 0
[4] regression  HUD="[EDITOR OFF]"  plCalls=1   camera after S = {x:1.171, y:1.7, z:4}

POINTERLOCK_DETECTOR_VALID=true
LEAK_DETECTOR_VALID=true   LEAK_STILL_PRESENT=false
SEATED=true                O1_ESCAPE_STILL_PRESENT=false
INPUT_RETURNED_AFTER_EDITOR=true   STOOD_UP=true
```

Phase 4 is not decoration. The refactor's plausible failure mode is the mirror of the
bug — refusing to hand input *back* — so a run in which the editor never releases would
also show `O1_ESCAPE_STILL_PRESENT=false`. Phase 4 is what distinguishes "ownership held
correctly" from "input stuck": after F2 the click grabs the lock again and `S` actually
leaves the seat.

**Why this harness had to be rewritten.** The pre-fix detector
(`/tmp/v_interact_leak3.mjs`) found its aiming pose by sweeping the camera *with the
editor open* and waiting for an interaction prompt — that is, it steered by the very leak
under test. Once the leak closed no prompt ever appeared, the sweep ran to exhaustion and
the process died at `timeout 180` (exit 124). **That timeout is not evidence the leak is
fixed** and is not recorded as such. The replacement aims through the real look pipeline
instead: fake `document.pointerLockElement` and dispatch `pointerlockchange` so
`FpControls` believes it is locked (`src/player/fp-controls.ts:124`), then drive yaw and
pitch with `mousemove` deltas at the real sensitivity
(`src/player/fp-controls.ts:127-138`). That path behaves identically before and after the
fix, so one harness produces both readings.

Machine layer re-run independently after the refactor: `npm run verify` exit 0; gate
`check_wall_clip: PASS (607 meshes checked, 75 wall-touching, 75 matched to 75 baseline
+ 5 whitelist entries, 0 issues)`; 147 assertions across height_fog 47 / render_prefs 19
/ quality_live 9 / RoomState 25 / placement_audit 21 / editor_pick 8 / input_owner 18,
0 failed; the containment check still fires on `room.monitor.main`.

**Limitation of this section, recorded after the fact.** Everything above was measured on
one hand-back path: **`player → editor → player`**. That is the path the harness drove and
the only one the 18 assertions covered. It does **not** generalise to "input is correctly
returned to whatever owner held it". At `61d4206` the editor adapter called
`release('editor')` and took the parameter's `to = 'player'` default, so *every* hand-back
went to `player` regardless of who had been interrupted — a fact this section's evidence
could not have detected, because `player` was the only prior owner it ever tested. See
§2.2.

---

## 2.2 H11 — the `61d4206` repair returned input to the wrong owner (`1836cfd`, 2026-08-13)

**Timeline note.** H11 was found by a **cold review opened after this audit had closed**,
reading current code without the audit's claim list. It is recorded here as a later event.
Nothing in §1–§2.1 is rewritten to pretend it was known earlier: the §2.1 evidence was
correct for what it measured, and its blind spot is stated in that section rather than
edited out of it.

**The defect.** `61d4206` made `InputOwner` the single writer of `controls.enabled` /
`interact.enabled`, but `release(from, to = 'player')` carried a default, and the editor
adapter used it. So opening the editor on top of an already-open overlay and then closing
the editor handed input to `player` — not back to the overlay that was interrupted. The
player could then walk around underneath an overlay still on screen.

**Reachability had to be established before this was worth fixing.** Three overlays could
in principle precede the editor:

| Prior owner | F2 reaches the editor while it is open? | Why |
|---|---|---|
| `os` | **yes** | its window keydown listener (`src/pc/os.ts:133`) is **bubble** phase and never calls `stopPropagation()`, so F2 still reaches the editor |
| `arcade` | no | `src/world/arcade.ts:109` registers with `capture = true` and calls `stopPropagation()` at `src/world/arcade.ts:111` whenever `isActive`, so the editor's bubble-phase F2 listener never runs |
| `reader` | no | same shape — `src/player/bookreader.ts:63` capture, `src/player/bookreader.ts:65` `stopPropagation()` whenever `isOpen` |

So the only sequence a user can actually produce is the **OS-nested** one. `arcade` and
`reader` are dead branches of the same policy — real code paths, unreachable input
sequences. They are covered by focused tests below, and **not** claimed as live-verified.

**Why the obvious fix is worse than the bug.** Simply recording the previous owner and
restoring it turns a fail-open defect into a fail-closed one. If the OS is closed *while
the editor is open* (Escape reaches CyberOS, which closes; the editor stays on), restoring
`os` on editor-off hands input to an owner that has already left. That state has
`controls.enabled === false` **and** `interact.enabled === false`, and `enterOS` is
registered on the `interact` system — so the OS cannot be reopened to release the lock.
Nothing on screen indicates why. Only a page reload recovers. A visible wrong state
(walking under an overlay) is strictly preferable to an invisible dead one.

**The fix.** The previous owner is recorded on acquire, and at hand-back the **composition
layer** — `src/main.ts`, the only place that can see every overlay at once — samples
liveness and decides:

- `src/player/editor_handback.ts` (new) holds the policy as a pure function,
  `resolveHandbackTarget(previousOwner, live)`: `player → player`; `os`/`arcade`/`reader`
  → themselves if live, else `player`; `editor` → `player`. Being a free function rather
  than a closure inside `main.ts`'s dynamic import is what makes all ten branches
  unit-testable.
- `src/main.ts:1401` samples `{os: os.isOpen, arcade: arcade.isActive, reader:
  reader.isOpen}` and `src/main.ts:1406` calls `inputOwner.release('editor', target)`
  — in the **same
  synchronous block**, with no `await` between the sample and the release, so there is no
  window in which an overlay can change state after being read.
- `src/player/input_owner.ts` stays **overlay-blind**: it does not import, query, or know
  about `os` / `arcade` / `reader`, and gained no stack, no pending-owner slot and no
  overlay registry. It remains bookkeeping. The `to = 'player'` default was removed, so all
  four release sites (`src/main.ts:417`, `src/main.ts:435`, `src/main.ts:743`, and the
editor adapter at `src/main.ts:1406`) now name
  their target explicitly. Note that under `--experimental-strip-types` a removed default
  is not a compile error — it surfaces as a runtime `undefined` — which is why the removal
  is paired with test 7 asserting `release.length === 2`.

**Live verification** (`/tmp/v_handback_live.mjs`, Firefox, 2026-08-13). Two observables:
`controls` = a canvas click reaching `requestPointerLock` (spied); `interact` = pressing E
at the monitor reopening CyberOS. The second is also the soft-lock probe — under a stale
`os` owner it is impossible by construction. Detector validation ran first, in both
directions, and cross-checked a synthetic click against a real one with no overlay
present (`det_closed_real=true`, `det_open_real=false`); the synthetic dispatch is used in
the nested scenarios because the open `#cyberos` overlay intercepts real pointer events,
and `src/main.ts:143` has no `isTrusted` guard, so the code path under test is identical.

```
DETECTORS_VALID=true
S1  player -> editor -> player                          PASS  controls=true interact=true
S2  os(open) -> editor -> editor off -> os -> Escape    PASS  after editor off controlsOn=false
                                                              (input went to 'os', not 'player')
                                                              after Escape controls=true interact=true
S3  os(open) -> editor -> Escape closes os -> editor off PASS os.isOpen=false under [EDITOR ON];
                                                              after editor off controls=true interact=true
errors=[]
```

S2's `controlsOn=false` is the load-bearing reading: it is the one that would have been
`true` under the old default, and it is what distinguishes "handed back to `os`" from
"handed back to `player`". S3 is the soft-lock case, and it checks **both** flags, because
a fix that recovered `controls` alone would still strand the player with no way to jack in.

**`arcade` and `reader` are focused-test evidence only.** Their branches are exercised by
`tools/gate/input_owner.test.ts` against `resolveHandbackTarget` directly — active and
inactive for each. No live UI run is claimed for them, and none should be: the sequences
are unreachable, so any live run asserting them would be asserting something a user cannot
do.

`tools/gate/input_owner.test.ts` grew 18 → **49 assertions**, adding: the arity check on
`release`, all ten policy branches, S1/S2/S3 as state-machine sequences, and a **negative
control** (test 12) that bypasses the liveness check and reproduces the lock-up — owner
stuck at `os`, both flags false. Without it, the passing tests would not prove the liveness
check is what is doing the work.

Machine layer, re-run independently: `npm run verify` exit 0; gate `check_wall_clip: PASS`;
**194 assertions, 0 failed** across height_fog 47 / render_prefs 19 / quality_live 9 /
RoomState 25 / placement_audit 21 / editor_pick 8 / input_owner 49 / override_merge 16.

Published as `1836cfd52456dba7b4dc514e90d9ea10cecc2c5f`. CI run
[31622498663](https://github.com/klmtseng/cyberpunk-room/actions/runs/31622498663):
success, and read from the run log rather than the job name — the step expanded to
`npm run gate && npm run typecheck && npm test` and reported 194 assertions / 0 failed with
`GATE check_wall_clip: PASS`.

One process note, recorded rather than absorbed: the first attempt to publish was blocked
because an automatic snapshot hook had already committed these files under a different
identity. The commit was rebuilt from the identical tree under explicit authorisation —
equivalence proven by matching tree hash and an empty `git diff` between old and new — and
the hook was subsequently changed to refuse to snapshot any repository that has a
non-local remote.

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

**Closed at `61d4206`** by exactly that refactor; re-verified with the same detector
design in §2.1. Consequence 2 (the swallowed first keypress) was never separately
reproduced and is not claimed as fixed — the capture-phase listener at `src/main.ts:520`
still calls `stopPropagation()`; what changed is only that the `stand()` it triggers can
no longer take input ownership.

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

**Closed at `8f932ae`** (2026-08-12). The merge computation moved out of the editor
closure into a pure function, `computeOverrides()` in `src/editor/override_merge.ts:54`,
which walks `listEditableIds()` instead of the selection and writes every entity whose
live transform differs from its authored default. Per-entity semantics are unchanged:
six-decimal rounding, field-level diffing against authored, and deletion of entries that
match authored. Orphan ids in the file are preserved because only registry ids are
walked (`src/editor/override_merge.ts:61`). One behaviour deliberately changed: an id
whose authored transform cannot be looked up is now skipped with a console warning
rather than aborting the whole save, so one bad entity can no longer block saving every
other one — except for the *selected* entity, which still aborts
(`src/editor/editor.ts:346`), because that is the one the user is looking at.

`tools/gate/override_merge.test.ts` adds 16 assertions over six scenarios, including a
negative control (an all-unchanged input returns a record equal to `existing`).

**Honest limit on that test suite.** The tests do not reproduce the original bug. The
old code path lived inside the editor closure and was not unit-testable — that is why it
was extracted — and the scenario needs two registered editables, while the scene has
one. What the fix does is remove selection from the save computation as an *input*, so
the defect class is structurally impossible rather than tested against; the tests verify
that the per-entity semantics survived the move. A true end-to-end reproduction still
requires a second editable, and is not claimed here.

Integration was checked at the level available: `npm run verify` exit 0 with 163
assertions across eight suites, and the T2 browser harness (§2.1) re-run unchanged after
this commit — `LEAK_STILL_PRESENT=false`, `O1_ESCAPE_STILL_PRESENT=false`,
`INPUT_RETURNED_AFTER_EDITOR=true`, `errors=[]`. A live `Ctrl+S` was deliberately **not**
run, because it rewrites `overrides.json`, which this audit is not permitted to modify;
so the save round-trip itself is unverified at runtime for this commit.

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

## 5. T5 — the CI claim, withdrawn at audit time and later made true

### 5a. As audited (`773407e`) — withdrawn

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

### 5b. Made true at `f73406c` (2026-08-12) — now PASS

The push happened later, as a separately authorised step. **The timeline matters and is
not being flattened:** at audit time, and at every commit up to and including `6397a26`,
this claim was false — the workflow had zero runs. It became true only when a run
actually executed and succeeded.

Run: <https://github.com/klmtseng/cyberpunk-room/actions/runs/31568529846>
`conclusion: success`, `event: push`, `headSha: f73406cbcfe934658e4f5dd5c3a4955f8311f756`
— matching the pushed commit. Job `verify`, 17s. **This was the workflow's first
execution in the repository's history.**

Verified from the run log rather than from the job's name, because a job called "verify"
passing is not evidence that `npm run verify` ran. The step `Run npm run verify` expanded
to `npm run gate && npm run typecheck && npm test` and produced:

```
GATE check_wall_clip: PASS (607 meshes checked, 75 wall-touching,
  75 matched to 75 baseline + 5 whitelist entries, 0 issues)
Containment: 1 editable(s) tested against room envelope [room.monitor.main]
height_fog 47 · render_prefs 19 · quality_live 9 · RoomState 25
placement_audit 21 · editor_pick 8 · input_owner 18 · override_merge 16
   → 163 assertions, 0 failed
```

Vercel deployment status was explicitly **not** accepted as evidence for this claim; only
the CI job running that command counts.

Two notes recorded rather than silently absorbed:

- Getting here required rewriting two unpushed commits (`c3b3f65`, `6397a26`) whose
  author email was a real address rather than the repository's noreply identity — a
  defect introduced by the operator during this audit, caught by `pre_public_gate.sh`
  G1/G4, and repaired only under explicit authorisation. Trees, messages, names and
  ordering were proven unchanged before pushing.
- The push proceeded under a **one-time, narrow exemption** for `pre_public_gate.sh` G5,
  which rejects `20399135+klmtseng@users.noreply.github.com` — GitHub's numeric noreply
  form, present on two pre-existing remote commits and not introduced by this push. In
  that script — which lives outside this repository, so the line references below are not
  citations a reader of this repo can resolve — the G5 branch at line 242 compares
  against one allowlist value while the G1 branch at line 138 compares against two, so
  the address is simultaneously in the script's own allowlist variable and rejected by
  G5. That script bug and the
  deprecated `actions/*@v4` Node 20 annotation are both left as separate maintenance
  work; neither is fixed here.

---

## 6. Reproduction status

Nothing above is asserted without a reproduction. Explicitly:

| Finding | Reproduced | Control validated |
|---|---|---|
| P1-A gate blind spot | yes — 5 escape routes, before/after | yes — 2 in-room controls still PASS, WALL-NEW still fires |
| P1-A secondary (blank verdict) | yes — observed `FAIL (1 issue(s): )` | n/a |
| P1-B selection broken | yes — treatment/control console capture | yes — control selects successfully |
| P1-C-1 interact leak | yes (detector v3); **closure re-verified at `61d4206`** | yes — unbound key reads false in both states, bound key fires editor-closed |
| P1-C-2 `setLocked` door | yes — post-fix harness re-run | yes |
| H11 wrong hand-back owner (§2.2) | yes — S2 live: after editor-off `controlsOn=false`, i.e. input went to `os`, which the pre-fix default could not produce. Soft-lock variant reproduced in test 12 by bypassing the liveness check | yes — detectors validated in both directions, synthetic click cross-checked against a real click; **`arcade`/`reader` branches are focused-test only, their live sequences are unreachable** |
| O-1 `stand()` escape | yes (harness v3, after two invalid versions); **closure re-verified at `61d4206`** | yes — editor-open-not-seated reads 0, editor state read from HUD text not presence, plus a hand-back control (§2.1 phase 4) |
| O-2 micro-scale | yes — exit 0 at two scales, exit 1 at scale 40 | yes |
| O-3 save scope | code-pinned, not runnable today (one entity exists); fix at `8f932ae` covered by unit tests only, **the original defect was never reproduced** | yes — an all-unchanged input returns `existing` unchanged |
| O-4 orphan validation | yes — malformed doc, gate output captured | n/a |
| O-5 baseline keys | attempted; reviewer's prediction **did not** reproduce | yes |
| T4 transaction | yes | yes — both FAIL and PASS observed |
| T5 CI | yes — four independent checks at audit time; closure verified from the run log of CI run 31568529846, not from the job name | yes — the log shows the command expanding and its output, so a passing job named "verify" alone was not accepted |

Verification of the fixes themselves: `npm run verify` exit 0 — gate PASS with
`Containment: 1 editable(s) tested against room envelope [room.monitor.main]`, typecheck
clean, and 129 assertions across six suites (height_fog 47, render_prefs 19,
quality_live 9, RoomState 25, placement_audit 21, editor_pick 8), 0 failed. After
`61d4206` the same command is exit 0 with 147 assertions across seven suites (the six
above plus input_owner 18). After `1836cfd` it is exit 0 with **194 assertions across
eight suites, 0 failed** (input_owner 18 → 49, plus override_merge 16); 194/0 is the
current baseline, and it is the figure CI reproduced on run 31622498663.

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
