'use client'

// Homeowner-lead CSV import wizard:
// 1. Drop a CSV  →  2. Review auto-mapped columns  →  3. Import + report
// Handles any CSV export — unmapped columns are kept in `extra`.

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Papa from 'papaparse'
import { UploadCloud, FileSpreadsheet, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle, Users, RefreshCw } from 'lucide-react'
import { TARGET_FIELDS, autoMapColumns, mapRow, aggregateRows, type AggregatedContact } from '@/lib/csv-map'
import { Card, Button, PageHeader, Select, Segmented, Spinner } from '@/components/ui/kit'
import { cn } from '@/lib/utils'

const LEAD_TYPE = 'owner' as const

type Step = 'upload' | 'map' | 'importing' | 'done'

const CHUNK_SIZE = 400

interface Report {
  imported: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

export default function ImportWizard() {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [dedupe, setDedupe] = useState<'update' | 'skip'>('update')
  const [relationship, setRelationship] = useState<'prospect' | 'client'>('client')
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Parse ───────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    setError(null)
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setError('Please upload a .csv file (export it from Streamline reports).')
      return
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: h => h.trim(),
      complete: results => {
        const hdrs = (results.meta.fields ?? []).filter(Boolean)
        if (hdrs.length === 0 || results.data.length === 0) {
          setError('Could not read any rows from that file.')
          return
        }
        setFileName(file.name)
        setHeaders(hdrs)
        setRows(results.data)
        setMapping(autoMapColumns(hdrs))
        setStep('map')
      },
      error: () => setError('Failed to parse the CSV file.'),
    })
  }, [])

  // ── Aggregate preview ───────────────────────────────────────
  const contacts: AggregatedContact[] = useMemo(() => {
    if (rows.length === 0) return []
    return aggregateRows(rows.map(r => mapRow(r, mapping)))
  }, [rows, mapping])

  const mappedCount = Object.values(mapping).filter(Boolean).length

  // ── Import ──────────────────────────────────────────────────
  async function runImport() {
    setStep('importing')
    setProgress(0)
    setError(null)
    try {
      const startRes = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', filename: fileName, lead_type: LEAD_TYPE, relationship, mapping, row_count: rows.length }),
      })
      const { import_id, error: startErr } = await startRes.json()
      if (startErr || !import_id) throw new Error(startErr ?? 'Failed to start import')

      const totals: Report = { imported: 0, updated: 0, skipped: 0, errors: [] }
      for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
        const chunk = contacts.slice(i, i + CHUNK_SIZE)
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rows', import_id, lead_type: LEAD_TYPE, relationship, dedupe, contacts: chunk }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        totals.imported += data.imported
        totals.updated += data.updated
        totals.skipped += data.skipped
        totals.errors.push(...(data.errors ?? []))
        setProgress(Math.min(100, Math.round(((i + chunk.length) / contacts.length) * 100)))
      }

      setReport(totals)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('map')
    }
  }

  function reset() {
    setStep('upload'); setFileName(''); setHeaders([]); setRows([]); setMapping({}); setReport(null); setError(null)
  }

  return (
    <div>
      <PageHeader title="Import Leads" subtitle="Upload a CSV of homeowner leads — column names don't need to match" />

      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-6">
        {(['upload', 'map', 'done'] as const).map((s, i) => {
          const labels = ['Upload', 'Map columns', 'Import']
          const stepIndex = step === 'upload' ? 0 : step === 'map' ? 1 : 2
          const active = i === stepIndex
          const done = i < stepIndex
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-[12.5px] font-semibold',
                active ? 'bg-accent text-white' : done ? 'bg-good-soft text-good' : 'bg-[#f2f4f7] text-ink-3'
              )}>
                <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                  {done ? '✓' : i + 1}
                </span>
                {labels[i]}
              </div>
              {i < 2 && <span className="text-ink-3">—</span>}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-bad-soft text-bad rounded-xl px-4 py-3 mb-4 text-[13.5px] font-medium">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* STEP 1: Upload */}
      {step === 'upload' && (
        <Card className="p-0 overflow-hidden">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) handleFile(file)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'm-6 border-2 border-dashed rounded-card py-16 flex flex-col items-center justify-center cursor-pointer transition-colors',
              dragOver ? 'border-accent bg-accent-soft/40' : 'border-line-strong hover:border-accent/50 hover:bg-[#fafbfe]'
            )}
          >
            <div className="w-14 h-14 rounded-2xl bg-accent-soft text-accent flex items-center justify-center mb-4">
              <UploadCloud size={26} />
            </div>
            <p className="text-[15.5px] font-semibold text-ink m-0">Drop your CSV here, or click to browse</p>
            <p className="text-[13px] text-ink-2 mt-1.5 m-0 text-center max-w-md">
              Any CSV with names, emails, or phone numbers works.
              Column names don&apos;t need to match — you&apos;ll review the mapping next.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>
        </Card>
      )}

      {/* STEP 2: Map */}
      {step === 'map' && (
        <div className="flex flex-col gap-4">
          <Card className="px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-good-soft text-good flex items-center justify-center">
                  <FileSpreadsheet size={19} />
                </div>
                <div>
                  <p className="text-[14.5px] font-semibold text-ink m-0">{fileName}</p>
                  <p className="text-[12.5px] text-ink-2 m-0">
                    {rows.length.toLocaleString()} rows → <strong>{contacts.length.toLocaleString()} unique people</strong> · {mappedCount} columns mapped
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <p className="text-[11.5px] font-semibold text-ink-3 uppercase tracking-wide m-0 mb-1">Import as</p>
                  <Segmented<'prospect' | 'client'>
                    value={relationship}
                    onChange={setRelationship}
                    options={[
                      { value: 'client', label: 'Homeowners' },
                      { value: 'prospect', label: 'Leads' },
                    ]}
                  />
                </div>
                <div>
                  <p className="text-[11.5px] font-semibold text-ink-3 uppercase tracking-wide m-0 mb-1">If already in CRM</p>
                  <Segmented<'update' | 'skip'>
                    value={dedupe}
                    onChange={setDedupe}
                    options={[
                      { value: 'update', label: 'Update them' },
                      { value: 'skip', label: 'Skip them' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="px-6 pt-5 pb-3">
              <h3 className="text-[15px] font-semibold text-ink m-0">Column mapping</h3>
              <p className="text-[12.5px] text-ink-2 mt-0.5 m-0">
                Auto-detected. Fix anything that looks wrong — unmapped columns are still saved on each lead under &quot;More details&quot;.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-[11.5px] font-semibold text-ink-3 uppercase tracking-wide">
                    <th className="px-6 py-2.5 border-b border-line">CSV column</th>
                    <th className="px-4 py-2.5 border-b border-line">Sample values</th>
                    <th className="px-6 py-2.5 border-b border-line w-[220px]">Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map(h => {
                    const samples = rows.slice(0, 3).map(r => r[h]).filter(Boolean).slice(0, 2)
                    const availableFields = TARGET_FIELDS.filter(f => !f.guestOnly)
                    return (
                      <tr key={h} className="hover:bg-[#fafbfe]">
                        <td className="px-6 py-3 border-b border-line text-[13.5px] font-semibold text-ink whitespace-nowrap">{h}</td>
                        <td className="px-4 py-3 border-b border-line text-[12.5px] text-ink-3 max-w-[280px] truncate">
                          {samples.join(' · ') || <span className="italic">empty</span>}
                        </td>
                        <td className="px-6 py-3 border-b border-line">
                          <Select
                            value={mapping[h] ?? ''}
                            onChange={e => setMapping(m => ({ ...m, [h]: e.target.value || null }))}
                            className={cn('w-full text-[13px]', mapping[h] ? 'border-accent/40 bg-accent-soft/30' : '')}
                          >
                            <option value="">Keep in &quot;More details&quot;</option>
                            {availableFields.map(f => (
                              <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-6 py-4">
              <Button variant="secondary" onClick={reset}><ArrowLeft size={15} /> Start over</Button>
              <Button onClick={runImport} disabled={contacts.length === 0}>
                Import {contacts.length.toLocaleString()} {relationship === 'client' ? 'homeowners' : 'leads'} <ArrowRight size={15} />
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* STEP 3: Importing */}
      {step === 'importing' && (
        <Card className="py-16 flex flex-col items-center justify-center">
          <Spinner size={28} />
          <p className="text-[15px] font-semibold text-ink mt-4 mb-1">Importing…</p>
          <p className="text-[13px] text-ink-2 m-0">{progress}% — deduping against existing records</p>
          <div className="w-64 h-2 bg-[#f2f4f7] rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </Card>
      )}

      {/* STEP 4: Done */}
      {step === 'done' && report && (
        <Card className="px-8 py-10">
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-good-soft text-good flex items-center justify-center mb-3">
              <CheckCircle2 size={28} />
            </div>
            <h2 className="text-[19px] font-bold text-ink m-0">Import complete</h2>
            <p className="text-[13.5px] text-ink-2 mt-1 m-0">{fileName}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto mb-7">
            <ReportStat label="Added" value={report.imported} tone="good" />
            <ReportStat label="Updated" value={report.updated} tone="accent" />
            <ReportStat label="Skipped" value={report.skipped} tone="gray" />
            <ReportStat label="Errors" value={report.errors.length} tone={report.errors.length > 0 ? 'bad' : 'gray'} />
          </div>
          {report.errors.length > 0 && (
            <div className="max-w-2xl mx-auto mb-6 bg-bad-soft rounded-xl p-4">
              <p className="text-[12.5px] font-bold text-bad m-0 mb-1.5">Rows with problems:</p>
              {report.errors.slice(0, 5).map((e, i) => (
                <p key={i} className="text-[12px] text-bad m-0">Row {e.row + 1}: {e.message}</p>
              ))}
              {report.errors.length > 5 && <p className="text-[12px] text-bad m-0 mt-1">…and {report.errors.length - 5} more</p>}
            </div>
          )}
          <div className="flex justify-center gap-2.5">
            <Button variant="secondary" onClick={reset}><RefreshCw size={15} /> Import another file</Button>
            <Link href="/crm"><Button><Users size={15} /> View leads</Button></Link>
          </div>
        </Card>
      )}
    </div>
  )
}

function ReportStat({ label, value, tone }: { label: string; value: number; tone: 'good' | 'accent' | 'gray' | 'bad' }) {
  const tones = {
    good: 'bg-good-soft text-good',
    accent: 'bg-accent-soft text-accent',
    gray: 'bg-[#f2f4f7] text-ink-2',
    bad: 'bg-bad-soft text-bad',
  }
  return (
    <div className={cn('rounded-xl px-4 py-3.5 text-center', tones[tone])}>
      <p className="text-[22px] font-bold m-0 leading-none">{value.toLocaleString()}</p>
      <p className="text-[12px] font-semibold m-0 mt-1 opacity-80">{label}</p>
    </div>
  )
}
