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
- Shift+click copy-color is unavailable while force-build is on (clicking always builds instead)
- Press **N** again to turn it off

Note: if you press **B** first (starting the flip chord), the next **N** completes the **B, N** flip instead of toggling force-build.

---

## Deselect

Press **Shift+N** to deselect the currently selected block - the same as clicking on empty space (the void).

---

## Default Block Colour

A color swatch in the toolbar (next to the theme picker) sets the default color used for newly-placed blocks:

- **Click the swatch** to open the color picker and choose a new default block color
- Applies to **new blocks only** - existing blocks in the level keep their current colors and are not retroactively recolored
- Overrides the current theme's default color for new blocks until changed
- **Saved with the level** (not a global/session setting) - it persists in the level file and is restored when the level is reopened
- Switching themes keeps your custom default color if one is set; otherwise the swatch reflects the new theme's default color

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

### Transform Mode Buttons
- **Toolbar icons** (translate/scale/rotate/putty) can be clicked instead of pressing keys
- **Shift** while rotating locks to a single axis (same as holding Shift during rotation)

### Friction Slider
- **Drag the slider** next to the friction icon to set block friction (0 to 1, in steps of 0.25)
- Only available when a block is selected
- Disabled if the block is pinned (static)

### Pin Button
- **Click the pin icon** to toggle whether a block is static (pinned)
- Static blocks don't fall and can't be pushed by the player

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
- (Only one of these at a time; it disappears when you exit)

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
| **B, B** (within 400ms) | Any | Flip XZ | Flip around YZ plane (left-right) |
| **B, N** (within 400ms) | Any | Flip YZ | Flip around XZ plane (front-back) |
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
- Not yet in the current implementation (item #24 in backlog: "Rotation around offset point")
- Currently, rotations are always around the object's center (or group center for multiselect)

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
