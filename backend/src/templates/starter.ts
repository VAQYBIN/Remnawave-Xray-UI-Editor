/**
 * Каркас нового XRAY_JSON-шаблона. Панель создаёт шаблон пустым, а пустой
 * шаблон бесполезен: подписка из него не даст клиенту ни одного сервера.
 * Здесь — минимальный рабочий скелет: локальные входы клиента, одна группа
 * подстановки и статические выходы, перед которыми панель вставит хосты.
 */
export const STARTER_XRAY_TEMPLATE = {
  remnawave: {
    addVirtualHostAsOutbound: false,
    injectHosts: [
      {
        selector: { type: 'sameTagAsRecipient' },
        tagPrefix: 'proxy',
        selectFrom: 'HIDDEN',
      },
    ],
  },
  log: { loglevel: 'warning' },
  inbounds: [
    {
      tag: 'socks',
      port: 10808,
      listen: '127.0.0.1',
      protocol: 'socks',
      settings: { udp: true, auth: 'noauth' },
      sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
    },
    {
      tag: 'http',
      port: 10809,
      listen: '127.0.0.1',
      protocol: 'http',
      settings: { allowTransparent: false },
      sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'block', protocol: 'blackhole' },
  ],
  routing: { rules: [] },
} as const
