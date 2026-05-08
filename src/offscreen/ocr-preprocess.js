(() => {
  if (globalThis.OcrPreprocess) {
    return;
  }

  function bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hex = '';

    for (let i = 0; i < bytes.length; i += 1) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }

    return hex;
  }

  async function hashBlob(blob) {
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return bufferToHex(digest);
  }

  function clampByte(value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return value;
  }

  function computeOtsuThreshold(histogram, total) {
    let sum = 0;
    for (let i = 0; i < 256; i += 1) {
      sum += i * histogram[i];
    }

    let sumBackground = 0;
    let backgroundWeight = 0;
    let maxBetweenClassVariance = 0;
    let threshold = 128;

    for (let i = 0; i < 256; i += 1) {
      backgroundWeight += histogram[i];
      if (backgroundWeight === 0) {
        continue;
      }

      const foregroundWeight = total - backgroundWeight;
      if (foregroundWeight === 0) {
        break;
      }

      sumBackground += i * histogram[i];
      const backgroundMean = sumBackground / backgroundWeight;
      const foregroundMean = (sum - sumBackground) / foregroundWeight;
      const betweenClassVariance = backgroundWeight
        * foregroundWeight
        * (backgroundMean - foregroundMean)
        * (backgroundMean - foregroundMean);

      if (betweenClassVariance > maxBetweenClassVariance) {
        maxBetweenClassVariance = betweenClassVariance;
        threshold = i;
      }
    }

    return threshold;
  }

  function computeTargetSize(width, height, options) {
    let scale = 1;

    if (options.upscale) {
      const shortSide = Math.min(width, height);
      const targetShortSide = options.upscaleMinDimension || 900;
      const maxScale = options.upscaleMaxScale || 2;

      if (shortSide > 0 && shortSide < targetShortSide) {
        scale = Math.min(maxScale, targetShortSide / shortSide);
      }
    }

    const maxPixels = options.maxPixels || 4000000;
    const scaledPixels = width * height * scale * scale;
    if (scale > 1 && scaledPixels > maxPixels) {
      scale = Math.sqrt(maxPixels / (width * height));
    }

    scale = Math.max(1, scale);

    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  async function preprocessImage(blob, options) {
    const bitmap = await createImageBitmap(blob);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const { width, height } = computeTargetSize(sourceWidth, sourceHeight, options);
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }

    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    const histogram = options.threshold ? new Uint32Array(256) : null;
    const contrastFactor = options.contrast ? (1 + options.contrast) : 1;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      let gray = options.grayscale ? (0.299 * r + 0.587 * g + 0.114 * b) : r;

      if (options.contrast) {
        gray = 128 + (gray - 128) * contrastFactor;
      }

      gray = clampByte(gray) | 0;

      if (options.invert) {
        gray = 255 - gray;
      }

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      data[i + 3] = 255;

      if (histogram) {
        histogram[gray] += 1;
      }
    }

    if (histogram) {
      const threshold = computeOtsuThreshold(histogram, width * height);

      for (let i = 0; i < data.length; i += 4) {
        const value = data[i] > threshold ? 255 : 0;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }
    }

    context.putImageData(imageData, 0, 0);

    if (typeof canvas.convertToBlob === 'function') {
      return canvas.convertToBlob({ type: 'image/png' });
    }

    return new Promise(resolve => {
      canvas.toBlob(resolved => resolve(resolved), 'image/png');
    });
  }

  globalThis.OcrPreprocess = Object.freeze({
    hashBlob,
    preprocessImage
  });
})();
