import { useMemo, useState } from 'react'
import {
  DEFAULT_PARAMS,
  RECIPES,
  planFor,
  validateFor,
  type AllParams,
  type RecipeId,
  type XrayConfig,
} from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'
import { DiffView } from '../editor/DiffView'
import { BlockForm } from './forms/BlockForm'
import { ChainForm } from './forms/ChainForm'
import { TorrentForm } from './forms/TorrentForm'
import { WarpForm } from './forms/WarpForm'

interface Props {
  open: boolean
  config: XrayConfig
  onApply: (config: XrayConfig) => void
  onOpenGeo: () => void
  onClose: () => void
}

export function RecipesDialog({ open, config, onApply, onOpenGeo, onClose }: Props) {
  const [id, setId] = useState<RecipeId>('warp')
  // Параметры всех рецептов держим сразу: переключение списка не теряет введённое
  const [params, setParams] = useState<AllParams>(DEFAULT_PARAMS)
  const [diff, setDiff] = useState(false)

  // Закрытый диалог не считает план и не рисует формы: иначе их поля и кнопки
  // остаются в дереве доступности и перехватывают поиск по подписям на всей странице
  const plan = useMemo(
    () => (open ? planFor(config, id, params) : { config, changes: [], notes: [] }),
    [open, config, id, params],
  )
  const error = validateFor(id, params)
  const canApply = error === null && plan.changes.some((c) => c.status === 'add')

  const inboundTags = (config.inbounds ?? [])
    .map((i) => i.tag)
    .filter((t): t is string => typeof t === 'string')
  const outboundTags = (config.outbounds ?? [])
    .map((o) => o.tag)
    .filter((t): t is string => typeof t === 'string')

  function apply() {
    onApply(plan.config)
    setDiff(false)
    onClose()
  }

  return (
    <Dialog open={open} title="Рецепты" onClose={onClose} wide>
      {!open ? null : diff ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Слева — текущий черновик, справа — каким он станет после рецепта.
          </p>
          <DiffView
            original={JSON.stringify(config, null, 2)}
            modified={JSON.stringify(plan.config, null, 2)}
            maxHeight="55vh"
          />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setDiff(false)}>
              ← К параметрам
            </Button>
            <span className="spacer" />
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="recipes-layout">
            <div className="recipe-list">
              {RECIPES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={r.id === id ? 'recipe-item recipe-item-active' : 'recipe-item'}
                  aria-pressed={r.id === id}
                  onClick={() => setId(r.id)}
                >
                  <span className="recipe-item-title">{r.title}</span>
                  <span className="recipe-item-summary">{r.summary}</span>
                </button>
              ))}
            </div>

            <div className="recipe-body">
              {id === 'warp' && (
                <WarpForm value={params.warp} onChange={(warp) => setParams({ ...params, warp })} />
              )}
              {id === 'torrent' && (
                <TorrentForm
                  value={params.torrent}
                  inboundTags={inboundTags}
                  onChange={(torrent) => setParams({ ...params, torrent })}
                />
              )}
              {id === 'ads' && (
                <BlockForm value={params.ads} onChange={(ads) => setParams({ ...params, ads })} />
              )}
              {id === 'private' && (
                <BlockForm value={params.private} onChange={(v) => setParams({ ...params, private: v })} />
              )}
              {id === 'chain' && (
                <ChainForm
                  value={params.chain}
                  outboundTags={outboundTags}
                  onChange={(chain) => setParams({ ...params, chain })}
                />
              )}

              <h3 className="recipe-preview-title">Будет добавлено</h3>
              <ul className="recipe-changes" aria-label="Изменения рецепта">
                {plan.changes.map((c, i) => (
                  <li
                    key={`${c.text}:${i}`}
                    className={c.status === 'add' ? 'recipe-add' : 'recipe-exists'}
                  >
                    <span aria-hidden="true">{c.status === 'add' ? '+' : '✓'}</span> {c.text}
                  </li>
                ))}
              </ul>

              {plan.notes.map((n) => (
                <p key={n.text} className="recipe-note">
                  {n.text}
                  {n.needsGeo === true && (
                    <Button variant="ghost" onClick={onOpenGeo}>
                      Geo-базы
                    </Button>
                  )}
                </p>
              ))}

              {error !== null && <span className="field-error">{error}</span>}
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <span className="spacer" />
            <Button onClick={() => setDiff(true)}>Показать diff</Button>
            <Button variant="primary" disabled={!canApply} onClick={apply}>
              Применить
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
