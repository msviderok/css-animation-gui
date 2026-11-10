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

## Importing the marker DOM animation

1. Open **Import DOM** and copy the capture snippet.
2. In the running game's DevTools, select a scene container containing the marker and player, then run the snippet in Console.
3. Paste the capture into Framecraft, preview it, choose a marker, and select **Use in timeline**.
4. Edit each phase's endpoint declarations in **Custom CSS**. Select the player track to edit its hop keyframes. Phase waits pause the player and marker; seeking uses the same generated animation as playback.
5. Copy CSS back to the game, replacing its entry animation rules. Keep the scene's base styles and typed custom-property registrations. Captured asset URLs in exported rules should use the corresponding asset paths in the game build.

The first DOM importer supports the marker/player scene. It preserves the scene's ancestor context and idle styles, embeds accessible active sprite images in the preview, and reports assets that need manual attention. Scene captures, embedded images, phases, and player keyframes are included in saved projects and local autosaves. Marker faces share one track; export keeps the game's broad marker selector.

## Syntax highlighting

The CSS pane sits beside the preview and timeline. CSS editors, exported CSS, capture JSON, and the capture snippet use TanStack Highlight. The editable fields retain native textarea selection and clipboard behavior; an aria-hidden highlighting layer supplies token colors.

`syntax/highlighter.mjs` exports the same synchronous registry for Node/SSR and the browser, registering only CSS, JavaScript, and JSON. The app itself remains static and has no SSR runtime. Stable `th-*` classes are themed in `styles.css`; changing `data-theme` changes CSS variables without rebuilding code markup. Exact character decorations can be passed through `highlightCode` options.

Run `npm ci`, `npm run build`, and `npm test` after changing the highlighter. The checked-in `syntax-highlight.js` browser bundle allows the site to remain runnable without a build step.

Drag the divider between the preview and CSS pane to resize them; double-click to reset. The focused divider supports arrow keys (Shift for larger steps), Home, and End. The split is saved locally.

The target CSS editor shows only `marker-enter` rules and referenced keyframes. Skin/action variants, unrelated animations, base styles, and typed `@property` registrations remain in the preview context rather than the editable animation fragment. Typed registrations are retained because removing them can make custom-property animations interpolate discretely.

## Creating a new DOM entry

Use **Create new animation** after importing the marker scene. This creates independent player, polygon-face, bottom-polygon, and black-void tracks, each with an initial-state template. The marker's idle spin and face fluctuations continue; the imported player jump is not activated.

Select a track, position the playhead, and edit its keyframe declarations. Valid edits automatically record a keyframe at that time; incomplete edits retain the last valid keyframe. Use the step buttons for approximately 16.7 ms increments, and the following-segment selector for easing or stepped changes. The original-entry reference is available separately, and **Resume new animation** restores your work. Exported CSS uses `framecraft-entry` on `html` and requires the captured base styles and typed property registrations.

DOM imports append to an existing timeline rather than replacing its tracks, phases, duration, or keyframes. Added captures have their own preview scope. In keyframe authoring mode, each import adds separate player, face, bottom, and void tracks. Delete unwanted DOM tracks with their row’s × button; deleting an original or imported instance does not hide another instance with the same CSS selector. Existing PNG tracks are retained and participate in mixed PNG/DOM playback and seeking.
