import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeText, parseCsv } from './csv.ts'

const read = (b: Buffer) => decodeText(new Uint8Array(b).buffer)
const TEXT = 'Account ID,Account Name,City\n001,Société Générale,Zürich\n002,Niño,A\u00a0Coruña\n'

test('ISO-8859-1 and Windows-1252 keep their accents', () => {
  assert.equal(read(Buffer.from(TEXT, 'latin1')), TEXT)
  assert.equal(read(Buffer.from([0x80, 0x20, 0x93, 0x78, 0x94])), '€ “x”')
  assert.equal(read(Buffer.from('Caf\xe9', 'latin1')), 'Café')
})

test('UTF-8 is unchanged', () => {
  for (const t of ['', 'plain', TEXT, '日本語, Ω, 🎉\n', 'literal \ufffd kept']) {
    assert.equal(read(Buffer.from(t)), t)
    assert.equal(read(Buffer.from('\ufeff' + t)), t)
  }
})

test('UTF-8 cut inside a character is still UTF-8', () => {
  const whole = Buffer.from('Société, Zürich é')
  assert.equal(read(whole.subarray(0, -1)), 'Société, Zürich \ufffd')
  assert.equal(read(Buffer.from('\ufeffZ é').subarray(0, -1)), 'Z \ufffd')
})

test('UTF-16 with a byte order mark is decoded, both ways round', () => {
  const t = 'Account ID\tAccount Name\tCity\r\n001\tSociété\tZürich\r\n'
  const le = Buffer.from('\ufeff' + t, 'utf16le')
  assert.equal(read(le), t)
  assert.equal(read(Buffer.from(le).swap16()), t)
  assert.deepEqual(parseCsv(read(le)).rows[1], ['001', 'Société', 'Zürich'])
  assert.deepEqual(parseCsv(read(le.subarray(0, -5))).rows.length, 2)
})
