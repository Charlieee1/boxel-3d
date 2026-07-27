# Level Editor Guide
Disclaimer: This is written by AI.
## Core Workflows

### Selecting & Placing Blocks
1. **Click empty space** → place a new block at the current Z plane (see **Current Z** textbox in toolbar)
2. **Click a block** → select it (turns white)
3. **Double-click a block** → enter fast-build mode (see "Fast Build" section below)
4. **Drag on a block** → translate it in the current plane

### Current Z (Spawn Height)
- The **Current Z** textbox in the toolbar controls where new blocks spawn when you click empty space
- Press **0** to reset all selected blocks (and the spawn plane) back to the current Z height
- Type a new value and press Enter to change the spawn height

### Transform Modes (Single Block)
After selecting a block, use these keys to enter different transform modes:

| Key | Mode | What it does |
|---|---|---|
| **T** or **G** | Translate | Drag to move the block in the current plane (XY by default) |
| **S** | Scale | Drag to enlarge/shrink the block uniformly (or see "Scale Mode" under Multiselect) |
| **R** | Rotate | Drag to spin the block; press **R** again to toggle showing only the hovered axis |
| **F** | Putty | Drag individual faces to resize specific dimensions (X/Y/Z independently) |
| **Shift** (held) | Rotate-lock | While rotating, Shift locks rotation to a single axis and shows that axis only |

### Cancelling & Confirming Transforms
- **C** → confirm the current transform (save it to history)
- **V** → cancel and revert to the pre-transform state
- **Escape** → also cancels

---

## Multiselect

### Entering Multiselect
- **M** → toggle multiselect mode

### Selecting Multiple Blocks
In multiselect mode, you can:
- **Click a block** → add/remove it from the selection (toggles)
- **Drag a box** → select all blocks inside the box (enters "refine" stage)
  - The overlay will show "Multiselect" + "Box Select"
  - Drag blocks inside the box to refine the selection
- **Click outside the box** → confirm the selection and enter "transform" stage

### Transform Multiple Blocks Together
Once you have a selection and have entered the transform stage, you now transform the entire group as one unit:

