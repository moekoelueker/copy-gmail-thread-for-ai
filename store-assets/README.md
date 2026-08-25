# Chrome Web Store assets

Ready-to-upload files:

- `small-promo-440x280.png` — required small promotional tile
- `marquee-1400x560.png` — optional marquee tile
- `screenshot-1-overview-1280x800.png`
- `screenshot-2-controls-1280x800.png`
- `screenshot-3-completeness-1280x800.png`
- `../icons/icon128.png` — store icon

Editable SVG sources and local raster inputs are in `src/`. The popup image is
captured from the actual extension markup and CSS with synthetic state; it does
not contain a Gmail account or real message data.

Regenerate the popup and rendered PNGs from the repository root:

```sh
node tools/capture-popup-screenshot.js
cp store-assets/ui-popup-v2.png store-assets/src/ui-popup-v2.png
rsvg-convert store-assets/src/small-promo-440x280.svg -o store-assets/small-promo-440x280.png
rsvg-convert store-assets/src/marquee-1400x560.svg -o store-assets/marquee-1400x560.png
rsvg-convert store-assets/src/screenshot-1-overview-1280x800.svg -o store-assets/screenshot-1-overview-1280x800.png
rsvg-convert store-assets/src/screenshot-2-controls-1280x800.svg -o store-assets/screenshot-2-controls-1280x800.png
rsvg-convert store-assets/src/screenshot-3-completeness-1280x800.svg -o store-assets/screenshot-3-completeness-1280x800.png
```
