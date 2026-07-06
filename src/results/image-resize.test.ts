import { describe, expect, it } from 'vitest';
import { bookImageParams, fitDimensions, resizeForSlides } from './image-resize';

describe('fitDimensions', () => {
  it('downscales a landscape frame so its longest edge fits, preserving aspect', () => {
    expect(fitDimensions(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('does not downscale when maxEdge is Infinity (full-resolution mode)', () => {
    expect(fitDimensions(1920, 1080, Infinity)).toEqual({ width: 1920, height: 1080 });
  });

  it('downscales a portrait frame by its longest edge', () => {
    expect(fitDimensions(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it('never upscales when the image is already within the cap', () => {
    expect(fitDimensions(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(fitDimensions(1280, 720, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('returns zero dimensions for a non-positive or non-finite size', () => {
    expect(fitDimensions(0, 100, 1280)).toEqual({ width: 0, height: 0 });
    expect(fitDimensions(Number.NaN, 100, 1280)).toEqual({ width: 0, height: 0 });
  });
});

describe('bookImageParams', () => {
  it('defaults to full-resolution WebP (no downscale)', () => {
    const params = bookImageParams(false);
    expect(params.type).toBe('image/webp');
    expect(params.maxEdge).toBe(Infinity);
  });

  it('caps the longest edge to 1280 when downscaling is requested', () => {
    const params = bookImageParams(true);
    expect(params.type).toBe('image/webp');
    expect(params.maxEdge).toBe(1280);
  });
});

describe('resizeForSlides', () => {
  it('keeps the original full-resolution JPEG untouched when not downscaling', async () => {
    const url = 'data:image/jpeg;base64,/9j/AAAA/9k=';
    await expect(resizeForSlides(url, false)).resolves.toBe(url);
  });
});
