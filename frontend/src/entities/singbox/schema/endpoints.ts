// Конечные точки: WireGuard и Tailscale — «протокол с входом и выходом»
// (ядро 1.11 и новее). На холсте они рисуются тем же узлом out:<tag>, что и
// выходы, но поля у них свои — отсюда отдельная ветвь.

import type { EnumValue, FieldSchema } from '../../../shared/schema'
import { DIAL_FIELDS, bool, num, nums, objs, str, strs, when } from './shared'

export const ENDPOINT_TYPE_VALUES: EnumValue[] = [
  { value: 'wireguard', doc: 'Интерфейс WireGuard (ядро 1.11 и новее).' },
  { value: 'tailscale', doc: 'Узел Tailscale (ядро 1.12 и новее).' },
]

const wg = when('type', 'wireguard')
const ts = when('type', 'tailscale')

export const ENDPOINT_FIELDS: FieldSchema[] = [
  { key: 'type', doc: 'Вид конечной точки.', kind: 'enum', enum: ENDPOINT_TYPE_VALUES },
  str('tag', 'Имя конечной точки: по нему на неё ссылаются правила и группы.'),

  // ── wireguard ──
  bool('system', 'Использовать системный интерфейс; требует прав.', { when: wg }),
  str('name', 'Имя системного интерфейса.', { when: wg }),
  num('mtu', 'MTU интерфейса, по умолчанию 1408.', { when: wg }),
  strs('address', 'Адреса интерфейса с префиксом, IPv4 и IPv6.', { when: wg }),
  str('private_key', 'Приватный ключ в base64.', { when: wg }),
  num('listen_port', 'Локальный порт.', { when: wg }),
  objs('peers', 'Пиры WireGuard.', [
    str('address', 'Адрес пира.'),
    num('port', 'Порт пира.'),
    str('public_key', 'Публичный ключ пира.'),
    str('pre_shared_key', 'Общий ключ пира.'),
    strs('allowed_ips', 'Разрешённые подсети, например 0.0.0.0/0.'),
    num('persistent_keepalive_interval', 'Период keep-alive, секунд; 0 — выключено.'),
    nums('reserved', 'Три зарезервированных байта.'),
  ], {
    label: (v, i) => {
      const address = (v as { address?: unknown } | null)?.address
      return typeof address === 'string' && address !== '' ? address : `пир #${i + 1}`
    },
    starter: () => ({ address: '', port: 51820, public_key: '', allowed_ips: ['0.0.0.0/0', '::/0'] }),
  }, { when: wg }),
  num('workers', 'Число рабочих потоков; пусто — по числу ядер.', { when: wg }),
  bool('on_demand', 'Разрешить отключение, когда точка не нужна.', { when: wg, since: '1.15.0' }),

  // ── tailscale ──
  str('state_directory', 'Каталог состояния, по умолчанию tailscale.', { when: ts }),
  str('auth_key', 'Ключ входа; без него ядро печатает ссылку для входа.', { when: ts }),
  str('control_url', 'Сервер координации, по умолчанию controlplane.tailscale.com.', { when: ts }),
  bool('ephemeral', 'Регистрировать узел как временный.', { when: ts }),
  str('hostname', 'Имя узла; пусто — системное.', { when: ts, since: '1.14.0' }),
  bool('accept_routes', 'Принимать анонсированные маршруты.', { when: ts }),
  str('exit_node', 'Выходной узел: имя или адрес.', { when: ts }),
  bool('exit_node_allow_lan_access', 'Пускать локальную сеть через выходной узел.', { when: ts }),
  strs('advertise_routes', 'Анонсируемые подсети.', { when: ts }),
  bool('advertise_exit_node', 'Анонсировать себя выходным узлом.', { when: ts }),
  strs('advertise_tags', 'Теги ACL.', { when: ts, since: '1.13.0' }),
  num('listen_port', 'Порт WireGuard.', { when: ts, since: '1.14.0' }),
  num('relay_server_port', 'Порт релея.', { when: ts, since: '1.13.0' }),
  strs('relay_server_static_endpoints', 'Статические адреса релея.', { when: ts, since: '1.13.0' }),
  bool('system_interface', 'Создавать системный TUN.', { when: ts, since: '1.13.0' }),
  str('system_interface_name', 'Имя системного TUN.', { when: ts, since: '1.13.0' }),
  num('system_interface_mtu', 'MTU системного TUN.', { when: ts, since: '1.13.0' }),
  str('udp_timeout', 'Время жизни NAT-записи UDP, по умолчанию 5m.', { when: ts }),
  bool('ssh_server', 'Встроенный SSH-сервер.', { when: ts, since: '1.14.0' }),
  str('taildrop_directory', 'Каталог для файлов Taildrop.', { when: ts, since: '1.14.0' }),

  // ── dial-поля у обоих ──
  ...DIAL_FIELDS,
]
