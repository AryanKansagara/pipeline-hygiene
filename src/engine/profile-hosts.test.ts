import assert from 'node:assert/strict'
import { test } from 'node:test'
import { domainOf, findDuplicates } from './dedupe.ts'
import type { Party } from './types.ts'

const acct = (id: string, name: string, website: string): Party => ({ id, kind: 'account', name, website, fields: {} })
const clusters = (...a: [string, string][]) => findDuplicates(a.map(([n, w], i) => acct(`001${i}`, n, w))).clusters

test('a social profile identifies nobody', () => {
  for (const w of ['https://www.facebook.com/bluebakery', 'facebook.com', 'https://m.facebook.com/x', 'HTTPS://uk.linkedin.com/company/acme', 'linkedin.com/company/acme', 'instagram.com/acme', 'https://x.com/acme', 'twitter.com/acme', 'https://www.youtube.com/@acme', 'https://www.tiktok.com/@acme.co', 'https://linktr.ee/acme', 'https://sites.google.com/view/acme', 'g.page/acme', 'https://medium.com/@acme.io', 'en-gb.facebook.com/acme'])
    assert.equal(domainOf(w), '', w)
})

test('real company domains still do', () => {
  for (const [w, d] of [['https://acme.com/facebook.com', 'acme.com'], ['notfacebook.com', 'notfacebook.com'], ['max.com', 'max.com'], ['netflix.com', 'netflix.com'], ['acme.medium.com', 'acme.medium.com'], ['shop.acme.com', 'shop.acme.com'], ['https://acme.com/@team', 'acme.com'], ['facebook.com.acme.com', 'facebook.com.acme.com'], ['ann@linkedin.com', 'linkedin.com'], ['mailto:ann@acme.com', 'acme.com'], ['https://user:pw@acme.com/x', 'acme.com'], ['ann@gmail.com', '']])
    assert.equal(domainOf(w), d, w)
})

test('two companies with pages on one site are not a cluster', () => {
  assert.equal(clusters(['Blue Bakery', 'https://www.facebook.com/bluebakery'], ['Zed Plumbing', 'https://facebook.com/zedplumb']).length, 0)
  assert.equal(clusters(['Blue Bakery', 'https://bluebakery.com'], ['Blue Bakery Inc', 'https://facebook.com/bluebakery']).length, 1)
  assert.equal(clusters(['Blue Bakery', 'https://bluebakery.com/a'], ['Bakers of Blue', 'http://www.bluebakery.com']).length, 1)
})
