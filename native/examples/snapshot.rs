//! Headless UI snapshots: runs the real app against demo fixtures and
//! rasterizes egui's tessellated output on the CPU into PNG files.
//!
//! cargo run --release --example snapshot --features demo -- <out_dir> [scene…]

use eframe::egui::{
    self, epaint::Primitive, ClippedPrimitive, Color32, ImageData, Pos2, Rect, TextureId,
    TexturesDelta, Vec2,
};
use proxora_core::demo;
use std::collections::HashMap;
use std::time::Duration;

struct Texture {
    size: [usize; 2],
    pixels: Vec<Color32>,
}

fn image_pixels(image: &ImageData) -> (Vec<Color32>, [usize; 2]) {
    match image {
        ImageData::Color(img) => (img.pixels.clone(), img.size),
        ImageData::Font(font) => (font.srgba_pixels(None).collect(), font.size),
    }
}

fn apply_textures(textures: &mut HashMap<TextureId, Texture>, delta: &TexturesDelta) {
    for (id, d) in &delta.set {
        let (pixels, size) = image_pixels(&d.image);
        match d.pos {
            None => {
                textures.insert(*id, Texture { size, pixels });
            }
            Some([x0, y0]) => {
                if let Some(tex) = textures.get_mut(id) {
                    for y in 0..size[1] {
                        for x in 0..size[0] {
                            let (tx, ty) = (x0 + x, y0 + y);
                            if tx < tex.size[0] && ty < tex.size[1] {
                                tex.pixels[ty * tex.size[0] + tx] = pixels[y * size[0] + x];
                            }
                        }
                    }
                }
            }
        }
    }
}

fn sample(tex: &Texture, u: f32, v: f32) -> [f32; 4] {
    let (w, h) = (tex.size[0] as f32, tex.size[1] as f32);
    let x = (u * w - 0.5).clamp(0.0, w - 1.0);
    let y = (v * h - 0.5).clamp(0.0, h - 1.0);
    let (x0, y0) = (x.floor() as usize, y.floor() as usize);
    let (x1, y1) = ((x0 + 1).min(tex.size[0] - 1), (y0 + 1).min(tex.size[1] - 1));
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    let px = |xx: usize, yy: usize| {
        let c = tex.pixels[yy * tex.size[0] + xx];
        [c.r() as f32, c.g() as f32, c.b() as f32, c.a() as f32]
    };
    let (a, b, c, d) = (px(x0, y0), px(x1, y0), px(x0, y1), px(x1, y1));
    let mut out = [0.0; 4];
    for i in 0..4 {
        let top = a[i] + (b[i] - a[i]) * fx;
        let bot = c[i] + (d[i] - c[i]) * fx;
        out[i] = top + (bot - top) * fy;
    }
    out
}

