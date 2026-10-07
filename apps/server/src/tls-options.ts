import { checkServerIdentity } from 'node:tls';
import { createConnection, isIP } from 'node:net';
import type { ClientConfig } from 'pg';
import type { ConnectionOptions } from 'mysql2';
import type { ConnectionInput } from '../../../packages/protocol/src/index.js';
type NetworkProfile = Exclude<ConnectionInput, {engine:'sqlite'}>;
export function postgresTls(profile: NetworkProfile): ClientConfig['ssl'] {
  if(!profile.ssl)return false;
  const identity=profile.tlsServerName || profile.host;
  return { rejectUnauthorized:true, ca:profile.tlsCa || undefined,
    servername:isIP(identity)?undefined:identity,
    checkServerIdentity:(_name,certificate)=>checkServerIdentity(identity,certificate),
  };
}
export function mysqlTlsOptions(profile: NetworkProfile): Pick<ConnectionOptions,'ssl'|'host'|'stream'> {
  if(!profile.ssl)return {ssl:undefined};
  const identity=profile.tlsServerName || profile.host;
  // mysql2's TLS implementation omits both host and SNI for IP addresses.
  // Require an explicit DNS identity instead of allowing its localhost fallback.
  if(isIP(identity))throw Object.assign(new Error('MySQL TLS requires a DNS certificate server name when connecting to an IP address'),{code:'DBPILOT_TLS_IDENTITY_REQUIRED'});
  return {host:identity,stream:()=>createConnection({host:profile.host,port:profile.port}),ssl:{ca:profile.tlsCa || undefined,rejectUnauthorized:true,verifyIdentity:true}};
}
