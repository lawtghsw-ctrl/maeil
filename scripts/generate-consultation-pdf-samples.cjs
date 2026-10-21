#!/usr/bin/env node
// Offline synthetic records only. No credentials, Supabase, network, or customer data.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, snapshot, shortSnapshot } = require('../tests/helpers/consultation-pdf.cjs');
async function main() {
  const output = path.resolve(process.argv[2] || '/tmp/lawpower-consultation-pdf-samples');
  fs.mkdirSync(output, { recursive: true });
  const font = fs.readFileSync(path.join(__dirname, '../public/fonts/NanumGothic-Regular.ttf')).toString('base64');
  const pdf = load('lib/consultation-pdf.ts');
  for (const [name, input] of [['short', shortSnapshot()], ['populated', snapshot()], ['stress', snapshot(true)]]) {
    const file = path.join(output, `${name}.pdf`);
    const blob = await pdf.createConsultationPdf(input, font);
    fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
    console.log(`${name}: ${info.match(/Pages:\s+(\d+)/)[1]} page(s), ${file}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
