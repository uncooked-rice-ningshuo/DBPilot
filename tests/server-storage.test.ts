import {ConnectionStore} from '../packages/storage/src/connections.js';
import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {resolveServerStorage,serverProjectRoot} from '../apps/server/src/server-storage.js';
it('defaults to one persistent project directory and creates/reuses a private key once',()=>{
 const root=mkdtempSync(join(tmpdir(),'dbpilot-bootstrap-'));
 try{const first=resolveServerStorage({},root);const second=resolveServerStorage({},root);expect(first.persistent).toBe(true);expect(first.dataDir).toBe(join(root,'.data','runtime'));expect(second).toEqual(first);expect(Buffer.from(first.masterKey!,'base64')).toHaveLength(32);if(process.platform!=='win32')expect(statSync(join(first.dataDir!,'secrets','master.key')).mode&0o777).toBe(0o600);}finally{rmSync(root,{recursive:true,force:true});}
});
it('honors a non-secret saved profile and explicit environment override without replacing keys',()=>{
 const root=mkdtempSync(join(tmpdir(),'dbpilot-profile-'));const key=randomBytes(32).toString('base64');
 try{mkdirSync(join(root,'.data','secrets'),{recursive:true});writeFileSync(join(root,'.data','secrets','master.key'),key,{mode:0o600});writeFileSync(join(root,'.data','server-profile.json'),JSON.stringify({dataDir:'legacy',masterKeyFile:'secrets/master.key'}));
 expect(resolveServerStorage({},root)).toEqual({dataDir:join(root,'.data','legacy'),masterKey:key,persistent:true});
 expect(resolveServerStorage({DBPILOT_DATA_DIR:'custom',DBPILOT_MASTER_KEY:key},root)).toEqual({dataDir:join(root,'custom'),masterKey:key,persistent:true});
 expect(readFileSync(join(root,'.data','secrets','master.key'),'utf8')).toBe(key);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('fails closed on lost/corrupt keys and makes ephemeral mode explicit',()=>{
 const root=mkdtempSync(join(tmpdir(),'dbpilot-lost-key-'));
 try{const data=join(root,'.data','runtime');mkdirSync(data,{recursive:true});writeFileSync(join(data,'metadata.db'),'existing');expect(()=>resolveServerStorage({},root)).toThrow(/original/);expect(()=>resolveServerStorage({DBPILOT_MASTER_KEY:'invalid'},root)).toThrow(/32-byte/);expect(resolveServerStorage({DBPILOT_EPHEMERAL:'1'},root)).toEqual({dataDir:undefined,masterKey:undefined,persistent:false});expect(()=>resolveServerStorage({DBPILOT_EPHEMERAL:'1',DBPILOT_DATA_DIR:'custom'},root)).toThrow();}finally{rmSync(root,{recursive:true,force:true});}
});
it('finds the same installation root from source and compiled entry directories',()=>{expect(serverProjectRoot(resolve('apps/server/src'))).toBe(resolve('.'));expect(serverProjectRoot(resolve('dist/server/apps/server/src'))).toBe(resolve('.'));});

it('upgrades an old SQLite-only workspace without inventing a replacement for existing encrypted credentials',()=>{
 const root=mkdtempSync(join(tmpdir(),'dbpilot-key-upgrade-'));const dataDir=join(root,'.data','runtime');
 try{let store=new ConnectionStore(dataDir);const saved=store.add({engine:'sqlite',name:'existing',filename:'/tmp/existing.db'});store.close();
 const resolved=resolveServerStorage({},root);store=new ConnectionStore(dataDir,resolved.masterKey);expect(store.get(saved.id)).toEqual(saved);store.close();
 const encryptedDir=join(root,'encrypted');const encrypted=new ConnectionStore(encryptedDir,randomBytes(32).toString('base64'));encrypted.add({engine:'mysql',name:'existing',host:'localhost',port:3306,database:'app',user:'me',password:'old-secret',ssl:false});encrypted.close();
 expect(()=>resolveServerStorage({DBPILOT_DATA_DIR:encryptedDir},root)).toThrow(/original/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
