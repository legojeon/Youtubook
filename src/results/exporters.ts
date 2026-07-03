import { jsPDF } from 'jspdf';
import PptxGenJS from 'pptxgenjs';
import { formatScript, type ScriptEntry } from '../core/format';

/** 페이지 크기 = 영상 픽셀 크기 (비율 유지 — 쇼츠는 세로 페이지). */
export function buildPdf(images: string[], w: number, h: number): Blob {
  const doc = new jsPDF({
    orientation: w >= h ? 'landscape' : 'portrait',
    unit: 'px',
    format: [w, h],
    hotfixes: ['px_scaling'],
  });
  images.forEach((img, i) => {
    if (i > 0) doc.addPage([w, h], w >= h ? 'landscape' : 'portrait');
    doc.addImage(img, 'JPEG', 0, 0, w, h);
  });
  return doc.output('blob');
}

/** 슬라이드 비율 = 영상 비율. 대본은 발표자 노트로. */
export async function buildPptx(
  slides: { image: string; notes: string }[],
  w: number,
  h: number,
): Promise<Blob> {
  const pptx = new PptxGenJS();
  const wIn = 10;
  const hIn = Number((10 * (h / w)).toFixed(3));
  pptx.defineLayout({ name: 'YOUTUBOOK', width: wIn, height: hIn });
  pptx.layout = 'YOUTUBOOK';
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.addImage({ data: s.image, x: 0, y: 0, w: wIn, h: hIn });
    if (s.notes) slide.addNotes(s.notes);
  }
  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

export function buildTxt(entries: ScriptEntry[]): Blob {
  return new Blob([formatScript(entries)], { type: 'text/plain;charset=utf-8' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
