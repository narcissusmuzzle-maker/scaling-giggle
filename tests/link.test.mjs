import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'link-'))
fs.cpSync(path.join(root, 'shared'), path.join(tmp, 'shared'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
const imp = (f) => import(pathToFileURL(path.join(tmp, 'shared', f)).href)
const link = await imp('link.js')
const { forRatio, GRAY } = await imp('colors.js')

// упаковка и распаковка
const six = [0xd1544e, 0xe38b3f, 0xe0c441, 0x9cc24b, 0x43a857, 0x000000]
const s = link.pack(six)
assert.equal(s, 'd1544e,e38b3f,e0c441,9cc24b,43a857,000000')
assert.deepEqual(link.unpack(s), six)
// короткие числа дополняются нулями слева
assert.equal(link.pack([1, 2, 3, 4, 5, 6]), '000001,000002,000003,000004,000005,000006')
// не число -> серый
assert.equal(link.pack([null, undefined, NaN, 'x', 0xffffff, 0]).split(',')[0], '555555')
// повреждённое -> null (циферблат покрасит серым)
for (const bad of [null, undefined, '', 'abc', 'd1544e', 'd1544e,e38b3f', s + ',111111', 'zzzzzz,e38b3f,e0c441,9cc24b,43a857,000000', 'd1544e,e38b3f,e0c441,9cc24b,43a857,00000']) {
  assert.equal(link.unpack(bad), null, String(bad))
}
assert.equal(link.toInt('12'), 12)
assert.equal(link.toInt(undefined), 0)
assert.equal(link.toInt(''), 0)
assert.equal(link.toInt('abc'), 0)

// палитра: крайние точки и серый
assert.equal(forRatio(0), 0xd1544e)
assert.equal(forRatio(1), 0x43a857)
assert.equal(forRatio(7), 0x43a857)
assert.equal(forRatio(null), GRAY)

console.log('link: ok')
