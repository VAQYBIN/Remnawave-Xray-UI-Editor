/**
 * Каркас нового MIHOMO-шаблона. Маркер подстановки нужен в обеих ролях: на
 * корневом `proxies` панель кладёт сами серверы, в группе — их имена. Без второго
 * подписка отдаст клиенту конфиг без единого выхода.
 */
export const STARTER_MIHOMO_TEMPLATE = `mode: rule
log-level: info
ipv6: false
unified-delay: true

dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 1.1.1.1
    - 8.8.8.8

proxies: # LEAVE THIS LINE!

proxy-groups:
  - name: → Remnawave
    type: select
    proxies: # LEAVE THIS LINE!

rules:
  - MATCH,→ Remnawave
`
