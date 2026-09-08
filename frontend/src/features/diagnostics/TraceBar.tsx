import { useId, useState } from 'react'
import type { TraceTarget } from '../../entities/xray'
import { Select, TextInput } from '../../shared/ui'

/**
 * Ввод цели трассировки. Живёт в доке над канвасом, поэтому подписи полей
 * компактные и связаны с контролами через htmlFor (у Select значение лежит в
 * содержимом — обёртка <label> приклеила бы его к accessible-имени).
 */
export function TraceBar({
  value,
  onChange,
  showProcess = false,
}: {
  value: TraceTarget | null
  onChange: (target: TraceTarget | null) => void
  /**
   * Показывать поле процесса. Правила по процессу есть только у Mihomo, поэтому
   * включает его `MihomoEditorPage`; в редакторе Xray поле было бы шумом —
   * пользователь заполнял бы то, на что ни одно правило не смотрит.
   */
  showProcess?: boolean
}) {
  const [address, setAddress] = useState(value?.address ?? '')
  const [port, setPort] = useState(String(value?.port ?? 443))
  const [network, setNetwork] = useState<'tcp' | 'udp'>(value?.network ?? 'tcp')
  const [ip, setIp] = useState(value?.ip ?? '')
  const [process, setProcess] = useState(value?.process ?? '')
  const addressId = useId()
  const portId = useId()
  const networkId = useId()
  const ipId = useId()
  const processId = useId()

  function emit(next: {
    address?: string
    port?: string
    network?: 'tcp' | 'udp'
    ip?: string
    process?: string
  }) {
    const addr = (next.address ?? address).trim()
    const portText = (next.port ?? port).trim()
    const ipText = (next.ip ?? ip).trim()
    const processText = (next.process ?? process).trim()
    if (addr === '') return onChange(null)
    onChange({
      address: addr,
      port: /^\d+$/.test(portText) ? Number(portText) : 443,
      network: next.network ?? network,
      ip: ipText === '' ? undefined : ipText,
      // Поле спрятано — значит, правил по процессу в документе нет, и нести
      // старое значение в цель было бы враньём про то, что его учли
      process: !showProcess || processText === '' ? undefined : processText,
    })
  }

  return (
    <div className="trace-bar">
      {/* Заголовка нет намеренно: строку открывает кнопка «Куда пойдёт трафик»,
          и вторая такая же подпись рядом была бы дублем */}
      <label className="trace-bar-label" htmlFor={addressId}>
        Адрес
      </label>
      <TextInput
        id={addressId}
        value={address}
        placeholder="openai.com"
        onChange={(e) => {
          setAddress(e.target.value)
          emit({ address: e.target.value })
        }}
      />
      <label className="trace-bar-label" htmlFor={portId}>
        Порт
      </label>
      <TextInput
        id={portId}
        value={port}
        inputMode="numeric"
        onChange={(e) => {
          setPort(e.target.value)
          emit({ port: e.target.value })
        }}
      />
      <label className="trace-bar-label" htmlFor={networkId}>
        Сеть
      </label>
      <Select
        id={networkId}
        value={network}
        options={[
          { value: 'tcp', label: 'tcp' },
          { value: 'udp', label: 'udp' },
        ]}
        onChange={(v) => {
          const net = v as 'tcp' | 'udp'
          setNetwork(net)
          emit({ network: net })
        }}
      />
      <label className="trace-bar-label" htmlFor={ipId}>
        IP назначения
      </label>
      <TextInput
        id={ipId}
        value={ip}
        placeholder="необязательно"
        onChange={(e) => {
          setIp(e.target.value)
          emit({ ip: e.target.value })
        }}
      />
      {showProcess && (
        <>
          <label className="trace-bar-label" htmlFor={processId}>
            Процесс
          </label>
          <TextInput
            id={processId}
            value={process}
            // Плейсхолдер показывает оба вида значения: по разделителю пути
            // трассировка и отличает путь от имени
            placeholder="chrome.exe или C:\...\chrome.exe"
            onChange={(e) => {
              setProcess(e.target.value)
              emit({ process: e.target.value })
            }}
          />
        </>
      )}
    </div>
  )
}
