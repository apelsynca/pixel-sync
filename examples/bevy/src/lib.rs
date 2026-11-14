use bevy::prelude::*;
use serde::Deserialize;
use std::{collections::HashSet, path::Path, time::Duration};

/// PixelSync sprite-sheet sidecar, version 1. Unknown fields allow future additions.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub version: u32,
    pub image: String,
    pub image_width: u32,
    pub image_height: u32,
    pub frame_width: u32,
    pub frame_height: u32,
    pub frame_count: usize,
    pub columns: u32,
    pub rows: u32,
    padding: u32,
    offset: Offset,
    units: Units,
    pub frames: Vec<Frame>,
    pub clips: Vec<Clip>,
}
#[derive(Debug, Deserialize)]
struct Offset {
    x: u32,
    y: u32,
}
#[derive(Debug, Deserialize)]
struct Units {
    dimensions: String,
    duration: String,
}
#[derive(Debug, Deserialize)]
pub struct Frame {
    pub id: String,
    pub index: usize,
    pub duration: u64,
}
#[derive(Debug, Deserialize)]
pub struct Clip {
    pub name: String,
    pub indices: Vec<usize>,
    #[serde(rename = "loop")]
    pub looping: bool,
}

impl Sheet {
    pub fn read(path: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let sheet: Self = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        sheet.validate()?;
        Ok(sheet)
    }

    pub fn validate(&self) -> Result<(), String> {
        let invalid = || "Expected a PixelSync version-1 regular-grid export".to_string();
        if self.version != 1
            || self.padding != 0
            || self.offset.x != 0
            || self.offset.y != 0
            || self.units.dimensions != "pixels"
            || self.units.duration != "milliseconds"
            || !(1..=512).contains(&self.frame_width)
            || !(1..=512).contains(&self.frame_height)
            || !(1..=64).contains(&self.frame_count)
            || self.frames.len() != self.frame_count
            || self.columns == 0
            || self.columns as usize > self.frame_count
            || self.rows != (self.frame_count as u32).div_ceil(self.columns)
            || self.columns.checked_mul(self.frame_width) != Some(self.image_width)
            || self.rows.checked_mul(self.frame_height) != Some(self.image_height)
            || self.image_width > 4096
            || self.image_height > 4096
        {
            return Err(invalid());
        }
        // The exporter emits a sibling PNG; avoid absolute paths or asset-source syntax.
        if self.image.is_empty()
            || self.image.contains(['/', '\\', ':'])
            || self.image == "."
            || self.image == ".."
        {
            return Err("image must name a sibling PNG".into());
        }
        let mut ids = HashSet::new();
        for (index, frame) in self.frames.iter().enumerate() {
            if frame.index != index
                || frame.id.is_empty()
                || !ids.insert(&frame.id)
                || !(10..=60_000).contains(&frame.duration)
            {
                return Err(invalid());
            }
        }
        let mut names = HashSet::new();
        for clip in &self.clips {
            let unique: HashSet<_> = clip.indices.iter().collect();
            if clip.name.trim().is_empty()
                || !names.insert(&clip.name)
                || clip.indices.is_empty()
                || unique.len() != clip.indices.len()
                || clip.indices.iter().any(|&i| i >= self.frame_count)
            {
                return Err("Invalid clip name or frame references".into());
            }
        }
        Ok(())
    }

    pub fn layout(&self) -> TextureAtlasLayout {
        TextureAtlasLayout::from_grid(
            UVec2::new(self.frame_width, self.frame_height),
            self.columns,
            self.rows,
            None,
            None,
        )
    }

    /// Timeline is always available, even when the export has no named clips.
    pub fn animations(&self) -> Vec<Animation> {
        std::iter::once(Animation {
            name: "Timeline".into(),
            indices: (0..self.frame_count).collect(),
            looping: true,
        })
        .chain(self.clips.iter().map(|c| Animation {
            name: c.name.clone(),
            indices: c.indices.clone(),
            looping: c.looping,
        }))
        .collect()
    }
}

#[derive(Clone, Debug)]
pub struct Animation {
    pub name: String,
    pub indices: Vec<usize>,
    pub looping: bool,
}

/// Absolute elapsed time avoids losing residual time on a delayed update.
#[derive(Component, Default, Debug)]
pub struct Player {
    elapsed: Duration,
    pub finished: bool,
}
impl Player {
    pub fn restart(&mut self) {
        *self = Self::default();
    }
    pub fn advance(&mut self, delta: Duration, sheet: &Sheet, clip: &Animation) -> usize {
        let total: u128 = clip
            .indices
            .iter()
            .map(|&i| sheet.frames[i].duration as u128 * 1_000_000)
            .sum();
        let mut elapsed = self.elapsed.as_nanos().saturating_add(delta.as_nanos());
        if clip.looping {
            elapsed %= total;
        } else if elapsed >= total {
            elapsed = total;
            self.finished = true;
        }
        // Validated exports total at most 64 * 60 seconds.
        self.elapsed = Duration::from_nanos(elapsed as u64);
        for &index in &clip.indices {
            let duration = sheet.frames[index].duration as u128 * 1_000_000;
            if elapsed < duration {
                return index;
            }
            elapsed -= duration;
        }
        *clip.indices.last().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sheet() -> Sheet {
        Sheet::read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/demo/sheet.json")).unwrap()
    }
    #[test]
    fn unequal_durations_residuals_large_delays_and_clip_order() {
        let s = sheet();
        let clips = s.animations();
        let walk = clips.iter().find(|c| c.name == "walk").unwrap();
        assert_eq!(walk.indices, [2, 0, 1]);
        let mut p = Player::default();
        assert_eq!(p.advance(Duration::ZERO, &s, walk), 2);
        assert_eq!(p.advance(Duration::from_millis(249), &s, walk), 2);
        assert_eq!(p.advance(Duration::from_millis(2), &s, walk), 0);
        assert_eq!(p.advance(Duration::from_millis(79), &s, walk), 1);
        assert_eq!(
            p.advance(Duration::from_millis(120 + 450 * 1_000_000), &s, walk),
            2
        );
    }
    #[test]
    fn non_looping_stops_on_final_frame_and_restart_resets() {
        let s = sheet();
        let clip = Animation {
            name: "once".into(),
            indices: vec![1, 0],
            looping: false,
        };
        let mut p = Player::default();
        assert_eq!(p.advance(Duration::from_millis(120), &s, &clip), 0);
        assert!(!p.finished);
        assert_eq!(p.advance(Duration::from_millis(80), &s, &clip), 0);
        assert!(p.finished);
        assert_eq!(p.advance(Duration::from_secs(999), &s, &clip), 0);
        p.restart();
        assert!(!p.finished);
        assert_eq!(p.advance(Duration::ZERO, &s, &clip), 1);
    }
    #[test]
    fn rejects_unused_cells_bad_versions_units_and_layouts() {
        let mut s = sheet();
        s.clips[0].indices = vec![s.frame_count];
        assert!(s.validate().is_err());
        let mut s = sheet();
        s.version = 2;
        assert!(s.validate().is_err());
        let mut s = sheet();
        s.units.duration = "seconds".into();
        assert!(s.validate().is_err());
        let mut s = sheet();
        s.image_width += 1;
        assert!(s.validate().is_err());
        let mut s = sheet();
        s.frames[0].duration = 0;
        assert!(s.validate().is_err());
    }
}
