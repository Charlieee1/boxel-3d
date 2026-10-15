# Bugs
- ARGHHHHHH is an auto level
- Splash park in main pack is by ember
- Wavemachine optimized is modified by charlie
- Mimic old UI properly
  - Mimic bubble theme properly
- Move bounce snake to hard level pack
- Re-introduce checkpoint glitch
- Timed spider made by Majesticcss

# Level editor improvements
- Organize level properties
- Saved object groups
- Allow combinations of modes and easy switching
- Plugins
- Group modify (be able to change many models at once)
- Gameplay/deco layers
- Level editor camera while gameplay is running (player death does not restart level)
- Level editor guide
- Proper intangible objects
- Automatically reset (restart) level when making modifications

# Settings
- External resources
  - Level packs
  - Skins
- Deterministic mode fine-control settings
- Cap FPS to 60 (disable interpolation)
- Anti lag (does extra physics simulation calls between rendering calls to catch up)
- Change max zoom on slider to 1k (for level properties too)
- Separate moving background from rotating camera
- Make jump indicator disable verification badge
- Separate moving background and rotating camera
- Change old backgrounds setting to background & default block recolour and apply to all levels
- Clean thumbnails setting

# QOL
- Lines from teleport blocks to destinations
  - For gameplay, invalidating toggle like debug mode
  - For level editor, setting
- Show only levels not completed by player in level select menu
- Change max zoom in editor to 5k
- Pre-load next level
- Make long level credits scroll

# Extra features
- Gravity preservation glitch working for campaign levels
- Allow jumping by clicking instantly after closing textbox
- Separate level packs in carousel
- Send short skin urls to other players in multiplayer
- Playing all songs instead of just one
- Add other mods into the game
- Add mod hooks
- Two new types of blocks
  - Spike upgrade
    - Makes player spiky
  - Breakable block
    - Spiky player can break through
- Resizable game popup
- Download levels to level editor/localStorage (caching)
  - In game levels can only be downloaded to level editor
  - Maximum of 30 downloaded levels in localStorage
- Change UI colouring and style
- Light blocks and baked lighting
- Trigger blocks
  - Can affect
    - Position
    - Rotation
    - Scale
    - Velocity
    - Angular velocity
    - Intangibility
    - Visibility
    - Level-specific UI
- Multi-layer physics
