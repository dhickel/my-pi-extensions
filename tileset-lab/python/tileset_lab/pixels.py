"""Exact uint8 Qt display-buffer arithmetic; no tolerance or source mutation."""
from __future__ import annotations

import numpy as np
from PIL import Image

from .manifest import integer, require, sha256


def visible_rgba(image):
    pixels = np.array(image.convert("RGBA"), dtype=np.uint8)
    pixels[pixels[:, :, 3] == 0] = 0
    return pixels


def visible_digest(image):
    return sha256(visible_rgba(image).tobytes())


def byte_multiply(values, alpha):
    product = np.asarray(values, dtype=np.uint32) * np.asarray(alpha, dtype=np.uint32)
    return ((product + (product >> 8) + 128) >> 8).astype(np.uint8)


def premultiply(image):
    pixels = visible_rgba(image)
    pixels[:, :, :3] = byte_multiply(pixels[:, :, :3], pixels[:, :, 3:4])
    return pixels


def source_over(destination, source):
    """Both arguments are premultiplied uint8 RGBA, source over destination."""
    require(destination.dtype == source.dtype == np.uint8 and destination.shape == source.shape
            and source.shape[-1] == 4, "SourceOver expects equally shaped uint8 RGBA")
    result = source.astype(np.uint16) + byte_multiply(destination, 255 - source[:, :, 3:4])
    require(np.all(result <= 255), "Invalid premultiplied color")
    return result.astype(np.uint8)


def unpremultiply(pixels):
    """Deterministic straight representation for diagnostic PNGs, not a native oracle.

    Native SIMD PNG straight-RGB rounding may differ. Exact native comparisons use
    the premultiplied buffer, while source-role comparisons use visible straight RGBA.
    """
    require(pixels.dtype == np.uint8 and pixels.shape[-1] == 4, "Expected uint8 RGBA")
    result = pixels.copy()
    alpha = pixels[:, :, 3:4].astype(np.uint32)
    numerator = pixels[:, :, :3].astype(np.uint32) * 255 + alpha // 2
    result[:, :, :3] = np.minimum(255, numerator // np.maximum(1, alpha)).astype(np.uint8)
    result[result[:, :, 3] == 0] = 0
    return Image.fromarray(result)


def frame_index_at(durations, elapsed_ms):
    require(bool(durations), "Empty animation")
    for duration in durations:
        integer(duration, "duration", 1)
    integer(elapsed_ms, "elapsed_ms")
    remaining = max(0, elapsed_ms - 1) % sum(durations)
    for index, duration in enumerate(durations):
        if remaining < duration:
            return index
        remaining -= duration
    raise AssertionError("Unreachable animation phase")


def animation_probes(durations):
    """Every ordered frame boundary and wrap, immediately before/at/after."""
    total = sum(durations)
    times = {0, 1}
    boundary = 0
    for duration in durations:
        integer(duration, "duration", 1)
        boundary += duration
        for offset in (0, total):
            times.update((boundary + offset - 1, boundary + offset, boundary + offset + 1))
    return sorted(times)


def compare_visible(expected, actual, label):
    a, b = visible_rgba(expected), visible_rgba(actual)
    require(a.shape == b.shape, f"{label}: visible RGBA dimensions differ")
    mismatch = np.any(a != b, axis=2)
    require(not mismatch.any(), f"{label}: {int(np.count_nonzero(mismatch))} visible RGBA pixel mismatches")


def compare_premultiplied(expected, actual, label):
    observed = premultiply(actual)
    require(expected.shape == observed.shape, f"{label}: raster dimensions differ")
    mismatch = np.any(expected != observed, axis=2)
    require(not mismatch.any(), f"{label}: {int(np.count_nonzero(mismatch))} exact premultiplied RGBA mismatches")
