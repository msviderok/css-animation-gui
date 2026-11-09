# Framecraft

A lightweight browser editor for building frame-accurate sprite choreography and exporting CSS. New projects start empty.

## Open

Open `index.html` directly in a browser. No package install or server is required.

## Workflow

1. Add an element and load its single-row PNG sprite sheet.
2. The first sprite creates a playable phase automatically. Double-click its name or selector in the timeline to edit it.
3. Select a clip and adjust its frame range, duration, wait, and effects.
4. Add phases and elements to build synchronized choreography.
5. Preview the sequence, then copy the CSS or save a `.framecraft.json` project.

The project JSON embeds sprite images as data URLs so it can be reopened as a self-contained file. The CSS export uses the original PNG filenames as relative paths; update those paths to match your game assets.

## Quick actions

Right-click a scene element or timeline clip for its context menu. Press `?` for the in-app shortcut reference. Common shortcuts include Space to play/stop, `C` to toggle looping, `H` to hide/show a clip, `Shift+P` to insert a phase, `Shift+E` to add a sprite, `⌘/Ctrl+D` to duplicate a phase, and Delete to remove the selected phase or extra sprite's clip. `⌘/Ctrl+Z` restores the last deleted phase or clip.
