import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { getSupabaseClient } from '../lib/supabaseClient'
import type { Database } from '../lib/database.types'
import { isMonthlyProductivityIndicator } from '../lib/indicatorMetrics'
import { CaiRegistroForm } from './CaiRegistroForm'

type Grupo = Pick<Database['public']['Tables']['cai_grupos']['Row'], 'id' | 'nombre' | 'orden'>
type Indicador = Pick<
  Database['public']['Tables']['cai_indicadores']['Row'],
  'id' | 'grupo_id' | 'numero_indicador' | 'descripcion'
>
type Establecimiento = Pick<Database['public']['Tables']['cai_establecimientos']['Row'], 'id' | 'nombre'>
type Configuracion = Pick<
  Database['public']['Tables']['cai_config_establecimiento']['Row'],
  'establecimiento_id' | 'compromiso_gestion' | 'poblacion_programada'
>
type Registro = Pick<
  Database['public']['Tables']['cai_registros_mensuales']['Row'],
  'establecimiento_id' | 'mes' | 'valor_numerador' | 'valor_denominador'
>

type CaiMatrizRevisionProps = {
  gestion: number
}

type CeldaSeleccionada = {
  establecimiento: Establecimiento
  mes: number
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const selectClassName =
  'mt-2 block w-full rounded-xl border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm focus:border-cai-600 focus:ring-cai-600 disabled:cursor-not-allowed disabled:bg-slate-100'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string') return message
  }
  return 'Ocurrió un error inesperado.'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value)
}

function formatPercentage(value: number): string {
  const percentage = value <= 1 ? value * 100 : value
  return `${formatNumber(percentage)}%`
}

function recordKey(establishmentId: string, month: number): string {
  return `${establishmentId}:${month}`
}

function compareIndicators(left: Indicador, right: Indicador): number {
  return (
    Number(left.numero_indicador) - Number(right.numero_indicador) ||
    left.descripcion.localeCompare(right.descripcion, 'es')
  )
}

