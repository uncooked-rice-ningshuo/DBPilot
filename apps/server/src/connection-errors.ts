import type { ConnectionInput } from '../../../packages/protocol/src/index.js';

export function connectionFailure(profile: ConnectionInput, error: unknown): string {
  if (profile.engine === 'sqlite') return 'SQLite 文件无法打开；请检查路径、文件是否存在，以及运行 DBPilot 的机器是否有读取权限';

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  switch (code) {
    case 'SSH_HOST_KEY_MISMATCH': return 'SSH 主机指纹不匹配，连接已阻断；请从可信渠道核验服务器指纹';
    case 'SSH_AUTH_FAILED': return 'SSH 认证失败，请检查跳板机用户名和密码';
    case 'SSH_TIMEOUT': return 'SSH 握手超时，请检查跳板机地址、端口与网络';
    case 'SSH_CONNECTION_FAILED': case 'SSH_FORWARD_FAILED': return 'SSH 连接或端口转发失败，请检查跳板机转发权限与数据库可达性';
    case 'SSH_CAPACITY': return 'SSH 临时连接数已达上限，请等待当前操作结束';
    case 'SSH_CANCELLED': return 'SSH 连接建立已取消';
    case 'DBPILOT_TLS_IDENTITY_REQUIRED':
      return 'MySQL TLS 使用 IP 地址连接时，必须填写证书服务器名（证书中的 DNS 名称）；不会关闭身份验证';
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return '连接数据库超时或网络不可达；请从运行 DBPilot Runtime 的机器检查数据库地址和端口。若使用 Docker 容器内网地址，请改用该机器可访问的映射端口，或将 DBPilot 部署到同一容器网络';
    case 'ECONNREFUSED':
      return '数据库地址可达，但端口拒绝连接；请检查数据库是否启动、监听地址及端口映射';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return '数据库主机名无法解析；请检查地址或 Runtime 所在环境的 DNS 设置';
    case 'ER_ACCESS_DENIED_ERROR':
      return '数据库拒绝登录；请检查用户名、密码，以及该用户允许连接的来源主机';
    case 'ER_BAD_DB_ERROR':
      return '数据库名称不存在，或当前用户无权访问该数据库';
    case 'HANDSHAKE_SSL_ERROR':
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'TLS 握手或证书验证失败；请检查 TLS 设置、证书信任和服务器名称';
    default:
      return '数据库连接失败；请检查地址、端口、数据库、用户名、密码、网络及 TLS 设置';
  }
}
