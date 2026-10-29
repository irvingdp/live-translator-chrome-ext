// Renders the intro in every locale, plus a poster still, into the website.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? '../site/public/video';
mkdirSync(out, { recursive: true });

const run = (...args) => execFileSync('npx', ['remotion', ...args], { stdio: 'inherit' });

for (const locale of ['en', 'zh-TW']) {
  const id = `intro-${locale}`;
  run('render', id, `${out}/${id}.mp4`, '--codec=h264', '--crf=23');
  // Frame 450: captions are on screen, which makes the best poster.
  run('still', id, `${out}/${id}.jpg`, '--frame=450', '--image-format=jpeg');
}
