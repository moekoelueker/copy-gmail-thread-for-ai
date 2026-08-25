# Icon concepts

The current production icon remains the release default because its simple copy
glyph stays recognizable at Chrome's 16 px toolbar size. Six original concepts
explore a more explicit mail/thread metaphor without using Google's Gmail mark.

See `contact-sheet.png` for all seven directions.

## Recommendation

- Ship the current icon for version 2.2.0.
- If the brand should communicate “email” more explicitly, develop concept 05
  (`04-envelope-copy-frame.png`) into a hand-tuned SVG with a dedicated 16 px
  drawing before replacing the production icon.
- Avoid an envelope shaped like the Gmail “M”; the extension is independent and
  should not imply Google sponsorship.

## Generation notes

The six alternatives were generated as original raster explorations with
OpenAI's built-in image generation tool. Each prompt requested a single,
centered, no-text browser-extension icon using near-black, warm off-white, and
coral; an envelope/thread plus copy/document metaphor; transparent outer space;
no gradients that would turn muddy at 16 px; and no Google, Gmail, OpenAI, or
other third-party branding, trademarks, or watermarks.

The concepts are visual directions, not drop-in production icons. Any selected
alternative should be redrawn as vector artwork and checked at 16, 32, 48, and
128 px before release.
