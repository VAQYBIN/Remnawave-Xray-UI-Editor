import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoFieldsForm } from '../src/features/inspector/MihomoFieldsForm'
import { MihomoInspector } from '../src/features/topology/MihomoInspector'
import { fieldsOf, parseMihomo } from '../src/entities/mihomo'
import { buildMihomoGraph } from '../src/entities/graph/mihomo/buildGraph'
import type { MihomoDraft } from '../src/features/editor/useMihomoDraft'
import { optionLabels, selectOption, selectedValue } from './helpers'

const DOC = [
  'x-anchors:',
  '  base: &base',
  '    interval: 300',
  '  rw: &rw',
  '    include-proxies: false',
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    <<: *base',
  '    remnawave: *rw',
  '',
].join('\n')

function draftStub(over: Record<string, unknown> = {}) {
  return {
    setField: vi.fn(),
    removeField: vi.fn(),
    setListAt: vi.fn(),
    renameGroupTo: vi.fn(),
    ...over,
  } as unknown as MihomoDraft
}

function renderForm(over: Record<string, unknown> = {}) {
  const md = parseMihomo(DOC)
  const draft = draftStub(over)
  render(
    <MihomoFieldsForm md={md} parts={['proxy-groups', 0]} fields={fieldsOf('proxy-group')} draft={draft} />,
  )
  return draft
}

/** Строка поля целиком — в ней и подпись, и подсказка происхождения */
function rowOf(label: string): HTMLElement {
  const control = screen.getByLabelText(label)
  const row = control.closest('.field')
  if (row === null) throw new Error(`У поля «${label}» нет строки .field`)
  return row as HTMLElement
}

