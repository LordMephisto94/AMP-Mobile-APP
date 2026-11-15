# DESIGN.md

Direction chosen by the owner on 2026-11-15: "Balanced, with character".

Dial: ENERGY 2 / RHYTHM 3 / MOTION 1

The details below were worked out from that choice and the app's existing look. Change them freely.

## Identity

- AMP's violet (`primary` in `theme.json`) is the single accent. Violet-to-blue gradients are not used as fills.
- The neon artwork (`assets/backdrop.webp`) appears on the home screen only.
- The panel's triangle banner is the one identity motif. It heads a server's instance list, and an instance's page when the instance has no artwork, where it also shows the status. The home screen uses the wordmark over the artwork.

## Surfaces

- Cards are solid (`card` with a 1px `border`) and carry no shadow. Shadow marks only what floats over the page: menus and dialogs.
- No glass blur and no glow.
- Text on the accent uses `primary-foreground`, not white.
- Two themes, dark and light, chosen in Settings (dark, light or the phone's). The artwork is dark, so the home screen washes it toward the page colour in the light theme and tints the white wordmark and mark dark indigo. The triangle banner and an instance's artwork stay dark in both themes, and their text and badges are white on purpose.

## Icons

- No emoji. Icons are line SVGs from `assets/menu` and `assets/icons`, tinted from the theme, and only where they carry meaning. Otherwise the label does the work.
- Colour comes from theme tokens only: `success`, `warning`, `destructive`, `info` and `series` for status and data, `primary` for the accent. A fixed palette colour (`sky-300`, `emerald-400`) is wrong, since it was chosen against black. Every text and border pairing is checked against WCAG AA (4.5:1 for text, 3:1 for the edge of an input, switch or key) in both themes.

## Layout

- Each screen is built around the one action it exists for. Screens differ in composition (a list, a set of rows, a form, a console) instead of repeating a stack of identical cards.

## Motion

- Press states, and the fade of menus and dialogs. Nothing loops.

## Copy

- Plain, specific, sentence case. No em dashes.
