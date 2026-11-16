// Прогон циферблата в Node: вместо API часов подставляются заглушки, проверяется, что создаётся, куда ведут нажатия,
// как циферблат берёт цвета из общей памяти и когда запускает Luv Sync.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'face-'))
fs.cpSync(path.join(root, 'watchface'), path.join(tmp, 'watchface'), { recursive: true })
fs.cpSync(path.join(root, 'shared'), path.join(tmp, 'shared'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
// сборщик часов понимает импорт без расширения, Node — нет: в копии дописываем .js
const idx = path.join(tmp, 'watchface', 'index.js')
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/from '(\.\.\/shared\/\w+)'/g, "from '$1.js'"))
const mod = (name, code) => {
  const d = path.join(tmp, 'node_modules', ...name.split('/'))
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, type: 'module', main: 'index.js' }))
  fs.writeFileSync(path.join(d, 'index.js'), code)
}
// MORE: как на часах, setProperty(MORE, {...}) меняет сразу несколько свойств
mod('@zos/ui', `
export const widget = { FILL_RECT: 'FILL_RECT', BUTTON: 'BUTTON', TEXT: 'TEXT', WIDGET_DELEGATE: 'WIDGET_DELEGATE' }
export const prop = { TEXT: 'text', MORE: 'more' }
export const align = { CENTER_H: 1, CENTER_V: 2 }
export function createWidget(type, p) {
  if (globalThis.__noDelegate && type === 'WIDGET_DELEGATE') throw new Error('no delegate')
  const w = { type, p, setProperty(k, v) { if (k === 'more') Object.assign(w.p, v); else w.p[k] = v } }
  globalThis.__widgets.push(w)
  return w
}
export function deleteWidget(w) { globalThis.__widgets = globalThis.__widgets.filter((x) => x !== w) }
`)
mod('@zos/router', `export function launchApp(a) { globalThis.__launched.push(a) }`)

globalThis.__widgets = []
globalThis.__launched = []
// общая память часов
const mem = new Map()
globalThis.hmFS = {
  SysProSetChars(k, v) { mem.set(k, v); return 0 },
  SysProGetChars(k) { return mem.has(k) ? mem.get(k) : '' }
}
let fakeNow = 1_000_000_000_000
Date.now = () => fakeNow

let face = null
globalThis.WatchFace = (o) => { face = o }
await import(pathToFileURL(path.join(tmp, 'watchface', 'index.js')).href)
assert.ok(face && typeof face.build === 'function')
face.build()

const W = () => globalThis.__widgets
const rects = () => W().filter((w) => w.type === 'FILL_RECT')
const btns = W().filter((w) => w.type === 'BUTTON')
const dbg = () => W().filter((w) => w.type === 'TEXT').map((w) => w.p.text).join('|')
const segColors = () => rects().slice(1).map((r) => r.p.color)
const delegate = W().find((w) => w.type === 'WIDGET_DELEGATE')

// --- раскладка (как раньше) ---
assert.equal(rects().length, 1 + 6)
assert.deepEqual([rects()[0].p.w, rects()[0].p.h, rects()[0].p.color], [432, 514, 0])
for (const r of rects().slice(1)) assert.ok(r.p.y + r.p.h <= 257)
assert.equal(btns.length, 3)
assert.deepEqual(btns.map((b) => b.p.normal_src), ['b1.png', 'b2.png', 'b3.png'])
assert.deepEqual(btns.map((b) => b.p.press_src), ['b1p.png', 'b2p.png', 'b3p.png'])
for (const b of btns) assert.ok(b.p.y >= 257 && b.p.y + b.p.h <= 514)
for (const b of btns) for (const f of [b.p.normal_src, b.p.press_src]) {
  assert.ok(fs.existsSync(path.join(root, 'assets', 'default.w432-s', f)), f)
}
// без данных все шесть сегментов серые
assert.deepEqual(segColors(), Array(6).fill(0x555555))
assert.ok(delegate && typeof delegate.p.resume_call === 'function')

// --- нажатия: 🥗 и 🧩 — ничего, 🩸 — «Таймер» ---
btns[0].p.click_func(); btns[2].p.click_func()
assert.equal(globalThis.__launched.length, 0)
btns[1].p.click_func()
assert.deepEqual(globalThis.__launched, [{ appId: 1061363, native: false, url: 'page/index' }])
globalThis.__launched.length = 0

// --- первое «циферблат на экране»: запускается Luv Sync с параметром auto ---
delegate.p.resume_call()
assert.deepEqual(globalThis.__launched, [{ appId: 1072512, native: false, url: 'page/index', param: 'auto' }])
assert.equal(mem.get('luv_try'), String(fakeNow))
assert.match(dbg(), /res=1/)
assert.match(dbg(), /sync:go/)

// --- защита от зацикливания: возврат с Luv Sync через 3 секунды новый запуск не делает ---
fakeNow += 3000
delegate.p.resume_call()
assert.equal(globalThis.__launched.length, 1)
assert.match(dbg(), /wait/)

// --- Luv Sync записал цвета: при возвращении сегменты перекрашиваются (месяц, неделя, день; потом общая) ---
const colors = ['d1544e', 'e38b3f', 'e0c441', '9cc24b', '43a857', '123456']
mem.set('luv_c', colors.join(','))
mem.set('luv_n', '7')
mem.set('luv_ts', String(fakeNow - 2000))
delegate.p.resume_call()
assert.deepEqual(segColors(), colors.map((c) => parseInt(c, 16)))
assert.match(dbg(), /n=7/)
assert.match(dbg(), /age=2s/)
assert.equal(globalThis.__launched.length, 1)   // всё ещё внутри защитного окна

// --- через 20 секунд (экран включили снова) — новый запуск ---
fakeNow += 20000
delegate.p.resume_call()
assert.equal(globalThis.__launched.length, 2)
assert.deepEqual(globalThis.__launched[1], { appId: 1072512, native: false, url: 'page/index', param: 'auto' })

// --- повреждённые данные — серый, но не падаем ---
mem.set('luv_c', 'мусор')
fakeNow += 20000
delegate.p.resume_call()
assert.deepEqual(segColors(), Array(6).fill(0x555555))

// --- общая память недоступна: ничего не запускается и не падает ---
const saved = globalThis.hmFS
delete globalThis.hmFS
fakeNow += 20000
const before = globalThis.__launched.length
delegate.p.resume_call()
assert.equal(globalThis.__launched.length, before)
assert.match(dbg(), /noSysPro/)
globalThis.hmFS = saved

// --- если платформа не дала «наблюдателя»: запуск один раз при создании, без падения ---
globalThis.__noDelegate = true
globalThis.__widgets = []
globalThis.__launched = []
mem.clear()
face.build()
assert.equal(globalThis.__launched.length, 1)
assert.match(dbg(), /noDelegate|sync:go/)
console.log('face: ok')
