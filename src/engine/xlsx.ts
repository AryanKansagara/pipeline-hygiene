import { parseCsv, type Table } from './csv.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** Excel serial date to ISO text. Dates stay unambiguous no matter how the cell was formatted (m/d/yy, d/m/yyyy, ...). */
export function serialToIso(serial: number, date1904 = false): string {
  const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400) * 1000
  const d = new Date(ms)
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return ms % 86400000 ? `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : day
}

/** First sheet of an .xlsx / .xls workbook as a Table. Date cells become ISO; everything else keeps its displayed text. */
export async function readWorkbook(buf: ArrayBuffer): Promise<Table> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: true })
  const name = wb.SheetNames[0]
  if (!name) throw new Error('The workbook has no sheets')
  const ws = wb.Sheets[name]
  const date1904 = !!wb.Workbook?.WBProps?.date1904
  for (const [addr, cell] of Object.entries(ws)) {
    if (addr[0] === '!' || cell.t !== 'n' || !cell.z || !XLSX.SSF.is_date(cell.z)) continue
    cell.w = serialToIso(cell.v as number, date1904)
  }
  return parseCsv(XLSX.utils.sheet_to_csv(ws, { blankrows: true }))
}