| Key | What it does |
|---|---|
| **T** or **G** | Translate the entire group together |
| **S** | Scale the entire group (scales each object proportionally from the group's center) |
| **R** | Rotate the entire group together around its center |
| **D** (while dragging with Translate active) | Stamp a duplicate at the current drag location (without ending the drag) |

### Scale Mode (Multiselect Only)
When translating/rotating/scaling a multiselect group, you can press **S** to cycle through scale modes:

1. **Scale (Unlocked)** - scale freely on all three axes independently
2. **Scale (Locked XY)** - lock X and Y to scale together; Z scales independently
3. **Scale (Locked XYZ)** - lock all three axes to the same factor (uniform scaling)

Each mode is shown on a third line in the top-right overlay. The selection box itself will scale correctly in locked modes.

### Other Multiselect Actions
- **X** → delete all selected blocks
- **I** (Ctrl+I or Cmd+I on Mac) → toggle intangibility for all selected blocks
- **Escape** or **V** → cancel the transform and revert all changes

---

## Flip Selections

Flipping works on both single blocks and multiselect groups. Use a **chord** (two key presses):

| Chord | Plane | What it does |
|---|---|---|
| **B, B** (press B, then B again) | XZ | Flip the selection around the YZ plane (flip left-right) |
| **B, N** (press B, then N) | YZ | Flip the selection around the XZ plane (flip front-back) |

- Pressing **B** arms the chord indefinitely - there's no time limit, so you can wait as long as you want before pressing the second key. A "Flip (Pending)" indicator shows in the top-right overlay while armed.
- Pressing any other key cancels the pending chord

---

## Force Build

Press **N** (with no pending B chord) to toggle force-build mode. While active:
- **Click on top of an existing block** → places a new block there instead of selecting the existing one
- The existing block is left untouched
- Shift+click copy-color is unavailable while force-build is on (clicking always builds instead) - this also copies opacity now, see "Property Edits (Toolbar)" below
- Press **N** again to turn it off

Note: if you press **B** first (starting the flip chord), the next **N** completes the **B, N** flip instead of toggling force-build.

---

## Deselect

Press **Shift+N** to deselect the currently selected block - the same as clicking on empty space (the void).

---

## Level Properties

Click the **Level Properties** icon in the top toolbar (right of the Current Z textbox, left of Settings) to open a popup of level-wide properties. Every field applies immediately as you change it - there's no separate save step, and each change is its own undo/redo entry. Each row has a trash icon that resets that property back to its default.

| Property | Control | Default | What it does |
|---|---|---|---|
| **Zoom** | Slider (80-280) | 180 | The level's default camera distance - used when entering/playing the level and by the **[** camera-reset key. A playthrough is only eligible for a verified run if its zoom matches this value (or 180 if unset), the same way debug mode invalidates a run |
| **Theme** | Dropdown | classic | Switches the level's visual theme and recolors any blocks still using the previous theme's default color - same behavior as before, just relocated into this popup |
| **Default Block Color** | Color picker | current theme's color | Sets the color newly-placed blocks use; existing blocks are not retroactively recolored. Persists with the level and survives theme switches until cleared (this replaces the old standalone toolbar color swatch) |
| **Disable Manual Respawn** | Checkbox | Off | When on, silently blocks the player's manual respawn-to-checkpoint (the **C** key / checkpoint button during play). Automatic respawn after death is unaffected - this only gates the manual, player-triggered kind |
| **Level UI Text** | Textarea | Empty | Overlay text/HTML shown on screen while playtesting or playing the level (hidden while editing). Rendered via `innerHTML`, so tags like `<b>` or `<br>` work |

---

## Camera Controls

| Key | What it does |
|---|---|
| **[** | Reset camera Z distance and rotation back to default (X/Y pan is preserved) |
| **]** | Open a popup to type an exact camera X/Y position |

---

## Cut Out Blocks

1. **Select the block** you want to cut from (click it normally)
2. **Press /** to arm cut-out mode
3. **Click a second block** (the "cutter") - its X/Y footprint is subtracted from the first block

Notes:
- Only works on axis-aligned blocks (no rotation) - rotated blocks are ignored
- Cuts along X/Y only; up to 4 new blocks replace the original to fill in the remaining shape
- The cutter block itself is not modified
- Clicking empty space, clicking the original block again, or pressing **V** cancels without changes

---

## Hover Preview Mode

Press **H** to toggle hover-preview mode (applies to both single blocks and multiselect).

When active:
- **Move your mouse over a block** → a cyan gizmo appears on that block (does not select it)
- **Click the gizmo or drag it** → temporarily drag that block in transform mode
- **Move your mouse away** from both the block AND the gizmo → the gizmo disappears and the block reverts to its original state
- **Press C** while dragging → confirm the change
- **Press V** while dragging → revert and keep the gizmo visible for another attempt

Hover-preview does NOT interrupt your current selection or workflow; it's a side-channel for quick adjustments.

---

## Fast Build Mode

Press **K** to toggle fast-build mode. In this mode:
- **Click empty space** → create a new block (instead of just dragging to place it)
- **Drag on empty space** → create and stretch a block along one or more axes
- The overlay shows "Fast Build" + a stage (Create, Scale, Rotate, Move)
- Use **T/S/R** to switch stages mid-drag
- **C** confirms, **V** cancels

Fast-build is useful for quickly creating and shaping blocks without switching modes manually.

---

## Thin Build Mode

Press **L** to toggle thin-build mode. In this mode:
- Blocks created or dragged are created as very thin (0.1 units in the vertical/Z axis) slabs
- Useful for platforms and floor/ceiling details
- Toggle it off with **L** again to return to normal sizing

---

## Vertex/End Snapping

Press **,** (comma) to cycle through three snap modes, in order: **Normal** (off - plain grid snap, no overlay) → **Vertex Snap** (corners only) → **Centre Snap** (end-centers only) → back to **Normal**. Whichever of Vertex Snap/Centre Snap is active replaces the plain grid snap entirely (they never combine with grid snap, and never combine with each other):

- **Vertex Snap:** new/dragged blocks snap to nearby blocks' **corners** only, in full 3D - end-centers are never considered in this mode
- **Centre Snap:** new/dragged blocks snap to nearby blocks' **end-centers** only, in full 3D - corners are never considered in this mode
- An "end-center" only exists on a clearly elongated block - looking at just its footprint (width/length, ignoring depth), the block needs to be more than twice as long as it is wide. Such a block has 2 end-centers, one at each end, inset from the block's own edge by half its width. A squarish block (not more than twice as long as wide) has no end-centers - Centre Snap instead uses that block's own plain center point as a stand-in
- Works everywhere you'd normally place or drag a block: clicking to place, drag-to-move (**Q**), fast build, thin build's initial placement point and its free end while dragging the strip, and translate/scale/putty (**F**) on a single selected block - thin build's angle is never separately snapped/rounded, though; it's simply whatever direction falls out of the snapped free-end position
- **Corners only snap to other corners in Vertex Snap mode, and end-centers only snap to other end-centers in Centre Snap mode - the two never mix.** Considers every corner (in Vertex Snap mode) or every end-center/center-point stand-in (in Centre Snap mode) on the block you're moving against every matching candidate on every other block, and snaps to whichever pair is closest overall - not just the nearest match for a single fixed point
- If nothing is close enough to snap to, the block just uses its raw (unsnapped-to-grid) position for that point
- A "Vertex Snap" or "Centre Snap" indicator shows in the top-right overlay while either mode is active; no indicator in Normal mode
- Press **,** again to advance to the next mode in the cycle

Handy for lining up ramps, stacking blocks corner-to-corner, or butting two blocks exactly end-to-end (this is also how the chain physics feature below detects which blocks are touching - use Centre Snap for lining up end-to-end).

---

## Editor Settings (Grid & Snap Increment)

Two settings live in **Settings → General**, but only appear while you're in the level editor or level manager:

- **Editor Snap** - the base grid increment (0-16, in steps of 4) that placement/dragging snaps to when Vertex/Centre Snap above isn't active. A value of 0 is coerced to 1
- **Show Grid** - toggles a visible grid overlay on the current Z plane, drawn at the level's block size (16 units) per cell, so you can see the placement grid instead of only feeling it

Both are editor-only - neither has any effect during actual gameplay.

---

## Custom Rotation Pivot

By default, rotating a block spins it around its own center (or, for a multiselect group, around the group's center). You can override this with a custom pivot point:

1. Press **.** (period) to arm pivot placement
2. Click anywhere in the viewport - that 3D point becomes the pivot (a small orange marker shows where it is); your current selection stays selected, it does **not** get deselected by this click
3. Switch to Rotate mode (**R**) and rotate as usual - the selection now spins around the pivot instead of its own center

The pivot works for both a single selected block and a multiselect group's rotation.

- The pivot **stays active across multiple rotations** - you don't need to re-place it each time
- It's cleared when you **deselect** the current block/group, including by **selecting a different block**
- It's also cleared once you **actually drag** a translate or scale (or putty) transform to completion - just switching to Translate/Scale mode without dragging anything does **not** clear it
- Press **.** again at any time to place a new pivot elsewhere

---

## Chain Physics

Let a set of touching blocks settle into a natural hanging/sagging shape under gravity (like a rope bridge sagging, or a chain hanging between two points), then freeze that shape permanently, with **P**. This is a one-time authoring aid, not a persistent feature - once it's done, the result is just ordinary static blocks positioned to look like a settled chain. It reuses the same box-select flow as Multiselect (**M**), just with a different last step:

1. Press **P** - this enables box select, exactly like starting Multiselect
2. Drag a box around the blocks you want in the chain
3. Press **C** to confirm the box selection and move to the refine stage - click individual blocks to add/remove them one at a time (same as Multiselect's refine stage)
4. Press **C** again to move to anchor-marking - every selected block highlights cyan; click any of them to flag it as a **static anchor** instead (highlights orange), click again to unflag it
5. Press **C** a third time to confirm (needs at least 2 blocks), or **V**/Escape at any stage to cancel

What happens on confirm:
- Every block you added becomes **dynamic** (affected by physics) by default, **except** anchors, which stay static - this overrides whatever pinned/unpinned state the blocks had before
- Blocks whose touching ends line up exactly get linked with a temporary physics joint at that point
- If any blocks linked, the camera freezes and the blocks briefly vanish while a "Loading..." overlay shows - behind the scenes, physics runs forward invisibly (usually well under a second) until the shape stops moving
- Once settled, every block's final position/rotation is baked in as its new permanent position and it's frozen static (scale is never changed by this) - the temporary joints are then discarded, so there's no ongoing physics or line/rope visual afterward, and nothing extra is saved with the level beyond the blocks' new positions
- If nothing lines up closely enough to link, blocks just become dynamic/static per the anchor flags with no settle step (same as before)
- Each dynamic block's mass during the settle is its full 3D volume (width x height x depth), not just its 2D footprint - so a block's Z depth (or any dimension) is a way to intentionally make a segment heavier/lighter and change how much it sags relative to its neighbors

Notes:
- Only axis-aligned (no X/Y tilt) blocks can be linked - same restriction as Cut Out
- Two blocks only link if their ends (or, for squarish blocks with no end-centers, their plain centers) touch *exactly* (accounting for tiny floating-point rounding) - use Vertex/End Snapping above to line them up first
- Linking only ever considers blocks from the selection you just confirmed - it never scans the whole level, so unrelated touching blocks elsewhere are left alone
- Running **P** again elsewhere in the level (or again over the same blocks) is a fresh, independent settle each time - there's no persistent chain concept left to add to or rescan

---

## Set Temporary Start Position

When a **checkpoint** block is selected, its property panel gets an extra button (the play-icon one) - "Set as start position". Clicking it:

- Sets a temporary spawn point at that checkpoint's position/rotation, used only for playtesting from inside the editor
- Pressing **Play** will spawn you there instead of the level's real player start, until you exit the level or load a different one
- Pressing **R** to Retry mid-playtest also respawns you at the temp spawn point
- The **"Restart Level" toolbar button** (rewind icon) is different - it's meant to fully exit playtesting and return to a clean editor state, so it does **not** re-apply the temp spawn override; it always puts everything back to the level's real saved state
- It's **never saved** with the level - the real player start position is completely unaffected, even momentarily, so it can't accidentally get picked up by autosave or anything else that reads the player's position

Useful for quickly testing a specific section of a level without playing through from the very beginning each time.

---

## Property Edits (Toolbar)

### Coordinates Input
- **Click the coordinates textbox** (top toolbar, shows "X, Y, Z")
- Type new coordinates and press Enter to move the selected block
- The textbox auto-updates as you drag blocks

### Current Z Input
- **Click the Current Z textbox** (top toolbar, right of coordinates)
- Type a new Z value and press Enter
- All newly placed blocks will spawn at this height
- Press **0** while a block is selected to reset the spawn plane to that block's Z

### Block Properties Panel
When a block is selected, the left toolbar column shows two groups separated by a thin line: **properties** on top, **operations** (transform/duplicate/delete) below. Which property controls appear depends on the selected block's type:

| Block Type | Pin | Color | Friction | Opacity | Text | Death Block | Extra |
|---|---|---|---|---|---|---|---|
| Cube | Yes | Yes | Yes | Yes | No | Yes | - |
| Tip | Yes | Yes | No | Yes | Yes | No | - |
| Bounce | Yes | Yes | Yes | Yes | No | No | - |
| Checkpoint | Yes | Yes | No | Yes | No | No | Set as start position |
| Spike | Yes | Yes | Yes | Yes | No | No | - |
| Resize | Yes | Yes | No | Yes | No | No | - |
| Direction | Yes | Yes | Yes | Yes | No | No | - |
| Gravity | Yes | Yes | No | Yes | No | No | - |
| Grapple | Yes | Yes | Yes | Yes | No | No | - |
| Finish | Yes | Yes | Yes | Yes | No | No | - |
| Reset | Yes | Yes | No | Yes | No | No | Reset Properties button |
| Control | Yes | Yes | No | Yes | No | No | - |
| Power | Yes | Yes | No | Yes | No | No | - |
| Teleport | Yes | Yes | No | Yes | Yes | No | - |
| Player | No | No | Yes | Yes | No | No | - |

Operations (translate/scale/rotate/putty/duplicate/delete) are always shown for every type once a block is selected.

### Transform Mode Buttons
- **Toolbar icons** (translate/scale/rotate/putty) can be clicked instead of pressing keys
- **Shift** while rotating locks to a single axis (same as holding Shift during rotation)

### Friction Slider
- **Drag the slider** next to the friction icon to set block friction (0 to 1, in steps of 0.25)
- Only available when a block is selected and its type shows Friction in the table above
- Disabled if the block is pinned (static)

### Opacity Slider
- **Drag the slider** next to the opacity icon to set block transparency (0 to 1, in steps of 0.01) - 0 is fully invisible, 1 is fully opaque
- Available for every block type, including the player
- Shift+click copy-color (see "Force Build" above) also copies opacity from the source block onto the target

### Death Block Toggle
- **Click the skull icon** to toggle a Cube block into a death block - Cube-only, hidden for every other block type
- A death block's hitbox becomes a sensor: touching it kills the player instantly instead of colliding physically
- Only takes effect for blocks placed at Z = 0 (same as normal collision blocks) - off-plane death blocks behave like any other decorative block

### Pin Button
- **Click the pin icon** to toggle whether a block is static (pinned)
- Static blocks don't fall and can't be pushed by the player

---

## Reset Block Properties

Select a **Reset** block and click the gear icon in its properties row to open the **Reset Block Properties** popup - a checklist of exactly what that reset block resets when the player touches it. Each checkbox applies immediately and creates its own undo/redo entry; there's no confirm step.

| Property | Default |
|---|---|
| Size | On |
| Player Mode | On |
| Force | On |
| Rotation (Z only) | Off |
| Velocity | Off |
| Angular Velocity | Off |
| Player Checkpoint | Off |
| Infinite Jump Mode | On |

The default combination (Size, Player Mode, Force, Infinite Jump Mode) matches how Reset blocks always behaved before this popup existed - only change the boxes if you want a specific reset block to behave differently from that.

---

## Special Keys & Shortcuts

| Key | What it does | Context |
|---|---|---|
| **0** | Reset selected block(s) to current Z height | Always (any selection) |
| **A** | Open block-type picker (4×4 grid) | Always |
| **D** | Duplicate selected block (with offset) | Single or multiselect (non-dragging) |
| **X** | Delete selected block(s) | Always (any selection) |
| **I** | Toggle intangibility | Single or multiselect |
| **Ctrl+Z** | Undo last action | Always |
| **Ctrl+Shift+Z** | Redo last undone action | Always |
| **Ctrl+S** | Save level | Always |
| **Escape** | Cancel current transform or dialog | During transform or picker |

---

## Overlay Text (Top-Right Corner)

The overlay shows the current editor state in 1–3 lines:

### Line 1 (Blocking State)
- **Multiselect** - you are in multiselect mode
- **Fast Build** - you are in fast-build mode
- **Thin Build** - you are in thin-build mode
- **Cut Out** - you've armed cut-out mode and are waiting for a cutter block
- **Set Pivot** - you've armed custom pivot placement and are waiting for a click
- **Chain** - you're building a chain (reuses Multiselect's Box Select/Refine stages, then Mark Anchors, then C to confirm)
- (Only one of these at a time; it disappears when you exit)

