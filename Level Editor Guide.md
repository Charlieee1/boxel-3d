# Level Editor Guide
Disclaimer: This is written by AI.

Each section is a sequence of steps: **what you press → what you do → what happens**. Keys only work while the level is paused (not playtesting) and no popup is open, unless stated otherwise. Experienced builders can jump to the [keybind summary](#10-keybind-summary).

---

## 1. Camera & Mouse

| Input | Result |
|---|---|
| Left-drag / middle-drag | Pan the camera |
| Right-drag | Rotate the camera |
| Mouse wheel | Zoom in/out |
| **[** | Reset the camera: centred on the player, unrotated, at the level's zoom |
| **]** | Popup to type an exact camera X/Y (the view direction is kept) |

---

## 2. Placing, Selecting, Deleting

The **Draw** tool (pencil) is active by default.

| You do | With nothing selected | With a block selected |
|---|---|---|
| Left-click empty space | Places a new block of the current type, at **Current Z** | Deselects (click again to place) |
| Left-click a block | Selects it (gizmo appears) | Selects that block instead |
| Right-click a block (no drag) | Deletes it | Deletes it |

- **Erase** tool (eraser icon): left-click deletes blocks until you switch back to Draw.
- **Shift+N** deselects, same as clicking empty space.
- **X** deletes the selected block.
- **Choose the block type** with the left toolbar column (see [Block Types](#block-types)) or by holding **A**:
  - With a block selected, picking a type **changes that block** to the new type.
  - New blocks always use the last type picked.
- **Hold A** → a 4×4 grid appears → hover a tile to preview it on the selected block → release A to apply it (one undo step). Release without hovering a tile to change nothing.

### Block Types

| Type | When the player touches it |
|---|---|
| Basic | Solid block (or a death block, see section 9) |
| Tip | Shows its text in a popup, then disappears |
| Bounce | Launches the player; a taller block bounces harder |
| Checkpoint | Saves the respawn point |
| Spike | Kills the player |
| Resize | Sets the player's size to the block's size |
| Direction | Pushes the player in the direction the block faces |
| Gravity | Rotates gravity to match the block's rotation |
| Grapple | Switches the player to grapple mode (rope) |
| Finish | Completes the level |
| Reset | Resets player state; choose what with its gear button (section 9) |
| Control | Switches the player to control mode (move with left/right) |
| Power | Gives unlimited jumps |
| Teleport | Moves the player to the `X, Y` written in the block's text |

### Current Z
The **Current Z** textbox (top toolbar) is the depth new blocks are placed at.
- Type a value → Enter → new blocks now spawn at that Z.
- Select a block → press **0** → that block moves to Current Z.
- Only blocks at Z = 0 collide with the player. Anything else is decoration.

---

## 3. Moving & Shaping a Block

Select a block → pick a tool → drag the gizmo.

| Key | Tool | Drag result |
|---|---|---|
| **T** or **G** | Move | Moves the block |
| **S** | Scale | Resizes the block |
| **R** | Rotate | Rotates the block. Press **R** again to show/hide the X/Y axes |
| **F** | Putty | Drag an end point to stretch and turn the block, or drag its line to move it. Hold **Shift** while dragging an end to keep the angle and only change the length |
| Hold **Q** | Drag-move | Grab any block under the cursor and slide it, no selection needed |

- **Duplicate:** **D** → a copy appears one block above the original, and the copy is selected.
- **Repeat a duplication:** hold **Left Shift** and drag a block with the Move gizmo → a copy is left behind at the start point. Then press **D** → another copy appears at that same offset. Repeat as needed. A normal drag without Shift resets **D** back to one block above.
- **Copy colour:** select block A → **Shift+click** block B → B gets A's colour, opacity and death-block setting.
- **Flip:** press **B** → overlay shows *Flip (Pending)* → press **B** (flip left-right) or **N** (flip front-back). Any other key cancels the flip.
- **Intangible:** **I** → a block at Z = 0 stops colliding (becomes decoration). Press **I** again to make it solid.
- **Exact position:** with a block selected, type `X, Y, Z` into the coordinates box → Enter.

### Custom rotation pivot
1. Select a block (or a multiselect group).
2. Press **.** → overlay shows *Set Pivot*.
3. Click anywhere → an orange marker appears there.
4. Press **R** and rotate → the selection spins around the marker.

The pivot stays for further rotations. It's removed when you deselect, select another block, or finish a move/scale/putty drag.

---

## 4. Undo, Save, Exit

| Key | Result |
|---|---|
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo. Ignored while a mode (multiselect, fast build, etc.) is active. Finish it with **C** or cancel it with **V** first |
| **Ctrl+S** or save icon | Save. Saving also puts moving blocks back to their start positions |
| **Esc** or **E** | Exit the editor (asks to save if you have unsaved changes) |
| Eye icon | Save Screenshot: downloads a 1280×720 image of the current view |
| Gear icon | Open Settings |

Autosave can be turned on in **Settings → General → Autosave**.

---

## 5. Playtesting

| Button / key | Result |
|---|---|
| **Play** (▶) | Starts the level. If the run was paused, it continues where it stopped |
| **Pause** (⏸), or **Esc** / **E** while playing | Freezes the run and gives back the editor tools; camera moves to the player |
| **Restart** (⏪) | Everything goes back to its start position, checkpoint cleared, run paused; the next **Play** starts fresh |

While playing: **A/D** or arrows move, **Space/W/↑/Enter** jump, **R** restarts the run, **C** respawns at your last checkpoint.

### Start from a checkpoint (temporary)
1. Select a **Checkpoint** block.
2. Click its **Set as start position** button (play icon).
3. Press **Play** → you spawn at that checkpoint. **R** while playing also respawns you there.

This is never saved with the level. It's cleared when you leave the level.

---

## 6. Modes

Only one of these can be active at a time. The top-right overlay shows which one. **V** always cancels the active mode.

### Multiselect (M)
1. **M** → overlay: *Multiselect · Box Select*.
2. Left-drag a box → every block it touches turns white (cyan if it was already white). Drag again to replace the selection.
3. **C** → *Refine*: click blocks to add/remove them. Left-drag pans the camera.
4. **C** → *Transform*: a translucent cyan box with a gizmo surrounds the group.
5. Edit the group:
   - **T/G**, **S**, **R**: move, scale, rotate the whole group.
   - **S** again while scaling: cycles *Scale (Unlocked)* → *Locked XY* → *Locked XYZ*.
   - Hold **Q** and drag: slides the whole group.
   - **D**: duplicates the group; the copies become the new selection.
   - **D** during a move-drag: stamps a copy at the current spot and keeps dragging.
   - **I**: toggles intangibility for the group.
   - **Shift+click** any block: copies its colour onto the group.
   - **B,B** / **B,N**: flips the group.
6. **C** → changes are kept as a single undo step. Or **V** / **M** → everything goes back to how it was.

**X** during Transform deletes the whole group immediately.

### Fast Build (K)
1. **K** → overlay: *Fast Build · Create*.
2. Click → a block is placed. Move the mouse to set its **size**.
3. Click → move the mouse to set its **rotation**.
4. Click → move the mouse to set its **position**.
5. Click → the block is finished, and step 2 starts again for the next block.

- **K** mid-block goes back one step. Going back from step 2 discards that block.
- **K** before step 2 (no block in progress) turns Fast Build off.
- **V** discards the block in progress and turns Fast Build off.

### Thin Build (L)
1. **L** → overlay: *Thin Build*.
2. Right-drag from start to end → a one-block-wide strip follows the drag.
3. Release → the strip is placed. Repeat for more strips.
4. **L** or **V** → Thin Build turns off.

### Chain (P)
Makes a row of blocks sag into a hanging shape (like a rope bridge), then freezes it.
1. Line blocks up end to end (use **Centre Snap**, below).
2. **P** → drag a box around the blocks.
3. **C** → *Refine*: click to add/remove blocks.
4. **C** → *Mark Anchors*: all selected blocks turn cyan; click a block to make it an orange **anchor** (stays fixed).
5. **C** (needs 2+ blocks) → *Loading…* → the blocks settle under gravity and are frozen in place as normal static blocks.

Only blocks whose ends touch exactly are linked. Tilted blocks (X/Y rotation) can't be linked.

### Cut Out (/)
1. Select the block to cut.
2. **/** → overlay: *Cut Out*.
3. Click a second block → its X/Y footprint is cut out of the first block, which is replaced by up to 4 pieces.

Clicking empty space, clicking the same block, or **V** cancels. Rotated blocks can't be cut.

---

## 7. Toggles

These stay on until pressed again, and work alongside everything else.

| Key | Overlay | When on |
|---|---|---|
| **N** | *Force Build* | Clicking a block places a new block there instead of selecting it. Shift+click colour copy is unavailable |
| **H** | — | Hovering a block shows its gizmo; drag it straight away without selecting |
| **,** | *Vertex Snap* / *Centre Snap* | Cycles Off → Vertex Snap → Centre Snap → Off. Placed and dragged blocks snap to other blocks' corners (Vertex) or end-centres (Centre) instead of the grid |

**End-centres:** a block that's more than twice as long as it is wide has an end-centre near each end. Other blocks use their middle. Centre Snap is how you line blocks up end to end for Chain.

**Editor Snap** (grid size) and **Show Grid** are in **Settings → General**.

---

## 8. Level Properties

Toolbar → **Level Properties** icon → popup. Each change applies immediately and is its own undo step. The trash icon resets that row to its default.

| Property | Default | Effect |
|---|---|---|
| Zoom | 180 | Camera distance for this level. Locks the player's zoom setting while playing it |
| Theme | classic | Visual theme. Blocks still using the old theme's colour are recoloured |
| Default Block Color | theme colour | Colour of newly placed blocks |
| Disable Manual Respawn | Off | Blocks the **C** key / checkpoint button during play (respawn after death still works) |
| Level UI Text | empty | Text/HTML shown on screen while playing |

---

## 9. Block Properties

Selecting a block shows its property buttons in the left toolbar.

| Control | Effect |
|---|---|
| Pin | Static (pinned) or affected by physics |
| Color | Block colour |
| Friction | 0 (ice) to 1 (full grip). Disabled while pinned |
| Opacity | 0 (invisible) to 1 (solid) |
| Text | Text for Tip and Teleport blocks |
| Death Block (skull, Cube only) | Touching it kills the player |
| Set as start position (Checkpoint only) | See section 5 |
| Gear (Reset only) | Choose what the Reset block resets (below) |

Not every block type has every control. The player has no Pin or Color.

**Reset block options** (each checkbox applies immediately):

| Option | Default |
|---|---|
| Size, Player Mode, Force, Infinite Jump Mode | On |
| Rotation (Z only), Velocity, Angular Velocity, Player Checkpoint | Off |

---

## 10. Keybind Summary

**Editing** (level paused)

| Key | Action |
|---|---|
| Left-click | Select block / place block / deselect (section 2) |
| Right-click | Delete block |
| Shift+click | Copy selected block's colour onto the clicked block |
| **T** / **G** | Move tool |
| **S** | Scale tool (multiselect transform: press again to cycle scale lock) |
| **R** | Rotate tool (press again to show/hide X/Y axes) |
| **F** | Putty tool |
| **Shift** (held) | Putty: keep angle while stretching. **Left Shift** with the Move gizmo: duplicate while dragging |
| **Q** (held) | Drag-move any block |
| **D** | Duplicate (multiselect: duplicate group, or stamp a copy mid-drag) |
| **X** | Delete selected block / group |
| **I** | Toggle intangible |
| **0** | Move selected block to Current Z |
| **A** (held) | Block-type picker |
| **B**, **B** / **B**, **N** | Flip left-right / front-back |
| **N** | Toggle Force Build |
| **Shift+N** | Deselect |
| **H** | Toggle hover gizmo |
| **,** | Cycle snap: Off → Vertex → Centre |
| **.** | Place rotation pivot |
| **/** | Cut out |
| **M** | Multiselect (press again to cancel) |
| **K** | Fast Build (press again to step back / turn off) |
| **L** | Thin Build (press again to turn off) |
| **P** | Chain |
| **C** | Confirm / advance the active mode |
| **V** | Cancel the active mode |
| **[** | Reset camera onto the player |
| **]** | Set camera X/Y |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo |
| **Ctrl+S** | Save |
| **Esc** / **E** | Exit editor |

**Playtesting**

| Key | Action |
|---|---|
| **A** / **←**, **D** / **→** | Move |
| **Space** / **W** / **↑** / **Enter** | Jump |
| **R** | Restart run |
| **C** | Respawn at checkpoint |
| **Esc** / **E** | Pause |