export function CaiMatrizRevision({ gestion }: CaiMatrizRevisionProps) {
  const [groups, setGroups] = useState<Grupo[]>([])
  const [indicators, setIndicators] = useState<Indicador[]>([])
  const [establishments, setEstablishments] = useState<Establecimiento[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedIndicatorId, setSelectedIndicatorId] = useState('')
  const [configurations, setConfigurations] = useState<Configuracion[]>([])
  const [records, setRecords] = useState<Registro[]>([])
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true)
  const [isLoadingMatrix, setIsLoadingMatrix] = useState(false)
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [selectedCell, setSelectedCell] = useState<CeldaSeleccionada | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    if (!selectedCell) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedCell(null)
        setRefreshVersion((version) => version + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedCell])

  useEffect(() => {
    let active = true

    async function loadCatalog() {
      setIsLoadingCatalog(true)
      setCatalogError('')
      try {
        const supabase = getSupabaseClient()
        const [groupsResult, indicatorsResult, establishmentsResult] = await Promise.all([
          supabase.from('cai_grupos').select('id, nombre, orden').order('orden'),
          supabase.from('cai_indicadores').select('id, grupo_id, numero_indicador, descripcion'),
          supabase.from('cai_establecimientos').select('id, nombre').order('nombre'),
        ])
        if (groupsResult.error) throw groupsResult.error
        if (indicatorsResult.error) throw indicatorsResult.error
        if (establishmentsResult.error) throw establishmentsResult.error
        if (!active) return

        const loadedGroups = groupsResult.data ?? []
        const loadedIndicators = indicatorsResult.data ?? []
        const initialGroupId = loadedGroups[0]?.id ?? ''
        const firstGroupIndicator = loadedIndicators
          .filter((indicator) => indicator.grupo_id === initialGroupId)
          .sort(compareIndicators)[0]
        setGroups(loadedGroups)
        setIndicators(loadedIndicators)
        setEstablishments(establishmentsResult.data ?? [])
        setSelectedGroupId(initialGroupId)
        setSelectedIndicatorId(firstGroupIndicator?.id ?? '')
      } catch (loadError) {
        if (active) setCatalogError(`No se pudo cargar el catálogo de indicadores: ${errorMessage(loadError)}`)
      } finally {
        if (active) setIsLoadingCatalog(false)
      }
    }

    void loadCatalog()
    return () => {
      active = false
    }
  }, [])

  const groupIndicators = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.grupo_id === selectedGroupId)
        .sort(compareIndicators),
    [indicators, selectedGroupId],
  )
  const selectedIndicator = groupIndicators.find((indicator) => indicator.id === selectedIndicatorId)
  const isProductivityIndicator = isMonthlyProductivityIndicator(
    selectedIndicator,
    groups.map(({ id, nombre }) => ({ id, nombre })),
  )

  useEffect(() => {
    let active = true

    async function loadMatrixData() {
      if (!selectedIndicatorId) {
        setConfigurations([])
        setRecords([])
        setError('')
        setIsLoadingMatrix(false)
        return
      }

      setIsLoadingMatrix(true)
      setError('')
      setConfigurations([])
      setRecords([])
      try {
        const supabase = getSupabaseClient()
        const [configurationResult, recordsResult] = await Promise.all([
          supabase
            .from('cai_config_establecimiento')
            .select('establecimiento_id, compromiso_gestion, poblacion_programada')
            .eq('indicador_id', selectedIndicatorId)
            .eq('gestion', gestion),
          supabase
            .from('cai_registros_mensuales')
            .select('establecimiento_id, mes, valor_numerador, valor_denominador')
            .eq('indicador_id', selectedIndicatorId)
            .eq('gestion', gestion)
            .order('mes'),
        ])
        if (configurationResult.error) throw configurationResult.error
        if (recordsResult.error) throw recordsResult.error
        if (active) {
          setConfigurations(configurationResult.data ?? [])
          setRecords(recordsResult.data ?? [])
        }
      } catch (loadError) {
        if (active) setError(`No se pudo cargar la matriz mensual: ${errorMessage(loadError)}`)
      } finally {
        if (active) setIsLoadingMatrix(false)
      }
    }

    void loadMatrixData()
    return () => {
      active = false
    }
  }, [gestion, refreshVersion, selectedIndicatorId])

  const configurationsByEstablishment = useMemo(
    () => new Map(configurations.map((configuration) => [configuration.establecimiento_id, configuration])),
    [configurations],
  )
  const recordsByMonth = useMemo(
    () => new Map(records.map((record) => [recordKey(record.establecimiento_id, record.mes), record])),
    [records],
  )

  function handleGroupChange(groupId: string) {
    setSelectedGroupId(groupId)
    const firstGroupIndicator = indicators
      .filter((indicator) => indicator.grupo_id === groupId)
      .sort(compareIndicators)[0]
    setSelectedIndicatorId(firstGroupIndicator?.id ?? '')
  }

  function closeRegistrationModal() {
    setSelectedCell(null)
    setRefreshVersion((version) => version + 1)
  }

  function displayRecord(record: Registro): string {
    const numerator = formatNumber(record.valor_numerador)
    if (!isProductivityIndicator || record.valor_denominador === null) return numerator
    return `${numerator} / ${formatNumber(record.valor_denominador)}`
  }

  function displayAccumulated(establishmentId: string): string {
    const establishmentRecords = records.filter((record) => record.establecimiento_id === establishmentId)
    if (establishmentRecords.length === 0) return '—'

    const numerator = establishmentRecords.reduce((sum, record) => sum + record.valor_numerador, 0)
    if (!isProductivityIndicator) return formatNumber(numerator)

    const denominator = establishmentRecords.reduce(
      (sum, record) => sum + (record.valor_denominador ?? 0),
      0,
    )
    return `${formatNumber(numerator)} / ${formatNumber(denominator)}`
  }

  return (
    <div className="mx-auto max-w-[1800px]">
      <header className="mb-6 rounded-2xl bg-[#0d4859] px-5 py-5 text-white shadow-lg sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
          Revisión global de datos
        </p>
        <h1 className="mt-1 text-2xl font-bold">Matriz mensual por establecimiento</h1>
        <p className="mt-2 text-sm text-teal-50">
          Registros, población programada y metas institucionales · Gestión {gestion}
        </p>
      </header>

      {catalogError && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {catalogError}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <section className="mb-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">
          Grupo de indicadores
          <select
            value={selectedGroupId}
            onChange={(event) => handleGroupChange(event.target.value)}
            disabled={isLoadingCatalog || groups.length === 0}
            className={selectClassName}
          >
            {groups.length === 0 && <option value="">Sin grupos disponibles</option>}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.nombre}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Indicador
          <select
            value={selectedIndicatorId}
            onChange={(event) => setSelectedIndicatorId(event.target.value)}
            disabled={isLoadingCatalog || groupIndicators.length === 0}
            className={selectClassName}
          >
            {groupIndicators.length === 0 && <option value="">Sin indicadores disponibles</option>}
            {groupIndicators.map((indicator) => (
              <option key={indicator.id} value={indicator.id}>
                Indicador {indicator.numero_indicador} · {indicator.descripcion}
              </option>
            ))}
          </select>
        </label>
      </section>

      {selectedIndicator && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          <span className="font-semibold">Indicador {selectedIndicator.numero_indicador}:</span>{' '}
          {selectedIndicator.descripcion}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {isLoadingMatrix || isLoadingCatalog ? (
          <p role="status" className="px-6 py-10 text-center text-sm text-slate-500">
            Cargando datos de la matriz…
          </p>
        ) : !selectedIndicator ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            Seleccione un grupo con indicadores para consultar la matriz.
          </p>
        ) : establishments.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No hay establecimientos disponibles.
          </p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-[1550px] w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-30 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="sticky left-0 z-40 w-64 min-w-64 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 font-semibold">
                    Establecimiento
                  </th>
                  <th scope="col" className="sticky left-64 z-40 w-28 min-w-[7rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-3 font-semibold">
                    Población
                  </th>
                  <th scope="col" className="sticky left-[23rem] z-40 w-24 min-w-[6rem] border-b border-r border-slate-200 bg-slate-100 px-3 py-3 font-semibold">
                    Meta
                  </th>
                  {MESES.map((month) => (
                    <th key={month} scope="col" className="min-w-[6rem] border-b border-r border-slate-200 px-3 py-3 text-center font-semibold">
                      {month}
                    </th>
                  ))}
                  <th scope="col" className="min-w-[7rem] border-b border-slate-200 bg-slate-200 px-3 py-3 text-center font-bold text-slate-800">
                    Acumulado
                  </th>
                </tr>
              </thead>
              <tbody>
                {establishments.map((establishment) => {
                  const configuration = configurationsByEstablishment.get(establishment.id)
                  return (
                    <tr key={establishment.id} className="group">
                      <th
                        scope="row"
                        className="sticky left-0 z-20 w-64 min-w-64 border-b border-r border-slate-200 bg-white px-4 py-3 text-left font-semibold text-slate-800 group-hover:bg-slate-50"
                      >
                        {establishment.nombre}
                      </th>
                      <td className="sticky left-64 z-20 w-28 min-w-[7rem] border-b border-r border-slate-200 bg-white px-3 py-3 text-right tabular-nums text-slate-700 group-hover:bg-slate-50">
                        {configuration ? formatNumber(configuration.poblacion_programada) : '—'}
                      </td>
                      <td className="sticky left-[23rem] z-20 w-24 min-w-[6rem] border-b border-r border-slate-200 bg-white px-3 py-3 text-right tabular-nums text-slate-700 group-hover:bg-slate-50">
                        {configuration ? formatPercentage(configuration.compromiso_gestion) : '—'}
                      </td>
                      {MESES.map((month, index) => {
                        const record = recordsByMonth.get(recordKey(establishment.id, index + 1))
                        return (
                          <td
                            key={month}
                            className={`min-w-[6rem] border-b border-r border-slate-200 p-0 text-center tabular-nums ${
                              record ? 'bg-emerald-50 font-medium text-emerald-900' : 'text-slate-400'
                            }`}
                          >
                            <button
                              type="button"
                              aria-label={`Editar ${month} de ${establishment.nombre}`}
                              title={`Editar ${month} · ${establishment.nombre}`}
                              onClick={() => setSelectedCell({ establecimiento: establishment, mes: index + 1 })}
                              className={`block min-h-11 w-full px-3 py-3 transition hover:bg-cai-100 focus:z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cai-600 ${
                                record ? 'text-emerald-900' : 'text-slate-400'
                              }`}
                            >
                              {record ? displayRecord(record) : '—'}
                            </button>
                          </td>
                        )
                      })}
                      <td className="min-w-[7rem] border-b border-slate-200 bg-slate-50 px-3 py-3 text-center font-semibold tabular-nums text-slate-800">
                        {displayAccumulated(establishment.id)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mt-3 text-xs text-slate-500">
        Las celdas verde claro indican que el mes ya tiene un registro cargado.
      </p>

      {selectedCell && selectedIndicator && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRegistrationModal()
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="matrix-registration-title"
            className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 bg-[#0d4859] px-5 py-4 text-white sm:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
                  Edición de registro mensual
                </p>
                <h2 id="matrix-registration-title" className="mt-1 text-lg font-bold sm:text-xl">
                  {selectedCell.establecimiento.nombre}
                </h2>
                <p className="mt-1 text-sm text-teal-50">
                  {MESES[selectedCell.mes - 1]} · Gestión {gestion}
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar formulario de registro"
                onClick={closeRegistrationModal}
                className="shrink-0 rounded-lg p-2 text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="overflow-y-auto p-4 sm:p-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                <CaiRegistroForm
                  key={`${selectedCell.establecimiento.id}-${selectedIndicator.id}-${selectedCell.mes}-${gestion}`}
                  establecimientoId={selectedCell.establecimiento.id}
                  grupoId={selectedGroupId}
                  grupos={groups}
                  onGrupoChange={handleGroupChange}
                  gestion={gestion}
                  initialIndicadorId={selectedIndicator.id}
                  initialMes={selectedCell.mes}
                  onSaved={() => setRefreshVersion((version) => version + 1)}
                />
              </section>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
