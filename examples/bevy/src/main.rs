#[cfg(feature = "viewer")]
mod viewer {
    use bevy::{asset::AssetPlugin, prelude::*};
    use pixel_sync_bevy::{Animation, Player, Sheet};
    use std::path::Path;

    #[derive(Resource)]
    struct Demo {
        sheet: Sheet,
        animations: Vec<Animation>,
        selected: usize,
        paused: bool,
        sheet_path: String,
        static_path: String,
    }

    pub fn run() -> Result<(), String> {
        let args: Vec<_> = std::env::args().skip(1).collect();
        if args.len() > 2 {
            return Err("Usage: cargo run -- [demo/sheet.json] [demo/static.png] (paths relative to assets/)".into());
        }
        let sheet_path = args.first().cloned().unwrap_or("demo/sheet.json".into());
        let static_path = args.get(1).cloned().unwrap_or("demo/static.png".into());
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        let sheet = Sheet::read(&root.join(&sheet_path))?;
        if !root.join(&static_path).is_file() {
            return Err(format!(
                "Missing static PNG: {}",
                root.join(&static_path).display()
            ));
        }
        let image_path = Path::new(&sheet_path)
            .with_file_name(&sheet.image)
            .to_string_lossy()
            .replace('\\', "/");
        if !root.join(&image_path).is_file() {
            return Err(format!("Missing sheet PNG: {image_path}"));
        }
        let animations = sheet.animations();
        println!(
            "Left: static PNG. Right: animation. Arrows: select clip; Space: pause; R: restart."
        );
        println!(
            "Clips: {}",
            animations
                .iter()
                .map(|a| a.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        App::new()
            .add_plugins(
                DefaultPlugins
                    .set(AssetPlugin {
                        file_path: root.to_string_lossy().into_owned(),
                        ..default()
                    })
                    .set(ImagePlugin::default_nearest())
                    .set(WindowPlugin {
                        primary_window: Some(Window {
                            title: "PixelSync → Bevy | static PNG + animation".into(),
                            resolution: (800, 400).into(),
                            resizable: false,
                            ..default()
                        }),
                        ..default()
                    }),
            )
            .insert_resource(ClearColor(Color::srgb(0.09, 0.11, 0.15)))
            .insert_resource(Demo {
                sheet,
                animations,
                selected: 0,
                paused: false,
                sheet_path: image_path,
                static_path,
            })
            .add_systems(Startup, setup)
            .add_systems(Update, (controls, animate).chain())
            .run();
        Ok(())
    }

    fn setup(
        mut commands: Commands,
        demo: Res<Demo>,
        server: Res<AssetServer>,
        mut layouts: ResMut<Assets<TextureAtlasLayout>>,
    ) {
        commands.spawn(Camera2d);
        // Integer scale and centered whole-pixel alignment; no custom_size/resampling.
        let scale = (160 / demo.sheet.frame_width.max(demo.sheet.frame_height)).clamp(1, 8) as f32;
        commands.spawn((
            Sprite::from_image(server.load(demo.static_path.clone())),
            Transform::from_xyz(-200., 0., 1.).with_scale(Vec3::splat(scale)),
        ));
        commands.spawn((
            Sprite::from_atlas_image(
                server.load(demo.sheet_path.clone()),
                TextureAtlas {
                    layout: layouts.add(demo.sheet.layout()),
                    index: 0,
                },
            ),
            Transform::from_xyz(200., 0., 1.).with_scale(Vec3::splat(scale)),
            Player::default(),
        ));
        // Checkerboard makes transparent and translucent exported pixels visible.
        for center in [-200., 200.] {
            for y in 0..10 {
                for x in 0..10 {
                    let shade = if (x + y) % 2 == 0 { 0.18 } else { 0.24 };
                    commands.spawn((
                        Sprite::from_color(Color::srgb(shade, shade, shade), Vec2::splat(20.)),
                        Transform::from_xyz(
                            center - 90. + x as f32 * 20.,
                            -90. + y as f32 * 20.,
                            0.,
                        ),
                    ));
                }
            }
        }
    }

    fn controls(
        keys: Res<ButtonInput<KeyCode>>,
        mut demo: ResMut<Demo>,
        mut players: Query<&mut Player>,
        mut windows: Query<&mut Window>,
    ) {
        let mut restart = keys.just_pressed(KeyCode::KeyR);
        if keys.just_pressed(KeyCode::ArrowRight) {
            demo.selected = (demo.selected + 1) % demo.animations.len();
            restart = true;
        }
        if keys.just_pressed(KeyCode::ArrowLeft) {
            demo.selected = (demo.selected + demo.animations.len() - 1) % demo.animations.len();
            restart = true;
        }
        if keys.just_pressed(KeyCode::Space) {
            demo.paused = !demo.paused;
        }
        if restart {
            for mut player in &mut players {
                player.restart();
            }
            demo.paused = false;
        }
        if let Ok(mut window) = windows.single_mut() {
            window.title = format!(
                "PixelSync → Bevy | {}{} | ←/→ clips · Space pause · R restart",
                demo.animations[demo.selected].name,
                if demo.paused { " (paused)" } else { "" }
            );
        }
    }

    fn animate(
        time: Res<Time<Real>>,
        demo: Res<Demo>,
        mut sprites: Query<(&mut Player, &mut Sprite)>,
    ) {
        for (mut player, mut sprite) in &mut sprites {
            let delta = if demo.paused {
                std::time::Duration::ZERO
            } else {
                time.delta()
            };
            // Real elapsed time also catches up after a long render stall.
            let index = player.advance(delta, &demo.sheet, &demo.animations[demo.selected]);
            if let Some(atlas) = &mut sprite.texture_atlas {
                atlas.index = index;
            }
        }
    }
}

fn main() {
    #[cfg(feature = "viewer")]
    if let Err(error) = viewer::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(feature = "viewer"))]
    eprintln!(
        "Use cargo test --no-default-features for headless smoke checks, or cargo run for the viewer."
    );
}
