// Starts a disposable PostgreSQL cluster with Unix-socket-only access; never uses production settings.
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const configPath='/tmp/notizen-test-db.json';
const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();
if (process.argv.includes('--stop')) {
  const config=JSON.parse(await readFile(configPath,'utf8'));
  execFileSync(join(bin,'pg_ctl'),['-D',join(config.host,'data'),'stop'],{stdio:'ignore'});
  console.log('Stopped isolated test database.');
} else {
  const dir=await mkdtemp(join(tmpdir(),'notizen-pg-'));
  execFileSync(join(bin,'initdb'),['-D',join(dir,'data'),'--auth-local=trust','--auth-host=reject','--no-locale'],{stdio:'ignore'});
  execFileSync(join(bin,'pg_ctl'),['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-k ${dir} -p 55439 -c listen_addresses=''`,'start'],{stdio:'ignore'});
  execFileSync(join(bin,'createdb'),['-h',dir,'-p','55439','notizen_test']);
  await writeFile(configPath,JSON.stringify({host:dir,port:55439,database:'notizen_test',user:userInfo().username}));
  console.log('Isolated test database ready.');
}
