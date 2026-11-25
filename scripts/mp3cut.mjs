// Izreže odsek MP3 po okvirjih (brez ponovnega kodiranja).
// Uporaba: node mp3cut.mjs <vhod.mp3> <izhod.mp3> <začetek s> <konec s>
import fs from "node:fs";

const [, , inp, out, startS, endS] = process.argv;
const start = Number(startS), end = Number(endS);
const buf = fs.readFileSync(inp);

// Preskoči ID3v2 glavo.
let pos = 0;
if (buf.toString("latin1", 0, 3) === "ID3") {
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  pos = 10 + size + (buf[5] & 0x10 ? 10 : 0);
}

const BITRATES = {
  // [verzija][plast] → tabela (kbps); MPEG1 L3 in MPEG2/2.5 L3
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

const chunks = [];
let t = 0, frames = 0, kept = 0, keptDur = 0;
while (pos + 4 <= buf.length) {
  const h = buf.readUInt32BE(pos);
  if ((h & 0xffe00000) >>> 0 !== 0xffe00000) { pos++; continue; } // sinhronizacija
  const verBits = (h >>> 19) & 3, layerBits = (h >>> 17) & 3;
  const brIdx = (h >>> 12) & 15, srIdx = (h >>> 10) & 3, pad = (h >>> 9) & 1;
  if (verBits === 1 || layerBits !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { pos++; continue; }
  const ver = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
  const kbps = BITRATES[ver === 1 ? "1-3" : "2-3"][brIdx];
  const sr = RATES[ver][srIdx];
  const samples = ver === 1 ? 1152 : 576;
  const len = Math.floor(((ver === 1 ? 144 : 72) * kbps * 1000) / sr) + pad;
  if (len < 4 || pos + len > buf.length) break;
  const dur = samples / sr;
  if (t >= start && t < end) { chunks.push(buf.subarray(pos, pos + len)); kept++; keptDur += dur; }
  t += dur; frames++; pos += len;
  if (t >= end) break;
}
fs.writeFileSync(out, Buffer.concat(chunks));
console.log(`okvirjev skupaj ${frames}, izrezanih ${kept}, trajanje ${keptDur.toFixed(2)} s`);
