// Разбор geosite.dat/geoip.dat — protobuf без библиотеки. Схема сверена с
// common/geodata/geodat.proto (Xray-core):
//   GeoSiteList { repeated GeoSite entry = 1 }
//   GeoSite     { string code = 1; repeated Domain domain = 2 }
//   Domain      { Type type = 1; string value = 2; repeated Attribute attribute = 3 }
//   Attribute   { string key = 1; oneof { bool bool_value = 2; int64 int_value = 3 } }
//   GeoIPList   { repeated GeoIP entry = 1 }
//   GeoIP       { string code = 1; repeated CIDR cidr = 2; bool reverse_match = 3 }
//   CIDR        { bytes ip = 1; uint32 prefix = 2 }

/** Substr = 0, Regex = 1, Domain = 2, Full = 3 — нумерация из geodat.proto */
export interface GeoDomain {
  type: 0 | 1 | 2 | 3
  value: string
  attributes: string[]
}

export interface GeoCidr {
  ip: Uint8Array
  prefix: number
}

interface Reader {
  buf: Uint8Array
  pos: number
}

function readVarint(r: Reader): number {
  let result = 0
  let shift = 0
  while (r.pos < r.buf.length) {
    const byte = r.buf[r.pos++]!
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return result
    shift += 7
  }
  return result
}

function readBytes(r: Reader): Uint8Array {
  const len = readVarint(r)
  const start = r.pos
  r.pos = Math.min(start + len, r.buf.length)
  return r.buf.subarray(start, r.pos)
}

/** Пропуск неизвестного поля по его wire type — иначе новые поля ломали бы разбор */
function skipField(r: Reader, wire: number): void {
  if (wire === 0) readVarint(r)
  else if (wire === 1) r.pos += 8
  else if (wire === 2) readBytes(r)
  else if (wire === 5) r.pos += 4
  else r.pos = r.buf.length // неизвестный wire type — дальше читать нечего
}

const decoder = new TextDecoder()

/**
 * Код категории → сырые байты записи. Домены и CIDR внутри записи не разбираются:
 * geosite-база — это сотни категорий и сотни тысяч доменов, а нужна почти всегда
 * пара категорий из всей базы.
 */
export function indexEntries(buf: Uint8Array): Map<string, Uint8Array> {
  const index = new Map<string, Uint8Array>()
  const r: Reader = { buf, pos: 0 }
  while (r.pos < buf.length) {
    const key = readVarint(r)
    const wire = key & 7
    if (key >>> 3 !== 1 || wire !== 2) {
      skipField(r, wire)
      continue
    }
    const entry = readBytes(r)
    const er: Reader = { buf: entry, pos: 0 }
    let code = ''
    while (er.pos < entry.length) {
      const ekey = readVarint(er)
      const ewire = ekey & 7
      if (ekey >>> 3 === 1 && ewire === 2) {
        code = decoder.decode(readBytes(er))
        break // остальное (домены/CIDR) читаем только по требованию
      }
      skipField(er, ewire)
    }
    if (code !== '') index.set(code, entry)
  }
  return index
}

export function parseDomains(entry: Uint8Array): GeoDomain[] {
  const domains: GeoDomain[] = []
  const r: Reader = { buf: entry, pos: 0 }
  while (r.pos < entry.length) {
    const key = readVarint(r)
    const wire = key & 7
    if (key >>> 3 !== 2 || wire !== 2) {
      skipField(r, wire)
      continue
    }
    const raw = readBytes(r)
    const dr: Reader = { buf: raw, pos: 0 }
    let type: GeoDomain['type'] = 0
    let value = ''
    const attributes: string[] = []
    while (dr.pos < raw.length) {
      const dkey = readVarint(dr)
      const dwire = dkey & 7
      const field = dkey >>> 3
      if (field === 1 && dwire === 0) type = readVarint(dr) as GeoDomain['type']
      else if (field === 2 && dwire === 2) value = decoder.decode(readBytes(dr))
      else if (field === 3 && dwire === 2) {
        const attr = readBytes(dr)
        const ar: Reader = { buf: attr, pos: 0 }
        while (ar.pos < attr.length) {
          const akey = readVarint(ar)
          const awire = akey & 7
          if (akey >>> 3 === 1 && awire === 2) attributes.push(decoder.decode(readBytes(ar)))
          else skipField(ar, awire)
        }
      } else skipField(dr, dwire)
    }
    domains.push({ type, value, attributes })
  }
  return domains
}

