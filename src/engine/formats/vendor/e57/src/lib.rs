#![allow(static_mut_refs)]
//! Tiny WebAssembly reader around the MIT `e57` crate (cry-inc/e57 0.11.7).
//!
//! Rebuild, from this directory, after the wasm32 target is installed:
//! `cargo build --release --target wasm32-unknown-unknown`
//! Copy `target/wasm32-unknown-unknown/release/e57_read.wasm` to `e57_read.wasm`.

use e57::{CartesianCoordinate, E57Reader};
use std::io::Cursor;

static mut INPUT: Vec<u8> = Vec::new();
static mut OUTPUT: Vec<f64> = Vec::new();
static mut ERROR: Vec<u8> = Vec::new();

fn set_error(message: &str) {
    unsafe {
        ERROR.clear();
        ERROR.extend_from_slice(message.as_bytes());
    }
}

#[no_mangle]
pub extern "C" fn input_ptr(len: usize) -> *mut u8 {
    unsafe {
        INPUT.clear();
        INPUT.resize(len, 0);
        INPUT.as_mut_ptr()
    }
}

/// Point count, or -1 when `error_ptr` holds a message.
#[no_mangle]
pub extern "C" fn parse(len: usize) -> i32 {
    let bytes = unsafe {
        if INPUT.len() < len {
            set_error("The E57 buffer was shorter than promised.");
            return -1;
        }
        INPUT[..len].to_vec()
    };
    match read_points(bytes) {
        Ok(points) => {
            let count = (points.len() / 3) as i32;
            unsafe {
                OUTPUT = points;
                ERROR.clear();
            }
            count
        }
        Err(message) => {
            set_error(&message);
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn points_ptr() -> *const f64 {
    unsafe { OUTPUT.as_ptr() }
}

#[no_mangle]
pub extern "C" fn error_ptr() -> *const u8 {
    unsafe { ERROR.as_ptr() }
}

#[no_mangle]
pub extern "C" fn error_len() -> usize {
    unsafe { ERROR.len() }
}

fn read_points(bytes: Vec<u8>) -> Result<Vec<f64>, String> {
    let mut reader = E57Reader::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let clouds = reader.pointclouds().to_vec();
    if clouds.is_empty() {
        return Err("That E57 has no point clouds.".to_string());
    }
    let mut out = Vec::new();
    for cloud in &clouds {
        let iter = reader.pointcloud_simple(cloud).map_err(|error| error.to_string())?;
        for point in iter {
            let point = point.map_err(|error| error.to_string())?;
            let (x, y, z) = match point.cartesian {
                CartesianCoordinate::Valid { x, y, z } | CartesianCoordinate::Direction { x, y, z } => (x, y, z),
                CartesianCoordinate::Invalid => continue,
            };
            if x.is_finite() && y.is_finite() && z.is_finite() {
                out.push(x);
                out.push(y);
                out.push(z);
            }
        }
    }
    if out.is_empty() {
        return Err("That E57 has no Cartesian points.".to_string());
    }
    Ok(out)
}
