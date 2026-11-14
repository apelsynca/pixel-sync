# PixelSync → Bevy

A small standalone Rust sample using **Bevy 0.20.1** (pinned in Cargo.toml and Cargo.lock), with a static transparent PNG on the left and an animated sheet on the right. The editor itself still requires no Rust installation. This sample requires Rust 1.97.1 or newer and a graphics driver supported by Bevy. Linux builds use X11; install your distribution's C/C++ linker and X11 development libraries if needed.

From the repository root:

```sh
cargo run --manifest-path examples/bevy/Cargo.toml --locked
```

Use **← / →** to select Timeline, idle, walk, or once. **Space** pauses; **R** restarts. The window title names the selected clip. The `once` clip holds its last frame. The background checkerboard shows transparency; both sprites retain their logical size with an integer scale and nearest-neighbor sampling.

## Use your own export

1. Open artwork in PixelSync. Create frames, set durations, and define clips if desired.
2. Use **File → Export sprite sheet…**, choose a new folder named `hero`, then copy that folder (both `sheet.json` and `sheet.png`) into `examples/bevy/assets/`.
3. Use **File → Export frame PNG…** to export the selected frame as `examples/bevy/assets/hero/static.png`.
4. Run:

```sh
cargo run --manifest-path examples/bevy/Cargo.toml --locked -- hero/sheet.json hero/static.png
```

Arguments are relative to the sample's `assets/` folder. Both omitted arguments use the bundled demo. The PNG on the left is an independent static asset; the right sprite uses the sheet's cell dimensions. Keep exported filenames together: the JSON's `image` field identifies its sibling PNG. Restart the sample after replacing assets or metadata.

`Sheet::read` loads and validates the version-1 metadata. `Sheet::layout` constructs a regular `TextureAtlasLayout`; frame indices are row-major with no trimming, padding or offset. `Sheet::animations` adds a looping timeline followed by named clips. Named clip indices can be reordered and omit frames. It uses `frameCount`, so unused grid cells never play.

`Player::advance` accumulates real elapsed time, consumes each frame's individual duration in milliseconds and preserves residual time. Looping reduces large delays by the complete clip duration before finding a frame. Non-looping clips stop after the last frame's duration and retain that frame. Pausing and restarting do not alter metadata. The viewer uses `Time<Real>` so Bevy's virtual-time delta cap does not slow animation after a long render stall.

## Repeatable checks

```sh
bun run fixtures:bevy  # regenerate included assets through the real PixelSync exporter
bun run smoke:bevy     # Rust timing tests + actual Bevy PNG loading, no window or GPU needed
bun run check:bevy     # type-check the graphical viewer and Bevy APIs
cargo fmt --manifest-path examples/bevy/Cargo.toml --check
```

The three 16×16 demo frames last 80, 120 and 250 ms. `walk` plays indices `[2, 0, 1]`; `once` plays `[1, 2]`. A 2×2 grid leaves a transparent unused fourth cell. `demo.pixel.json` can be opened in PixelSync for editing. `scripts/bevy-fixtures.ts` produces both PNGs and metadata through the production loader/compositor/exporter, with a fixed session ID for reproducible output.

Headless tests load both PNGs using Bevy's real asset pipeline, compare static pixels against atlas cell zero, verify exact RGBA including alpha 0/128/255, verify cell placement and the unused cell, and advance Sprite atlas indices through every clip. They also check timing boundaries, large delays, restart and invalid metadata. These checks do not establish graphical presentation or Windows runtime behavior; see [release acceptance](../../docs/release-acceptance.md).

API references checked against Bevy's published 0.20.1 source: [sprite-sheet example](https://github.com/bevyengine/bevy/blob/v0.20.1/examples/2d/sprite_sheet.rs), [ImagePlugin](https://docs.rs/bevy/0.20.1/bevy/image/struct.ImagePlugin.html), and [TextureAtlasLayout](https://docs.rs/bevy/0.20.1/bevy/image/struct.TextureAtlasLayout.html).
