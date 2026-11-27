// Spremeni glasnost MP3 brez ponovnega kodiranja (kot mp3gain): vsakemu
// granulu prišteje korake k polju global_gain (1 korak = 1,5 dB, 4 = +6 dB).
// Uporaba: node mp3gain.mjs <vhod.mp3>                → povprečni global_gain
//          node mp3gain.mjs <vhod.mp3> <izhod.mp3> <koraki>
import fs from "node:fs";

const [, , inp, out, stepsS] = process.argv;
const steps = Number(stepsS ?? 0);
const buf = Buffer.from(fs.readFileSync(inp));

let pos = 0;
if (buf.toString("latin1", 0, 3) === "ID3") {
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  pos = 10 + size + (buf[5] & 0x10 ? 10 : 0);
}

const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

// Branje / pisanje bitov od danega bajta naprej.
const getBits = (base, bit, n) => {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const b = bit + i;
    v = (v << 1) | ((buf[base + (b >> 3)] >> (7 - (b & 7))) & 1);
  }
  return v;
};
const setBits = (base, bit, n, v) => {
  for (let i = 0; i < n; i++) {
    const b = bit + i, byte = base + (b >> 3), mask = 1 << (7 - (b & 7));
    if ((v >> (n - 1 - i)) & 1) buf[byte] |= mask;
    else buf[byte] &= ~mask;
  }
};

let frames = 0, sum = 0, cnt = 0, max = 0, clamped = 0;
while (pos + 4 <= buf.length) {
  const h = buf.readUInt32BE(pos);
  if ((h & 0xffe00000) >>> 0 !== 0xffe00000) { pos++; continue; }
  const verBits = (h >>> 19) & 3, layerBits = (h >>> 17) & 3;
  const brIdx = (h >>> 12) & 15, srIdx = (h >>> 10) & 3, pad = (h >>> 9) & 1;
  if (verBits === 1 || layerBits !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { pos++; continue; }
  const ver = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
  const kbps = (ver === 1 ? BR1 : BR2)[brIdx];
  const sr = RATES[ver][srIdx];
  const len = Math.floor(((ver === 1 ? 144 : 72) * kbps * 1000) / sr) + pad;
  if (len < 4 || pos + len > buf.length) break;
  const crc = ((h >>> 16) & 1) === 0;
  const mono = ((h >>> 6) & 3) === 3;
  const nch = mono ? 1 : 2;
  const side = pos + 4 + (crc ? 2 : 0);
  // Okvir Xing/Info na začetku nima zvoka.
  const tag = buf.toString("latin1", side + (ver === 1 ? (mono ? 17 : 32) : mono ? 9 : 17), side + (ver === 1 ? (mono ? 17 : 32) : mono ? 9 : 17) + 4);
  if (!(frames === 0 && (tag === "Xing" || tag === "Info"))) {
    // Začetni biti pred granuli in dolžina zapisa granula/kanala.
    const head = ver === 1 ? 9 + (mono ? 5 : 3) + 4 * nch : 8 + (mono ? 1 : 2);
    const per = ver === 1 ? 59 : 63;
    const grans = ver === 1 ? 2 : 1;
    for (let g = 0; g < grans; g++)
      for (let c = 0; c < nch; c++) {
        const bit = head + (g * nch + c) * per + 12 + 9; // za part2_3_length in big_values
        const gg = getBits(side, bit, 8);
        sum += gg; cnt++; max = Math.max(max, gg);
        if (steps && gg > 0) {
          let v = gg + steps;
          if (v > 255) { v = 255; clamped++; }
          if (v < 0) v = 0;
          setBits(side, bit, 8, v);
        }
      }
  }
  frames++;
  pos += len;
}

console.log(`okvirjev ${frames}, global_gain povp. ${(sum / cnt).toFixed(1)}, max ${max}${clamped ? `, omejenih ${clamped}` : ""}`);
if (out && steps) {
  fs.writeFileSync(out, buf);
  console.log(`zapisano ${out} (${steps > 0 ? "+" : ""}${(steps * 1.5).toFixed(1)} dB)`);
}
