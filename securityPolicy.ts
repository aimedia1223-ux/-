// 通常画面から住所・位置情報を外部地図等へ送らないための配信元制限。
export function contentSecurityPolicy(projectUrl: string, development: boolean): string {
  const url = new URL(projectUrl || 'https://not-configured.invalid');
  if (url.protocol !== 'https:' || !/^[a-z0-9.-]+$/i.test(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Supabase URLにはHTTPSのプロジェクトURLだけを指定してください。');
  }
  const connections = ["'self'", url.origin, `wss://${url.host}`];
  if (development) connections.push('ws://127.0.0.1:*', 'ws://localhost:*');
  return [
    "default-src 'self'", `connect-src ${connections.join(' ')}`,
    `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "font-src 'self'", "img-src 'self' data: blob:",
    "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'", "worker-src 'self'",
  ].join('; ');
}
