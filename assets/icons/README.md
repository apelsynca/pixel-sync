# PixelSync icon

`pixelsync-master.png` is the original concept generated with the built-in image generation tool. Its transparent corners and navy tile are preserved in the exported sizes.

Prompt direction: two bold interlocking sync arrows built from square pixel blocks, lime green `#b4e589` on a dark navy `#18202a` rounded square, centered with generous padding, no text, readable at small sizes.

Run `bun run icons` to regenerate PNG sizes from 16 to 1024 pixels and `pixelsync.ico` (16, 24, 32, 48, 64, 128 and 256 pixels). The conversion uses the existing `pngjs` dependency.

The main window uses the 256px PNG on Windows and the 512px PNG on Linux. Forge embeds the ICO in the Windows executable and Squirrel installer. Only the two runtime PNGs are included inside the packaged app; the master and other exports remain source assets.

Verify the taskbar, executable and installer icons on Windows after rebuilding. Existing packages need to be rebuilt to receive the icon.
