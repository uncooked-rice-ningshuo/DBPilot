import ssh2, { type Connection } from 'ssh2';
const { Server, utils } = ssh2;
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

export async function sshFixture(allowedPorts: number[]) {
  const key = generateKeyPairSync('rsa', { modulusLength:2048, privateKeyEncoding:{type:'pkcs1',format:'pem'}, publicKeyEncoding:{type:'spki',format:'pem'} }).privateKey;
  const parsed=utils.parseKey(key);if(parsed instanceof Error)throw parsed;
  const fingerprint=`SHA256:${createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/,'')}`;
  const clients=new Set<Connection>(), sockets=new Set<Socket>();
  const metrics={authentications:0,forwards:0};
  const server=new Server({hostKeys:[key]},client=>{
    clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
    client.on('authentication',context=>{metrics.authentications++;if(context.method==='password'&&context.username==='fixture'&&context.password==='ssh-fixture-only')context.accept();else context.reject();});
    client.on('ready',()=>client.on('tcpip',(accept,reject,info)=>{
      if(info.destIP!=='127.0.0.1'||!allowedPorts.includes(info.destPort)){reject();return;}
      metrics.forwards++;
      const socket=createConnection({host:info.destIP,port:info.destPort});sockets.add(socket);
      socket.on('close',()=>sockets.delete(socket));
      socket.once('error',()=>{reject();socket.destroy();});
      socket.once('connect',()=>{const stream=accept();socket.removeAllListeners('error');socket.on('error',()=>stream.destroy());stream.on('error',()=>socket.destroy());stream.on('close',()=>socket.destroy());stream.pipe(socket).pipe(stream);});
    }));
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  return {port:(server.address() as {port:number}).port,fingerprint,metrics,
    disconnect(){for(const client of clients)client.end();for(const socket of sockets)socket.destroy();},
    async close(){for(const client of clients)client.end();for(const socket of sockets)socket.destroy();await new Promise<void>(done=>server.close(()=>done()));},
  };
}