describe('форма секции Mihomo', () => {
  it('заполненные поля показаны сразу', () => {
    renderForm()
    expect(screen.getByLabelText('type')).toBeInTheDocument()
  })

  it('незаполненные поля спрятаны под раскрывашку', async () => {
    renderForm()
    expect(screen.queryByLabelText('filter')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    expect(screen.getByLabelText('filter')).toBeInTheDocument()
  })

  // Два случая различаются формулировкой намеренно: пользователю надо знать, где
  // именно править — у объявления слитого отображения или у объявления якоря,
  // на который ссылается ключ. Общая проверка /приходит через/ прошла бы и при
  // одинаковом тексте в обеих ветках, то есть не поймала бы их склейку.
  it('значение из слияния доступно только для чтения и называет слияние', () => {
    renderForm()
    const field = screen.getByLabelText('interval')
    expect(field).toHaveAttribute('readonly')
    expect(screen.getByText(/приходит через слияние/)).toBeInTheDocument()
  })

  // Раскрывашку здесь НЕ жмём: origin у такого поля 'alias', а не 'absent',
  // значит по правилу «заполненные сверху» оно показано сразу.
  it('значение из ссылки на якорь доступно только для чтения и называет якорь', () => {
    renderForm()
    const field = screen.getByLabelText('remnawave.include-proxies')
    expect(field).toHaveAttribute('readonly')
    expect(screen.getByText(/приходит через ссылку на якорь/)).toBeInTheDocument()
  })

  it('выбор в enum-поле пишется правкой', async () => {
    const draft = renderForm()
    await selectOption('type', 'fallback')
    expect(draft.setField).toHaveBeenCalledWith(['proxy-groups', 0], 'type', 'fallback')
  })

  it('очистка текстового поля снимает ключ, а не пишет пустую строку', async () => {
    const draft = renderForm()
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    const input = screen.getByLabelText('icon')
    await userEvent.type(input, 'x')
    await userEvent.clear(input)
    expect(draft.removeField).toHaveBeenCalledWith(['proxy-groups', 0], 'icon')
    // Вторая половина названия: форма, зовущая ОБЕ правки, оставила бы проверку
    // выше зелёной, а в документе завела бы `icon: ''` — не то же, что нет ключа
    expect(draft.setField).not.toHaveBeenCalledWith(['proxy-groups', 0], 'icon', '')
  })

  // Незнакомое словарю значение чужого шаблона обязано остаться в списке: без
  // этого первый же заход в форму молча заменил бы его первым вариантом enum'а.
  it('незнакомое значение остаётся в списке вариантов', async () => {
    const md = parseMihomo(['proxy-groups:', '  - name: A', '    type: smart', ''].join('\n'))
    render(
      <MihomoFieldsForm md={md} parts={['proxy-groups', 0]} fields={fieldsOf('proxy-group')} draft={draftStub()} />,
    )
    expect(await optionLabels('type')).toContain('smart')
    expect(selectedValue('type')).toBe('smart')
  })

  // Список читает документ только при монтировании и живёт под стабильным
  // ключом: без синхронизации после undo или восстановления версии он показывал
  // бы прежнее содержимое, пока пользователь не переключит узел.
  it('список подхватывает изменение документа извне', () => {
    const before = parseMihomo(['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'))
    const after = parseMihomo(['proxy-groups:', '  - name: A', '    proxies:', '      - REJECT', ''].join('\n'))
    const props = { parts: ['proxy-groups', 0] as (string | number)[], fields: fieldsOf('proxy-group'), draft: draftStub() }
    const { rerender } = render(<MihomoFieldsForm md={before} {...props} />)
    expect(screen.getByLabelText('proxies')).toHaveValue('DIRECT')
    rerender(<MihomoFieldsForm md={after} {...props} />)
    expect(screen.getByLabelText('proxies')).toHaveValue('REJECT')
  })

  it('переключатель булева поля пишет true', async () => {
    const draft = renderForm()
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    await userEvent.click(screen.getByLabelText('lazy'))
    expect(draft.setField).toHaveBeenCalledWith(['proxy-groups', 0], 'lazy', true)
  })

  it('подсказка поля берётся из словаря', async () => {
    renderForm()
    expect(screen.getByText(/Как группа выбирает участника/)).toBeInTheDocument()
  })

  // Имя группы — единственное поле словаря, которое нельзя писать как ключ:
  // ссылки правил и других групп остались бы висеть на старом имени.
  it('имя группы правится переименованием, а не записью ключа', async () => {
    const draft = renderForm()
    await userEvent.type(screen.getByLabelText('name'), 'B')
    expect(draft.renameGroupTo).toHaveBeenCalledWith(0, 'AB')
    expect(draft.setField).not.toHaveBeenCalled()
  })

  // Правило «пустое значение снимает ключ» к имени группы неприменимо: снятый
  // ключ `name` — это группа без имени, а переименование в пустое имя ядро не
  // примет. Отказ здесь молчаливый по необходимости, но он не портит документ.
  it('очистка имени группы не снимает ключ и не переименовывает', async () => {
    const draft = renderForm()
    await userEvent.clear(screen.getByLabelText('name'))
    expect(draft.renameGroupTo).not.toHaveBeenCalled()
    expect(draft.removeField).not.toHaveBeenCalled()
  })

  // Список правится целиком через setListAt: removeField снёс бы строку ключа
  // вместе с комментарием-маркером подстановки, и подписка перестала бы отдавать
  // серверы — тот самый случай, ради которого запрещена перепечатка документа.
  it('опустевший список пишется пустым, а не снимает ключ', async () => {
    const md = parseMihomo(['proxy-groups:', '  - name: A', '    proxies:', '      - DIRECT', ''].join('\n'))
    const draft = draftStub()
    render(
      <MihomoFieldsForm md={md} parts={['proxy-groups', 0]} fields={fieldsOf('proxy-group')} draft={draft} />,
    )
    await userEvent.clear(screen.getByLabelText('proxies'))
    expect(draft.setListAt).toHaveBeenCalledWith(['proxy-groups', 0], 'proxies', [])
    expect(draft.removeField).not.toHaveBeenCalled()
  })
})

// Ключ свой, а его ЗНАЧЕНИЕ — ссылка на якорь. Правка по диапазону токена `*n`
// стёрла бы авторскую ссылку литералом, ничего об этом не сказав, — тот же класс
// «порча вместо отказа», что и правка слитого значения.
describe('поля, значение которых — ссылка на якорь', () => {
  const ALIASED = [
    'x-anchors:',
    '  n: &n 300',
    '  base: &base',
    '    - DIRECT',
    'proxy-groups:',
    '  - name: A',
    '    type: select',
    '    interval: *n',
    '    proxies: *base',
    '',
  ].join('\n')

  function renderAliased() {
    const md = parseMihomo(ALIASED)
    const draft = draftStub()
    render(
      <MihomoFieldsForm md={md} parts={['proxy-groups', 0]} fields={fieldsOf('proxy-group')} draft={draft} />,
    )
    return draft
  }

  it('скаляр через ссылку заперт и показывает значение из якоря', () => {
    renderAliased()
    const field = screen.getByLabelText('interval')
    expect(field).toHaveAttribute('readonly')
    // Читать значение по-прежнему можно — пользователь должен видеть, что там
    expect(field).toHaveValue('300')
    expect(within(rowOf('interval')).getByText(/приходит через ссылку на якорь/)).toBeInTheDocument()
  })

  it('список через ссылку объяснён якорем, а не отсутствием места для вставки', () => {
    renderAliased()
    const field = screen.getByLabelText('proxies')
    expect(field).toHaveAttribute('readonly')
    expect(within(rowOf('proxies')).getByText(/приходит через ссылку на якорь/)).toBeInTheDocument()
    expect(within(rowOf('proxies')).queryByText(/некуда вписать/)).not.toBeInTheDocument()
  })
})

describe('поля, которые форма писать не умеет', () => {
  // Поле-словарь: текстовый инпут поверх отображения записал бы вместо него
  // скаляр и уничтожил вложенный блок (решение плана 1).
  it('поле-словарь показано только для чтения и отправляет в YAML', () => {
    const md = parseMihomo(['dns:', '  enable: true', '  nameserver-policy:', '    a.com: 1.1.1.1', ''].join('\n'))
    render(<MihomoFieldsForm md={md} parts={['dns']} fields={fieldsOf('dns')} draft={draftStub()} />)
    const field = screen.getByLabelText('nameserver-policy')
    expect(field).toHaveAttribute('readonly')
    expect(within(rowOf('nameserver-policy')).getByText(/вкладке YAML/)).toBeInTheDocument()
  })

  // Вставка отсутствующего поля ищет якорь по последней СВОЕЙ скалярной паре
  // секции. В секции из одних блочных коллекций такой пары нет, и писатель
  // отказывает пустым списком правок. Без объяснения переключатель выглядел бы
  // рабочим и молча ничего не делал.
  it('поле, которому в тексте некуда встать, объясняет отказ вместо молчания', async () => {
    const md = parseMihomo(['dns:', '  nameserver:', '    - 1.1.1.1', ''].join('\n'))
    const draft = draftStub()
    render(<MihomoFieldsForm md={md} parts={['dns']} fields={fieldsOf('dns')} draft={draft} />)
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    const field = screen.getByLabelText('enable')
    expect(field).toHaveAttribute('readonly')
    expect(within(rowOf('enable')).getByText(/вкладке YAML/)).toBeInTheDocument()
    await userEvent.click(field)
    expect(draft.setField).not.toHaveBeenCalled()
  })

  // Тот же отказ у списка: setListAt пишет только СВОЙ блочный список, а
  // отсутствующий ключ создать не берётся.
  it('отсутствующий список показан только для чтения', async () => {
    const md = parseMihomo(['dns:', '  enable: true', ''].join('\n'))
    render(<MihomoFieldsForm md={md} parts={['dns']} fields={fieldsOf('dns')} draft={draftStub()} />)
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    expect(screen.getByLabelText('nameserver')).toHaveAttribute('readonly')
  })
})

const NODES_DOC = [
  'proxy-providers:',
  '  pv:',
  '    type: http',
  '    url: https://example.com/p.yaml',
  'proxy-groups:',
  '  - name: A',
  '    type: select',
  '    filter: "(?i)nl"',
  '    proxies:',
  '      - DIRECT',
  'sub-rules:',
  '  block:',
  '    - MATCH,REJECT',
  'rules:',
  '  - DOMAIN,a.com,A',
  '  - MATCH,DIRECT',
  '',
].join('\n')

function inspector(nodeId: string, over: Record<string, unknown> = {}) {
  const md = parseMihomo(NODES_DOC)
  const draft = draftStub({
    moveSelected: vi.fn(),
    removeSelected: vi.fn(),
    replaceRule: vi.fn(),
    revealAt: vi.fn(),
    setSelectedNode: vi.fn(),
    ...over,
  })
  render(<MihomoInspector draft={draft} md={md} nodeId={nodeId} />)
  return draft
}

describe('инспектор узла Mihomo', () => {
  it('узел группы открывает форму секции и удаляется кнопкой', async () => {
    const draft = inspector('group:A')
    expect(screen.getByLabelText('type')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Удалить группу' }))
    expect(draft.removeSelected).toHaveBeenCalled()
  })

  it('узел провайдера открывает форму провайдера, а не группы', async () => {
    inspector('provider:pv')
    expect(screen.getByLabelText('url')).toHaveValue('https://example.com/p.yaml')
    // `url` есть в обоих словарях — форму различает поле, которого у группы нет
    await userEvent.click(screen.getByRole('button', { name: /Ещё поля/ }))
    expect(screen.getByLabelText('override.dialer-proxy')).toBeInTheDocument()
    expect(screen.queryByLabelText('lazy')).not.toBeInTheDocument()
  })

  it('узел правила двигается кнопками, и первое правило не поднять', async () => {
    const draft = inspector('rule:0')
    expect(screen.getByRole('button', { name: 'Переместить правило выше' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Переместить правило ниже' }))
    expect(draft.moveSelected).toHaveBeenCalledWith(1)
  })

  /** Карточка узла подстановки на своём документе: основание задаётся ключами */
  function hostsCard(doc: string, nodeId = 'hosts:A') {
    render(<MihomoInspector draft={draftStub()} md={parseMihomo(doc)} nodeId={nodeId} />)
  }

  const MARKED = [
    'proxy-groups:',
    '  - name: A',
    '    type: select',
    '    filter: "(?i)nl"',
    '    proxies: # LEAVE THIS LINE!',
    '      - DIRECT',
    '',
  ].join('\n')

  // Условная формулировка обязательна: подставит панель хосты или нет и какие
  // именно — редактор не знает, а утвердительное «сюда попадут» было бы враньём
  it('узел подстановки говорит о хостах условно и не обещает кабель', () => {
    hostsCard(MARKED)
    expect(screen.getByText(/Если панель подставит хосты/)).toBeInTheDocument()
    expect(screen.getByText(/filter: \(\?i\)nl/)).toBeInTheDocument()
  })

  /**
   * Панель дописывает хосты по ключам, а не по маркеру: без
   * `remnawave.include-proxies: false` группа попадает в первую ветку текста
   * («панель допишет...») даже с `include-all`. Вторая ветка («include-all:
   * панель ничего не дописывает...») достижима только ПОСЛЕ явного отказа
   * `include-proxies: false` — иначе группа получила бы хосты от панели, и
   * говорить про сборку ядром было бы неверно.
   */
  it('основание подстановки называется по документу: include-all после include-proxies: false', () => {
    hostsCard(
      'proxy-groups:\n  - name: A\n    type: select\n    remnawave:\n      include-proxies: false\n    include-all: true\n',
    )
    expect(screen.getByText(/include-all/)).toBeInTheDocument()
    expect(screen.queryByText(/Панель допишет/)).not.toBeInTheDocument()
  })

  it('без include-proxies: false говорит, что панель допишет хосты сама — include-all в тексте не упоминается', () => {
    hostsCard('proxy-groups:\n  - name: A\n    type: select\n    include-all: true\n')
    expect(screen.getByText(/Панель допишет имена подставленных хостов/)).toBeInTheDocument()
    expect(screen.queryByText(/include-all/)).not.toBeInTheDocument()
  })

  /**
   * Группу могут назвать `root`, и тогда id её узла подстановки совпадает с id
   * корневого — на холсте побеждает узел ГРУППЫ (см. buildMihomoGraph). Карточка
   * обязана различать эти два случая: иначе она говорит «в КОРНЕВОМ списке
   * proxies» и тут же печатает фильтр группы.
   */
  it('группа с именем root описана как группа, а не как корневой список', () => {
    hostsCard(
      [
        'proxies: # LEAVE THIS LINE!',
        'proxy-groups:',
        '  - name: root',
        '    type: select',
        '    filter: "(?i)nl"',
        '    proxies: # LEAVE THIS LINE!',
        '      - DIRECT',
        '',
      ].join('\n'),
      'hosts:root',
    )
    expect(screen.getByText(/списка proxies группы «root»/)).toBeInTheDocument()
    expect(screen.queryByText(/корневого списка proxies/)).not.toBeInTheDocument()
    expect(screen.getByText(/filter: \(\?i\)nl/)).toBeInTheDocument()
  })

  // Корневой список рисуется ВСЕГДА (маркер декоративен), а без одноимённой
  // группы карточка по-прежнему говорит про корневой список, и фильтру взяться
  // неоткуда
  it('корневая подстановка описана как корневой список даже без маркера в тексте', () => {
    hostsCard('mode: rule\n', 'hosts:root')
    expect(screen.getByText(/конец корневого списка proxies/)).toBeInTheDocument()
    expect(screen.queryByText(/filter:/)).not.toBeInTheDocument()
  })

  // Кнопка обязана вести К МЕСТУ подсписка, а не просто переключать вкладку:
  // переход и прокрутка собираются только вместе (revealAt), порознь прокрутка
  // уходит в ветку графа по устаревшему состоянию вкладки.
  it('подсписок показан только для чтения и ведёт к своему месту в YAML', async () => {
    const draft = inspector('subrule:block')
    expect(screen.getByText('- MATCH,REJECT')).toBeInTheDocument()
    expect(screen.queryByLabelText('Тип')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в YAML' }))
    expect(draft.revealAt).toHaveBeenCalledWith(['sub-rules', 'block'])
  })

  // Узел берём из настоящего графа, а не из строки-фикстуры: id подсписка задаёт
  // buildMihomoGraph, и разойтись эти две схемы обязаны заметно. Узел ищем по
  // `data.kind` — у графа Mihomo `type` узла (`mihomoSubRule`) с ним НЕ совпадает,
  // и сравнение по `type` прошло бы мимо.
  it('узел подсписка из живого графа открывается инспектором', () => {
    const md = parseMihomo(NODES_DOC)
    const node = buildMihomoGraph(md).nodes.find(
      (n) => (n.data as { kind?: string }).kind === 'mihomo-subrule',
    )
    expect(node).toBeDefined()
    render(<MihomoInspector draft={draftStub({ revealAt: vi.fn() })} md={md} nodeId={node!.id} />)
    expect(screen.getByText('- MATCH,REJECT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть в YAML' })).toBeInTheDocument()
  })

  // Источник один: кнопки «Выше»/«Ниже»/«Удалить» действуют на ВЫБРАННЫЙ узел,
  // поэтому и показывать инспектор обязан его же. Разойдись эти два источника —
  // кнопка удалила бы не то, что на экране, и увидеть это было бы неоткуда.
  it('показывает выбранный узел, а не то, что просят пропом', async () => {
    const draft = inspector('group:A', { selectedNode: 'rule:0' })
    expect(screen.getByText('rule:0')).toBeInTheDocument()
    expect(screen.queryByText('group:A')).not.toBeInTheDocument()
    // И действие тоже про правило: у группы кнопок перестановки нет вовсе
    await userEvent.click(screen.getByRole('button', { name: 'Переместить правило ниже' }))
    expect(draft.moveSelected).toHaveBeenCalledWith(1)
  })

  it('способ подстановки хостов описан условно', () => {
    const md = parseMihomo(
      ['proxy-groups:', '  - name: A', '    remnawave:', '      select-random-proxy: true', ''].join('\n'),
    )
    render(<MihomoInspector draft={draftStub()} md={md} nodeId="hosts:A" />)
    expect(screen.getByText(/Если хосты будут подставлены, сюда попадёт один случайный/)).toBeInTheDocument()
  })

  it('встроенная цель объясняется карточкой', () => {
    inspector('builtin:REJECT-DROP')
    expect(screen.getByText(/отбрасываются молча/)).toBeInTheDocument()
  })
})
