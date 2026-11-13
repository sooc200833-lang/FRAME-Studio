// Animation encoders (browser only). Loaded with a dynamic import when the
// user exports, so the encoder libraries don't slow down app startup.
//
// Each exporter takes a plan from export-plan.js and an async `renderFrame`
// callback that returns a canvas (plan.width × plan.height) for a tick.
// `onProgress(done, total)` reports progress; `signal` cancels.

import { gifFrameDelays, sequenceFileNames } from './export-plan.js';

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('내보내기를 취소했어요', 'AbortError');
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했어요'))), type, quality);
  });
}

const VIDEO_CODECS = {
  mp4: ['avc', 'hevc', 'av1'],
  webm: ['vp9', 'vp8', 'av1'],
};

/** Which video formats this browser can encode at the given size and fps. */
export async function supportedVideoFormats({ width, height, fps }) {
  if (typeof VideoEncoder === 'undefined') return [];
  const { getFirstEncodableVideoCodec } = await import('mediabunny');
  const result = [];
  for (const format of ['mp4', 'webm']) {
    try {
      const codec = await getFirstEncodableVideoCodec(VIDEO_CODECS[format], { width, height, frameRate: fps });
      if (codec) result.push(format);
    } catch { /* not supported */ }
  }
  return result;
}

export async function exportPng(plan, renderFrame) {
  const canvas = await renderFrame(plan.ticks[0]);
  return canvasToBlob(canvas);
}

export async function exportPngSequence(plan, renderFrame, { onProgress, signal } = {}) {
  const { zipSync } = await import('fflate');
  const names = sequenceFileNames(plan.ticks.length);
  const files = {};
  for (let index = 0; index < plan.ticks.length; index++) {
    throwIfAborted(signal);
    const canvas = await renderFrame(plan.ticks[index]);
    const blob = await canvasToBlob(canvas);
    // PNG is already compressed; store without deflating again.
    files[names[index]] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    onProgress?.(index + 1, plan.ticks.length);
  }
  const zipped = zipSync(files);
  return new Blob([zipped], { type: 'application/zip' });
}

export async function exportGif(plan, renderFrame, { onProgress, signal, background = [244, 240, 232] } = {}) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const encoder = GIFEncoder();
  const delays = gifFrameDelays(plan.ticks.length, plan.fps);
  for (let index = 0; index < plan.ticks.length; index++) {
    throwIfAborted(signal);
    const canvas = await renderFrame(plan.ticks[index]);
    const { data } = canvas.getContext('2d').getImageData(0, 0, plan.width, plan.height);
    // GIF has no partial transparency: flatten onto the paper color.
    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = data[offset + 3] / 255;
      if (alpha < 1) {
        data[offset] = Math.round(data[offset] * alpha + background[0] * (1 - alpha));
        data[offset + 1] = Math.round(data[offset + 1] * alpha + background[1] * (1 - alpha));
        data[offset + 2] = Math.round(data[offset + 2] * alpha + background[2] * (1 - alpha));
        data[offset + 3] = 255;
      }
    }
    const palette = quantize(data, 256);
    const indexed = applyPalette(data, palette);
    encoder.writeFrame(indexed, plan.width, plan.height, { palette, delay: delays[index] * 10, repeat: 0 });
    onProgress?.(index + 1, plan.ticks.length);
    // Let the UI breathe between frames; quantizing is CPU heavy.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  encoder.finish();
  return new Blob([encoder.bytes()], { type: 'image/gif' });
}

export async function exportVideo(plan, renderFrame, { onProgress, signal } = {}) {
  const {
    Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec,
  } = await import('mediabunny');
  const codec = await getFirstEncodableVideoCodec(VIDEO_CODECS[plan.format], { width: plan.width, height: plan.height, frameRate: plan.fps });
  if (!codec) throw new Error(`이 브라우저는 ${plan.format.toUpperCase()} 영상을 만들 수 없어요`);
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = plan.width;
  frameCanvas.height = plan.height;
  const frameContext = frameCanvas.getContext('2d');
  const output = new Output({
    format: plan.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(frameCanvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: plan.fps });
  await output.start();
  try {
    const duration = 1 / plan.fps;
    for (let index = 0; index < plan.ticks.length; index++) {
      throwIfAborted(signal);
      const canvas = await renderFrame(plan.ticks[index]);
      frameContext.drawImage(canvas, 0, 0);
      await source.add(index * duration, duration);
      onProgress?.(index + 1, plan.ticks.length);
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
  return new Blob([output.target.buffer], { type: plan.format === 'mp4' ? 'video/mp4' : 'video/webm' });
}

/** Offers the file: share sheet on iPad when available, otherwise a download. */
export async function deliverFile(blob, fileName, { preferShare = false } = {}) {
  const file = new File([blob], fileName, { type: blob.type });
  if (preferShare && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
