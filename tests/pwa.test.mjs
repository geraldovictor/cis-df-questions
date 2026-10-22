import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));

test('installed app stays within the GitHub Pages project and starts without login',()=>{
  const hosted=new URL('https://geraldovictor.github.io/cis-df-questions/manifest.webmanifest');
  assert.equal(new URL(manifest.scope,hosted).pathname,'/cis-df-questions/');
  assert.equal(new URL(manifest.id,hosted).pathname,'/cis-df-questions/');
  const start=new URL(manifest.start_url,hosted);
  assert.equal(start.pathname,'/cis-df-questions/');
  assert.equal(start.searchParams.get('mode'),'offline');
  assert.equal(manifest.display,'standalone');
  assert.ok(manifest.name);
});
test('install icons are real PNGs with declared sizes, including a maskable icon',async()=>{
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose==='maskable'));
  for(const icon of [...manifest.icons,{src:'icons/apple-touch-icon.png',sizes:'180x180'}]) {
    const bytes=await readFile(new URL(icon.src,root));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes);
  }
});
