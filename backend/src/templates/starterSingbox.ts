/**
 * Каркас нового SINGBOX-шаблона. Панель создаёт шаблон пустым, а пустой
 * шаблон бесполезен: подписка из него не даст клиенту ни одного сервера.
 *
 * Список `outbounds` у селектора оставлен пустым намеренно: панель перезапишет
 * его целиком тегами подставленных серверов. Писать сюда что-то осмысленное
 * значило бы изображать данные, которых в отданном клиенту конфиге не будет.
 *
 * `final` задан явно, хотя ядро и без него взяло бы первый выход: неявный
 * дефолт зависит от позиции элемента в массиве и меняется при любой
 * перестановке — в каркасе такой ловушке не место.
 */
export const STARTER_SINGBOX_TEMPLATE = {
  log: { level: 'warn', timestamp: true },
  dns: {
    servers: [
      { tag: 'dns-remote', type: 'tls', server: '1.1.1.1', detour: '→ Remnawave' },
      { tag: 'dns-local', type: 'local' },
    ],
    final: 'dns-local',
  },
  inbounds: [
    {
      type: 'tun',
      tag: 'tun-in',
      address: ['172.19.0.1/30'],
      auto_route: true,
      strict_route: true,
      stack: 'mixed',
    },
    { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2412 },
  ],
  outbounds: [
    { type: 'selector', tag: '→ Remnawave', outbounds: [], interrupt_exist_connections: true },
    { type: 'direct', tag: 'direct' },
  ],
  route: {
    rules: [
      { action: 'sniff' },
      { protocol: 'dns', action: 'hijack-dns' },
      { ip_is_private: true, outbound: 'direct' },
    ],
    final: '→ Remnawave',
    auto_detect_interface: true,
    default_domain_resolver: { server: 'dns-local' },
  },
  experimental: { cache_file: { enabled: true } },
}
