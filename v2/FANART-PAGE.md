# Fanart gallery

`/fanart` is a standalone gallery linked from the homepage palette icon. It uses the existing fanart API and WebP URLs. Admin titles and hover Markdown also supply the expanded artwork caption; no new database fields are needed.

## Reference extraction

Reference: https://brycecarrington.carrd.co/#illustrations (desktop live page, approximately 1265 × 712).

- Layout: centered navigation, large centered heading, thumbnail rows filling roughly 80–90% of the viewport; about five thumbnails across at desktop. Expanded artwork sits over the gallery, contained without cropping.
- Typography: sans-serif navigation and captions around 16px; bold centered section heading around 38px. The implementation uses the existing site font stack.
- Color: reference background approximately #161616, captions #eeeeee, black translucent viewer. Adapt the gallery surface to the existing #f4fbf3 / #b2e1af green palette and #1a421d text; retain the dark viewer for artwork contrast.
- Spacing: thumbnail gaps around 8–10px; heading-to-grid around 20px; viewer image inset around 35px vertically, caption below.
- Components: softly rounded thumbnails (about 6–8px), a top-right close control and unboxed previous/next chevrons at the viewport sides.
- Atmosphere: artwork is the focal point; the overlay dims the underlying gallery. No new decorative imagery.
- Interaction: thumbnail click opens an image with its caption, side arrows and keyboard arrows browse adjacent pieces, and closing returns to the gallery. Add explicit Escape, focus containment/restoration and touch swipes for accessible use. Mobile reduces the gallery columns and keeps controls reachable.

## Implementation

The viewer shows the full WebP artwork, title, existing Markdown notes and position in the gallery. It supports previous/next buttons, Left/Right keys, touch swipes, Escape, backdrop close and a close button. The underlying gallery is inert while the viewer is open. Loading, empty and API fallback states are visible. Original uploads remain available through the admin panel.

## Verification

Compared the gallery and viewer against the reference screenshots: large thumbnail rows, contained full artwork, a dimmed backdrop, caption beneath and side navigation are present. The green palette intentionally follows thesxber.com. Browser checks at desktop and 390px mobile widths confirmed the responsive layout; click-next, keyboard-next, Escape, backdrop close, focus restoration and the homepage link worked. An isolated one-entry fixture confirmed captions render bold/italic notes and escape HTML, with navigation hidden for a single piece. Production build and backend syntax checks passed. Touch swipe handling is implemented but has not been tested on a physical touchscreen.

Hover cards show the title, linked to the optional artist credit URL. The expanded viewer shows that same linked title and the description (100-character limit on uploads and edits). Admin edits are staged together and published with the floating Save all button.
