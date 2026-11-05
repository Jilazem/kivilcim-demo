// PNG bağımsız denetim — harici paket YOK (node:zlib + node:fs).
// Amaç: capture dosyasının gerçekten çizilmiş olduğunu koddan bağımsız ölçmek.
// Kullanım: node tools/png-denetim.mjs out/kabul/smoke-1/smoke-1.png
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

function okuPng(dosya) {
  const buf = readFileSync(dosya);
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('PNG imzası yok');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlace desteklenmiyor');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const kanal = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!kanal || bitDepth !== 8) throw new Error(`desteklenmeyen format bitDepth=${bitDepth} colorType=${colorType}`);
  const ham = inflateSync(Buffer.concat(idat));
  const satir = w * kanal + 1;
  const px = Buffer.alloc(w * h * kanal);
  let prev = Buffer.alloc(w * kanal);
  for (let y = 0; y < h; y++) {
    const tip = ham[y * satir];
    const cur = Buffer.from(ham.subarray(y * satir + 1, y * satir + satir));
    for (let i = 0; i < cur.length; i++) {
      const a = i >= kanal ? cur[i - kanal] : 0;
      const b = prev[i];
      const c = i >= kanal ? prev[i - kanal] : 0;
      if (tip === 1) cur[i] = (cur[i] + a) & 255;
      else if (tip === 2) cur[i] = (cur[i] + b) & 255;
      else if (tip === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (tip === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (tip !== 0) throw new Error(`bilinmeyen filtre ${tip}`);
    }
    cur.copy(px, y * w * kanal);
    prev = cur;
  }
  return { w, h, kanal, px, bytes: buf.length };
}

const dosya = process.argv[2];
if (!dosya) { console.error('kullanım: node tools/png-denetim.mjs <png>'); process.exit(2); }
const { w, h, kanal, px, bytes } = okuPng(dosya);
const renkler = new Set();
const lum = [];
for (let i = 0; i < px.length; i += kanal) {
  const r = px[i], g = kanal >= 3 ? px[i + 1] : px[i], b = kanal >= 3 ? px[i + 2] : px[i];
  renkler.add((r << 16) | (g << 8) | b);
  lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
}
lum.sort((a, b) => a - b);
const sha256 = createHash('sha256').update(readFileSync(dosya)).digest('hex');
const sonuc = {
  dosya, w, h, kanal, bytes, sha256,
  benzersizRenk: renkler.size,
  tekRenk: renkler.size <= 1,
  parlaklikMin: Math.round(lum[0] * 10) / 10,
  parlaklikMax: Math.round(lum[lum.length - 1] * 10) / 10,
  parlaklikMedyan: Math.round(lum[Math.floor(lum.length / 2)] * 10) / 10,
  baytGte10k: bytes >= 10000,
  cizilmis: renkler.size > 64 && bytes >= 10000,
};
console.log(JSON.stringify(sonuc, null, 2));
process.exit(sonuc.cizilmis ? 0 : 1);
