import fs from 'node:fs';

export const FILES = [
  'docs/index.html',
  'plugins/israel-polls-2026/skills/israel-polls-dashboard/assets/dashboard.html',
];

/* Splits srcFile into 10 base64 chunks under .restore/<prefix>_chunk_NN.b64, replacing any existing ones. */
export function regen(srcFile, prefix){
  const b64 = fs.readFileSync(srcFile).toString('base64');
  const n = 10, size = Math.ceil(b64.length / n);
  for (const f of fs.readdirSync('.restore')) if (f.startsWith(prefix + '_chunk_')) fs.unlinkSync('.restore/' + f);
  for (let i = 0; i < n; i++) fs.writeFileSync(`.restore/${prefix}_chunk_${String(i).padStart(2,'0')}.b64`, b64.slice(i*size, (i+1)*size));
}

export function regenAll(){
  regen(FILES[0], 'index');
  regen(FILES[1], 'dashboard');
}