fn rasterize(
    prims: &[ClippedPrimitive],
    textures: &HashMap<TextureId, Texture>,
    size: [usize; 2],
    ppp: f32,
) -> image::RgbaImage {
    let (w, h) = (size[0], size[1]);
    let mut buf = vec![[0.0f32, 0.0, 0.0, 255.0]; w * h];
    for prim in prims {
        let Primitive::Mesh(mesh) = &prim.primitive else {
            continue;
        };
        let Some(tex) = textures.get(&mesh.texture_id) else {
            continue;
        };
        let clip = Rect::from_min_max(prim.clip_rect.min * ppp, prim.clip_rect.max * ppp)
            .intersect(Rect::from_min_size(Pos2::ZERO, Vec2::new(w as f32, h as f32)));
        if clip.width() <= 0.0 || clip.height() <= 0.0 {
            continue;
        }
        for tri in mesh.indices.chunks_exact(3) {
            let v = [
                &mesh.vertices[tri[0] as usize],
                &mesh.vertices[tri[1] as usize],
                &mesh.vertices[tri[2] as usize],
            ];
            let p: Vec<Pos2> = v.iter().map(|vx| vx.pos * ppp).collect();
            let area = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[2].x - p[0].x) * (p[1].y - p[0].y);
            if area.abs() < 1e-6 {
                continue;
            }
            let min_x = p.iter().map(|q| q.x).fold(f32::MAX, f32::min).max(clip.min.x).floor() as i32;
            let max_x = p.iter().map(|q| q.x).fold(f32::MIN, f32::max).min(clip.max.x).ceil() as i32;
            let min_y = p.iter().map(|q| q.y).fold(f32::MAX, f32::min).max(clip.min.y).floor() as i32;
            let max_y = p.iter().map(|q| q.y).fold(f32::MIN, f32::max).min(clip.max.y).ceil() as i32;
            let cols: Vec<[f32; 4]> = v
                .iter()
                .map(|vx| {
                    let c = vx.color;
                    [c.r() as f32, c.g() as f32, c.b() as f32, c.a() as f32]
                })
                .collect();
            for y in min_y.max(0)..max_y.min(h as i32) {
                for x in min_x.max(0)..max_x.min(w as i32) {
                    let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                    if px < clip.min.x || px >= clip.max.x || py < clip.min.y || py >= clip.max.y {
                        continue;
                    }
                    let w0 = ((p[1].x - px) * (p[2].y - py) - (p[2].x - px) * (p[1].y - py)) / area;
                    let w1 = ((p[2].x - px) * (p[0].y - py) - (p[0].x - px) * (p[2].y - py)) / area;
                    let w2 = 1.0 - w0 - w1;
                    if w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4 {
                        continue;
                    }
                    let u = w0 * v[0].uv.x + w1 * v[1].uv.x + w2 * v[2].uv.x;
                    let vv = w0 * v[0].uv.y + w1 * v[1].uv.y + w2 * v[2].uv.y;
                    let t = sample(tex, u, vv);
                    let mut src = [0.0f32; 4];
                    for i in 0..4 {
                        let vc = w0 * cols[0][i] + w1 * cols[1][i] + w2 * cols[2][i];
                        src[i] = vc * t[i] / 255.0;
                    }
                    let dst = &mut buf[y as usize * w + x as usize];
                    let inv = 1.0 - src[3] / 255.0;
                    for i in 0..4 {
                        dst[i] = src[i] + dst[i] * inv;
                    }
                }
            }
        }
    }
    let mut img = image::RgbaImage::new(w as u32, h as u32);
    for (i, px) in buf.iter().enumerate() {
        img.put_pixel(
            (i % w) as u32,
            (i / w) as u32,
            image::Rgba([
                px[0].clamp(0.0, 255.0) as u8,
                px[1].clamp(0.0, 255.0) as u8,
                px[2].clamp(0.0, 255.0) as u8,
                255,
            ]),
        );
    }
    img
}

fn main() {
    let mut args = std::env::args().skip(1);
    let out_dir = args.next().unwrap_or_else(|| "snapshots".into());
    let wanted: Vec<String> = args.collect();
    std::fs::create_dir_all(&out_dir).expect("create output dir");

    let ppp = 1.0f32;
    let logical = Vec2::new(1360.0, 860.0);
    let px_size = [(logical.x * ppp) as usize, (logical.y * ppp) as usize];

    for scene in demo::SCENES {
        if !wanted.is_empty() && !wanted.iter().any(|w| w == scene) {
            continue;
        }
        let ctx = egui::Context::default();
        let mut app = demo::app_for_scene(&ctx, scene);
        let mut textures = HashMap::new();
        let mut last = None;
        for frame in 0..14 {
            let raw = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(Pos2::ZERO, logical)),
                time: Some(frame as f64 * 0.25),
                ..Default::default()
            };
            let out = ctx.run(raw, |ctx| {
                ctx.set_pixels_per_point(ppp);
                demo::drive(&mut app, ctx, scene, frame);
            });
            apply_textures(&mut textures, &out.textures_delta);
            last = Some(out.shapes);
            std::thread::sleep(Duration::from_millis(40));
        }
        let prims = ctx.tessellate(last.unwrap_or_default(), ppp);
        let img = rasterize(&prims, &textures, px_size, ppp);
        let path = format!("{out_dir}/{scene}.png");
        img.save(&path).expect("write png");
        println!("{path}");
    }
}