export function parseCidrs(entry: Uint8Array): { cidrs: GeoCidr[]; reverseMatch: boolean } {
  const cidrs: GeoCidr[] = []
  let reverseMatch = false
  const r: Reader = { buf: entry, pos: 0 }
  while (r.pos < entry.length) {
    const key = readVarint(r)
    const wire = key & 7
    const field = key >>> 3
    if (field === 2 && wire === 2) {
      const raw = readBytes(r)
      const cr: Reader = { buf: raw, pos: 0 }
      // Явная аннотация: без неё выводится Uint8Array<ArrayBuffer>, куда не лечь
      // результату subarray (Uint8Array<ArrayBufferLike>)
      let ip: Uint8Array = new Uint8Array()
      let prefix = 0
      while (cr.pos < raw.length) {
        const ckey = readVarint(cr)
        const cwire = ckey & 7
        if (ckey >>> 3 === 1 && cwire === 2) ip = readBytes(cr)
        else if (ckey >>> 3 === 2 && cwire === 0) prefix = readVarint(cr)
        else skipField(cr, cwire)
      }
      cidrs.push({ ip, prefix })
    } else if (field === 3 && wire === 0) {
      reverseMatch = readVarint(r) !== 0
    } else skipField(r, wire)
  }
  return { cidrs, reverseMatch }
}

// --- Кодирование: нужно тестам и фикстурам, боевой код им не пользуется ---

function varint(value: number): number[] {
  const out: number[] = []
  let v = value
  while (v > 127) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}

const encoder = new TextEncoder()

function tagged(field: number, wire: number, payload: number[]): number[] {
  return [...varint((field << 3) | wire), ...payload]
}

function lengthDelimited(field: number, body: number[]): number[] {
  return tagged(field, 2, [...varint(body.length), ...body])
}

function domainBody(d: GeoDomain): number[] {
  const out: number[] = []
  if (d.type !== 0) out.push(...tagged(1, 0, varint(d.type)))
  out.push(...lengthDelimited(2, [...encoder.encode(d.value)]))
  for (const attr of d.attributes) {
    // Attribute { key = 1, bool_value = 2 } — атрибуты в базах хранятся как bool true
    const body = [...lengthDelimited(1, [...encoder.encode(attr)]), ...tagged(2, 0, varint(1))]
    out.push(...lengthDelimited(3, body))
  }
  return out
}

export function encodeGeoSiteList(entries: { code: string; domains: GeoDomain[] }[]): Uint8Array {
  const out: number[] = []
  for (const entry of entries) {
    const body = [
      ...lengthDelimited(1, [...encoder.encode(entry.code)]),
      ...entry.domains.flatMap((d) => lengthDelimited(2, domainBody(d))),
    ]
    out.push(...lengthDelimited(1, body))
  }
  return new Uint8Array(out)
}

export function encodeGeoIpList(
  entries: { code: string; cidrs: GeoCidr[]; reverseMatch?: boolean }[],
): Uint8Array {
  const out: number[] = []
  for (const entry of entries) {
    const body = [...lengthDelimited(1, [...encoder.encode(entry.code)])]
    for (const cidr of entry.cidrs) {
      const cidrBody = [...lengthDelimited(1, [...cidr.ip])]
      if (cidr.prefix !== 0) cidrBody.push(...tagged(2, 0, varint(cidr.prefix)))
      body.push(...lengthDelimited(2, cidrBody))
    }
    if (entry.reverseMatch) body.push(...tagged(3, 0, varint(1)))
    out.push(...lengthDelimited(1, body))
  }
  return new Uint8Array(out)
}
