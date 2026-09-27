import test from 'node:test';
import assert from 'node:assert/strict';
import { audioFormat, imageFormat, uploadForm, AUDIO_MAX_SIZE } from '../src/lib/upload-files.js';

test('audio uses content signatures, not file names or claimed MIME types', () => {
  assert.equal(audioFormat(Buffer.from('<svg onload=alert(1)>fake.mp3</svg>')), null);
  const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
  assert.deepEqual(audioFormat(wav),{type:'audio/wav',ext:'wav'});
  for(const [header,ext] of [['ID3','mp3'],['fLaC','flac'],['OggS','ogg']]) {
    const b=Buffer.alloc(20);b.write(header);assert.equal(audioFormat(b).ext,ext);
  }
  assert.equal(imageFormat('image/svg+xml'),null);
  assert.equal(imageFormat('image/png').ext,'png');
});
test('multipart has a hard streaming limit even without Content-Length', async()=>{
  let canceled=false;
  const request=new Request('https://notizen.dev/api/upload', {method:'POST',duplex:'half',body:new ReadableStream({
    start(c){c.enqueue(new Uint8Array(AUDIO_MAX_SIZE+1024*1024+1));},
    cancel(){canceled=true;}
  })});
  await assert.rejects(()=>uploadForm(request),/File too large/);
  assert.equal(canceled,true);
});
