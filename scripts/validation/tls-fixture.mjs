// Dedicated databases and short-lived certificates; never uses saved user connections.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const manifest='/private/tmp/dbpilot-tls-fixture.json';
const pg='/opt/homebrew/opt/postgresql@16/bin';
const run=(bin,args)=>execFileSync(bin,args,{stdio:'pipe',timeout:60000});
if(process.argv[2]==='stop'){
  if(existsSync(manifest)){
    const fixture=JSON.parse(readFileSync(manifest,'utf8'));
    if(!fixture.dir.startsWith(join(tmpdir(),'dbpilot-tls-')))throw Error('Unexpected fixture directory');
    try{run('docker',['rm','-f',fixture.container]);}catch{}
    try{run(join(pg,'pg_ctl'),['-D',join(fixture.dir,'pg'),'-m','fast','stop']);}catch{}
    rmSync(fixture.dir,{recursive:true,force:true});rmSync(manifest);
  }
  process.exit(0);
}
if(existsSync(manifest))throw Error('TLS fixture already exists; stop it explicitly before replacing');
const dir=mkdtempSync(join(tmpdir(),'dbpilot-tls-'));
const certs=join(dir,'certs');mkdirSync(certs,{mode:0o755});
const fixture={dir,certs,container:`dbpilot-tls-${Date.now()}`,mysqlPort:55435,postgresPort:55436};
writeFileSync(manifest,JSON.stringify(fixture),{mode:0o600});
try{
  run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(certs,'ca-key.pem'),'-out',join(certs,'ca.pem'),'-days','2','-subj','/CN=DBPilot Fixture CA']);
  run('openssl',['req','-newkey','rsa:2048','-nodes','-keyout',join(certs,'server-key.pem'),'-out',join(certs,'server.csr'),'-subj','/CN=dbpilot.test']);
  writeFileSync(join(certs,'server.ext'),'subjectAltName=DNS:dbpilot.test\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
  run('openssl',['x509','-req','-in',join(certs,'server.csr'),'-CA',join(certs,'ca.pem'),'-CAkey',join(certs,'ca-key.pem'),'-CAcreateserial','-out',join(certs,'server.pem'),'-days','2','-extfile',join(certs,'server.ext')]);
  chmodSync(join(certs,'server-key.pem'),0o644); // Generated test-only key, readable by container mysql UID.
  run(join(pg,'initdb'),['-D',join(dir,'pg'),'-U','postgres','-A','trust','--no-locale']);
  writeFileSync(join(dir,'pg','server-key.pem'),readFileSync(join(certs,'server-key.pem')),{mode:0o600});
  writeFileSync(join(dir,'pg','server.pem'),readFileSync(join(certs,'server.pem')));
  run(join(pg,'pg_ctl'),['-D',join(dir,'pg'),'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${fixture.postgresPort} -c ssl=on -c ssl_cert_file=server.pem -c ssl_key_file=server-key.pem`,'-w','start']);
  run('docker',['run','--detach','--rm','--name',fixture.container,'-p',`127.0.0.1:${fixture.mysqlPort}:3306`,'-e','MYSQL_ROOT_PASSWORD=dbpilot-tls-only','-e','MYSQL_DATABASE=dbpilot_test','--mount',`type=bind,source=${certs},target=/certs,readonly`,'mysql:8.0','--ssl-ca=/certs/ca.pem','--ssl-cert=/certs/server.pem','--ssl-key=/certs/server-key.pem']);
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    try{run('docker',['exec',fixture.container,'mysql','-uroot','-pdbpilot-tls-only','-e','SELECT 1']);ready=true;break;}catch{await new Promise(done=>setTimeout(done,1000));}
  }
  if(!ready)throw Error('TLS MySQL did not start');
  console.log(`TLS fixtures ready: ${manifest}`);
}catch(error){console.error('TLS fixture setup failed; run this script with stop to remove its isolated resources.');throw error;}
