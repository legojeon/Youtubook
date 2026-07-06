import { describe, expect, it } from 'vitest';
import { fitDimensions } from './image-resize';

describe('fitDimensions', () => {
  it('downscales a landscape frame so its longest edge fits, preserving aspect', () => {
    expect(fitDimensions(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
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
