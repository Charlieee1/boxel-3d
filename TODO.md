# Level editor improvements
- Saved object groups
- Different fast build, dragging to create thin blocks
- Duplicate block during translation
- Hover controls transform mode
- Offset building plane (different z value)
- Flip multiselect selections
- Scale blocks within selection depending on rotation
- Default block colour config
- Reset camera z position and rotation
- Set camera XY position
- UI panel to show current action
- Cut out blocks (perpendicular/parallel cuts only)
- Force build (not select block)
- Keybind to deselect block
- Only change theme-correct block colour to new colour
- Plugins
- Group modify (be able to change many models at once)
- Snap blocks to each others':
  - Vertices
  - Centres of ends of blocks
- Physics simulation for chains
- Get rid of border for power block icon
- Rotation around offset point
- Gameplay/deco layers
- New UI settings in level editor
- Set temporary player start position
- Level editor guide

# Extra level editor functionality
- Disabling manual checkpoint respawn
- Translucent/transparent blocks
- Reset block being able to reset specific properties instead of all
- Level-specific UI
- Toggle to make normal blocks death blocks
- Visual grid

# Settings
- Deteminism
- External resources
  - Level packs
  - Skins
- Disable textboxes
- Colour of death particles
- Green dot next to player if player can jump

# QOL
- Set can jump to true at start of level
- Lines from teleport blocks to destinations
  - For gameplay, invalidating toggle like debug mode
  - For level editor, setting
- Gravity preservation glitch working for campaign levels
- Allow jumping by clicking instantly after closing textbox
- Separate level packs in carousel
- Send short skin urls to other players in multiplayer
- Playing all songs instead of just one
- By default level pack is loaded

# Extra features
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
