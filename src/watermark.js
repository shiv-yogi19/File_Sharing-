// Client-side image watermark. Returns a NEW File; the original is never mutated.
export const TEXT = 'Created By Shiv Yogi';
export const canWatermark = f => /^image\/(jpeg|png|webp)$/.test(f.type) && typeof createImageBitmap === 'function';

export async function watermarkImage(file) {
  if (!canWatermark(file)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const fs = Math.max(16, Math.round(bmp.width / 26)), pad = fs * 0.7;
    x.font = `600 ${fs}px system-ui, sans-serif`; x.textAlign = 'right'; x.textBaseline = 'bottom';
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = fs / 3; x.fillStyle = 'rgba(255,255,255,.72)';
    x.fillText(TEXT, c.width - pad, c.height - pad);
    bmp.close();
    const blob = await new Promise(r => c.toBlob(r, file.type, 0.92));
    if (!blob) return file;
    return new File([blob], file.name.replace(/(\.[^.]+)?$/, '_FluxDrop$1'), { type: file.type });
  } catch { return file; } // on any failure keep the original untouched
}