### Independent rows (can appear alongside anything else)
- **Force Build** - force-build mode (**N**) is on
- **Vertex Snap** - vertex/end snapping (**,**) is in Vertex Snap mode (corners only)
- **Centre Snap** - vertex/end snapping (**,**) is in Centre Snap mode (end-centers only)
- **Flip (Pending)** - you pressed **B** and it's waiting for a second **B** or **N**

### Line 2 (Stage, within Multiselect or Fast Build)
For **Multiselect**:
- **Box Select** - dragging to select blocks with a marquee box
- **Refine** - clicking/dragging to refine the box selection
- **Transform** - actively transforming the selected group

For **Fast Build**:
- **Create** - defining the initial block shape
- **Scale** - resizing the block
- **Rotate** - rotating the block
- **Move** - repositioning the block

### Line 3 (Scale Mode, only during Multiselect Transform + Scale)
- **Scale (Unlocked)** - free scaling on all axes
- **Scale (Locked XY)** - X and Y locked together, Z independent
- **Scale (Locked XYZ)** - all axes locked together (uniform)

---

## No Ambiguity: Complete Keybind Reference

| Key(s) | Mode | Action | Result |
|---|---|---|---|
| **0** | Any | Reset spawn plane | Selected block(s) move to current Z; spawn plane resets to current Z |
| **A** | Any | Open block picker | 4×4 grid of block types appears; hover to preview, click to select |
| **B, B** | Any | Flip XZ | Flip around YZ plane (left-right) |
| **B, N** | Any | Flip YZ | Flip around XZ plane (front-back) |
| **C** | Transform active | Confirm | Save transform to history, exit transform mode |
| **D** | Single or Multiselect | Duplicate | Create a copy offset by a fixed amount (or stamp if dragging in translate mode) |
| **V** | Transform active | Cancel | Revert to pre-transform state, stay in same mode |
| **X** | Any | Delete | Remove selected block(s) from level |
| **F** | Single | Enter Putty | Drag faces to resize individual X/Y/Z dimensions |
| **G** or **T** | Any | Translate | Drag to move in current plane |
| **H** | Any | Toggle Hover Preview | Enable/disable gizmo on hover (drag without selecting) |
| **I** (no Ctrl) | Any | Toggle Intangibility | Block becomes pass-through or solid |
| **K** | Any | Toggle Fast Build | Quick block creation and shaping mode |
| **L** | Any | Toggle Thin Build | New blocks are very thin (good for platforms) |
| **M** | Any | Toggle Multiselect | Enable/disable box-select and group transform |
| **N** | Any | Toggle Force Build | Clicking on a block builds a new one instead of selecting it (no effect if a B chord is pending) |
| **Shift+N** | Block selected | Deselect | Deselects the current block, same as clicking on empty space |
| **[** | Any | Reset Camera | Camera Z distance and rotation reset to default; X/Y pan preserved |
| **]** | Any | Set Camera XY | Opens a popup to type an exact camera X/Y position |
| **/** | Block selected | Arm Cut Out | Click a second block to subtract its footprint from the selected block |
| **,** | Any | Cycle Vertex/End Snap | Cycles Normal → Vertex Snap (corners only) → Centre Snap (end-centers only) → Normal; placement/drag points snap accordingly instead of the grid |
| **.** | Any | Arm Custom Pivot | Next click sets a rotation pivot for the current selection |
| **P** | Any | Arm Chain Creation | Box-select like Multiselect; C confirms box select, C again confirms refine into anchor-marking, C a third time builds the chain |
| **R** | Single | Rotate | Drag to spin; press R again to toggle axis visibility |
| **S** | Single or Multiselect | Scale or Cycle Scale Mode | Single: uniform scale; Multiselect + Transform: cycle through lock modes |
| **Ctrl+S** | Any | Save | Save current level |
| **Ctrl+Z** | Any | Undo | Revert last action |
| **Ctrl+Shift+Z** | Any | Redo | Restore last undone action |
| **Escape** | Any | Cancel/Close | Exit transform, close picker, cancel dialog |
| **Shift** (held) | Rotate active | Lock to axis | Rotation snaps to single axis; shows that axis only |

---

## Edge Cases & Clarifications

### What is "Current Z"?
- A global plane height used for clicking to place new blocks
- Pressing **0** with a block selected moves that block to the current Z and resets the plane to that height
- Allows building at different vertical levels without manually repositioning blocks

### How does D (duplicate) work mid-drag?
- Only in **Translate mode** during **Multiselect**
- While dragging the group, press **D** to stamp a copy at the current drag location
- The original continues dragging; you now have two groups at different positions
- Useful for repetitive patterns (corridors, chains, etc.)

### What's the difference between V (cancel) and Escape?
- **V** cancels the current transform only, leaving you in the same mode
- **Escape** cancels the transform AND exits the mode entirely

### Can I rotate around a different point?
- Yes - press **.** to place a custom pivot point, then rotate as usual (see "Custom Rotation Pivot" above)
- Without a custom pivot set, rotations default to the object's own center (or group center for multiselect)

### How does friction work?
- A slider on the toolbar (0 to 1, steps of 0.25)
- Determines how much the player slows down when sliding on the block
- 0 = frictionless ice; 1 = full grip (player stops immediately)

### Are there other block types besides cubes?
- Yes: tip, bounce, checkpoint, spike, resize, direction, gravity, grapple, finish, reset, control, power, teleport
- Select via the **A** key block-type picker or toolbar buttons
- Each has different gameplay properties

---

## Build & Test

- **npm run dev** - start the dev server (automatically watches and rebuilds)
- **npm run build** - build a production bundle
- **npm run build-android** - build an Android app
- **npm run build-tauri** - build a desktop app

---

End of guide. Happy editing!
