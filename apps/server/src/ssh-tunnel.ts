import ssh2 from 'ssh2';
const { Client } = ssh2;
import { createHash } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import type { ConnectionInput } from '../../../packages/protocol/src/index.js';
let activeLeases=0;
const failure=(code:string)=>Object.assign(new Error(code),{code});

/** A single operation owns its forwarding lease. No pooling, shell or replay. */
export async function withSshTunnel<T,P extends ConnectionInput>(profile:P, operation:(effective:P)=>Promise<T>, signal?:AbortSignal):Promise<T>{
  if(profile.engine==='sqlite'||!profile.ssh)return operation(profile);
  if(activeLeases>=32)throw failure('SSH_CAPACITY');
  signal?.throwIfAborted();activeLeases++;
  const client=new Client(), sockets=new Set<Socket>();
  let closed=false, listening=false, ready=false, pinMismatch=false;
  const server=createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    client.forwardOut('127.0.0.1',socket.remotePort??0,profile.host,profile.port,(error,channel)=>{
      if(error||closed||socket.destroyed){channel?.destroy();socket.destroy();return;}
      channel.on('error',()=>socket.destroy());channel.on('close',()=>socket.destroy());
      socket.on('close',()=>channel.destroy());socket.pipe(channel).pipe(socket);
    });
  });
  const close=()=>{
    if(closed)return;closed=true;
    for(const socket of sockets)socket.destroy();
    if(listening)server.close();
    client.destroy();activeLeases--;
  };
  try{
    const port=await new Promise<number>((resolve,reject)=>{
      const fail=(error:unknown)=>{cleanup();close();reject(error);};
      const abort=()=>fail(failure('SSH_CANCELLED'));
      const timer=setTimeout(()=>fail(failure('SSH_TIMEOUT')),8000);timer.unref();
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      signal?.addEventListener('abort',abort,{once:true});
      client.on('error',(error:Error & {level?:string})=>{
        cleanup();fail(failure(pinMismatch?'SSH_HOST_KEY_MISMATCH':error.level==='client-authentication'?'SSH_AUTH_FAILED':'SSH_CONNECTION_FAILED'));
      });
      client.on('close',()=>{if(!ready){cleanup();fail(failure(pinMismatch?'SSH_HOST_KEY_MISMATCH':'SSH_CONNECTION_FAILED'));}else close();});
      server.on('error',()=>{cleanup();fail(failure('SSH_FORWARD_FAILED'));});
      client.once('ready',()=>{
        if(closed)return;
        server.listen(0,'127.0.0.1',()=>{
          listening=true;if(closed){server.close();return;}
          ready=true;cleanup();resolve((server.address() as {port:number}).port);
        });
      });
      try{client.connect({host:profile.ssh!.host,port:profile.ssh!.port,username:profile.ssh!.user,password:profile.ssh!.password,readyTimeout:8000,keepaliveInterval:15000,keepaliveCountMax:2,
        hostVerifier:(key:Buffer)=>{const observed=`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/,'')}`;pinMismatch=observed!==profile.ssh!.hostFingerprint;return !pinMismatch;},
      });}catch{cleanup();fail(failure('SSH_CONNECTION_FAILED'));}
    });
    signal?.throwIfAborted();
    return await operation({...profile,host:'127.0.0.1',port,ssh:undefined,tlsServerName:profile.tlsServerName||profile.host} as P);
  }finally{close();}
}
