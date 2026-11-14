//! Headless smoke: use the real Bevy asset loader, atlas rectangles and sprite components.
use bevy::{
    asset::{AssetPlugin, LoadState},
    image::{CompressedImageFormats, ImageLoader, ImageSampler},
    prelude::*,
};
use pixel_sync_bevy::{Player, Sheet};
use std::{
    path::Path,
    time::{Duration, Instant},
};

#[test]
fn exported_pngs_load_with_exact_rgba_atlas_cells_and_nearest_sampling() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
    let sheet = Sheet::read(&root.join("demo/sheet.json")).unwrap();
    let mut app = App::new();
    app.add_plugins((
        MinimalPlugins,
        AssetPlugin {
            file_path: root.to_string_lossy().into_owned(),
            ..default()
        },
        ImagePlugin::default_nearest(),
    ));
    // Without RenderPlugin there is no GPU capability probe to register this loader.
    app.register_asset_loader(ImageLoader::new(CompressedImageFormats::empty()));
    app.finish();
    app.cleanup();
    let server = app.world().resource::<AssetServer>();
    let static_png: Handle<Image> = server.load("demo/static.png");
    let sheet_png: Handle<Image> = server.load(format!("demo/{}", sheet.image));
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        app.update();
        let server = app.world().resource::<AssetServer>();
        for handle in [&static_png, &sheet_png] {
            if let Some(LoadState::Failed(error)) = server.get_load_state(handle.id()) {
                panic!("PNG load failed: {error}");
            }
        }
        if server.is_loaded_with_dependencies(static_png.id())
            && server.is_loaded_with_dependencies(sheet_png.id())
        {
            break;
        }
        assert!(Instant::now() < deadline, "Bevy image loader timed out");
        std::thread::sleep(Duration::from_millis(5));
    }
    let images = app.world().resource::<Assets<Image>>();
    let single = images.get(&static_png).unwrap();
    let atlas = images.get(&sheet_png).unwrap();
    assert_eq!(single.size(), UVec2::new(16, 16));
    assert_eq!(
        atlas.size(),
        UVec2::new(sheet.image_width, sheet.image_height)
    );
    // Image assets inherit the ImagePlugin's nearest sampler (rather than overriding it).
    assert!(matches!(single.sampler, ImageSampler::Default));
    assert!(matches!(atlas.sampler, ImageSampler::Default));
    let rgba = atlas.data.as_ref().unwrap();
    let static_rgba = single.data.as_ref().unwrap();
    assert_eq!(&static_rgba[..4], &[0, 0, 0, 0]);
    assert_eq!(
        &static_rgba[(4 * 16 + 5) * 4..(4 * 16 + 5) * 4 + 4],
        &[255, 255, 255, 128]
    );
    let layout = sheet.layout();
    assert_eq!(layout.textures.len(), 4); // Three real frames plus one unused cell.
    for frame in &sheet.frames {
        let rect = layout.textures[frame.index];
        assert_eq!(rect.size(), UVec2::new(16, 16));
        for y in 0..16 {
            for x in 0..16 {
                let offset = (((rect.min.y + y) * sheet.image_width + rect.min.x + x) * 4) as usize;
                if frame.index == 0 {
                    let source = ((y * 16 + x) * 4) as usize;
                    assert_eq!(&rgba[offset..offset + 4], &static_rgba[source..source + 4]);
                }
            }
        }
        let offset = (((rect.min.y + 8) * sheet.image_width + rect.min.x + 8) * 4) as usize;
        assert_eq!(
            &rgba[offset..offset + 4],
            &[70 + frame.index as u8 * 50, 195, 165, 255]
        );
    }
    for y in 16..32 {
        for x in 16..32 {
            let offset = ((y * 32 + x) * 4) as usize;
            assert_eq!(&rgba[offset..offset + 4], &[0; 4]);
        }
    }
    // Exercise the exported clips against a real Sprite/TextureAtlas component.
    let mut layouts = Assets::<TextureAtlasLayout>::default();
    let entity = app
        .world_mut()
        .spawn(Sprite::from_atlas_image(
            sheet_png,
            TextureAtlas {
                layout: layouts.add(layout),
                index: 0,
            },
        ))
        .id();
    for clip in sheet.animations() {
        let mut player = Player::default();
        let mut elapsed = 0;
        for &index in &clip.indices {
            let actual = player.advance(Duration::from_millis(elapsed), &sheet, &clip);
            app.world_mut()
                .entity_mut(entity)
                .get_mut::<Sprite>()
                .unwrap()
                .texture_atlas
                .as_mut()
                .unwrap()
                .index = actual;
            assert_eq!(actual, index, "clip {}", clip.name);
            elapsed = sheet.frames[index].duration;
        }
        let next = player.advance(Duration::from_millis(elapsed), &sheet, &clip);
        assert_eq!(
            next,
            if clip.looping {
                clip.indices[0]
            } else {
                *clip.indices.last().unwrap()
            }
        );
        assert_eq!(player.finished, !clip.looping);
    }
}
