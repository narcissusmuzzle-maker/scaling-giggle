/**
 * Циферблат U613 (Luv Face). Часов на экране нет: чёрный экран, сверху две полоски статистики (по три сегмента:
 * месяц / неделя / день, без подписей), снизу три кнопки 🥗 🩸 🧩.
 *  - 🩸 открывает приложение «Таймер» (U613, appId 1061363) — то, что уже стоит на часах.
 *  - 🥗 и 🧩 пока ничего не делают.
 *  - Цвета шести сегментов (верхняя полоска — слова, нижняя — общая) циферблат берёт из общей памяти часов
 *    (ключ luv_c, см. shared/link.js). Туда их кладёт приложение Luv Sync. Нет данных — серый.
 *  - При каждом возвращении на циферблат (включили экран, вышли из приложения) циферблат перекрашивает сегменты и
 *    запускает Luv Sync (appId 1072512), чтобы цвета обновились. Эта же функция защищена от зацикливания (SYNC_GUARD_MS).
 *  - ПРОТОТИП: цвета, которые пишет Luv Sync, пока придуманные; настоящие будет присылать телефон.
 * Положение всего задаётся в shared/layout.js, цвета — в shared/colors.js.
 */
import { createWidget, widget, prop, align } from '@zos/ui'
import * as ui from '@zos/ui'
import * as router from '@zos/router'
import * as lay from '../shared/layout'
import * as col from '../shared/colors'
import * as link from '../shared/link'

// Приложение, которое открывает 🩸 (должно совпадать с app.json приложения «Таймер»)
const TIMER_APP_ID = 1061363
const TIMER_APP_URL = 'page/index'

// Приложение-синхронизатор (должно совпадать с app.json Luv Sync)
const SYNC_APP_ID = 1072512
const SYNC_APP_URL = 'page/index'
// Защита от зацикливания: Luv Sync, закончив, возвращает на циферблат — это снова «возвращение на экран».
// Чтобы он не запускал сам себя по кругу, второй запуск раньше чем через столько миллисекунд не делается.
// Пока экран включаешь руками, на это не влияет (между включениями проходит больше).
const SYNC_GUARD_MS = 15000

// Строка проверки под полосками («n=запись res=возвращений age=давность статус»). В готовой версии поставить false.
const DEBUG = true

const BLACK = 0x000000
const RED = 0xff4517

let errText = null
let dbgText = null
let resumes = 0
let lastStatus = '-'
const segs = []   // шесть сегментов: 0..2 — слова (месяц, неделя, день), 3..5 — общая полоска

// ---------- общая память часов ----------
function hasSys() {
  try { return typeof hmFS !== 'undefined' && !!hmFS && typeof hmFS.SysProGetChars === 'function' } catch (e) { return false }
}
function sysGet(key) {
  try {
    if (hasSys()) { const v = hmFS.SysProGetChars(key); return typeof v === 'string' ? v : '' }
  } catch (e) { /* нет значения */ }
  return ''
}
function sysSet(key, val) {
  try {
    if (hasSys() && typeof hmFS.SysProSetChars === 'function') { hmFS.SysProSetChars(key, val); return true }
  } catch (e) { /* не записалось */ }
  return false
}

// ---------- сообщения ----------
function showError(msg) {
  try {
    if (errText) { errText.setProperty(prop.TEXT, String(msg).slice(0, 60)); return }
  } catch (e) { /* пересоздадим */ }
  try {
    errText = createWidget(widget.TEXT, {
      x: lay.AREA_X, y: lay.halfY(lay.SCREEN_H) - 16, w: lay.AREA_W, h: 32, color: RED, text_size: 20,
      align_h: align.CENTER_H, align_v: align.CENTER_V, text: String(msg).slice(0, 60)
    })
  } catch (e) { /* показать нечем */ }
}

function showDebug() {
  if (!DEBUG || !dbgText) return
  const n = link.toInt(sysGet(link.KEY_N))
  const ts = link.toInt(sysGet(link.KEY_TS))
  const age = ts > 0 ? Math.max(0, Math.round((Date.now() - ts) / 1000)) + 's' : '-'
  try { dbgText.setProperty(prop.TEXT, 'n=' + n + ' res=' + resumes + ' age=' + age + ' ' + lastStatus) } catch (e) { /* не страшно */ }
}

// ---------- запуск приложений ----------
/** Открыть приложение. Возвращает true, если команда ушла без ошибки. Иначе — красная надпись между половинами экрана. */
function openApp(appId, url, param) {
  let why = ''
  const opt = { appId: appId, native: false, url: url }
  if (param) opt.param = param
  try {
    if (router && typeof router.launchApp === 'function') {
      router.launchApp(opt)
      return true
    }
    why = 'нет launchApp'
  } catch (e) { why = 'launchApp: ' + e }
  try {
    if (typeof hmApp !== 'undefined' && hmApp && typeof hmApp.startApp === 'function') {
      const o2 = { appid: appId, url: url, native: false }
      if (param) o2.param = param
      hmApp.startApp(o2)
      return true
    }
  } catch (e) { why += ' startApp: ' + e }
  showError(why || 'не открылось')
  return false
}

function openTimer() { openApp(TIMER_APP_ID, TIMER_APP_URL) }

function nothing() { /* кнопка пока не работает */ }

// ---------- сегменты ----------
function makeSeg(x, y, w, h, color) {
  return { handle: createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, color: color }), x: x, y: y, w: w, h: h, color: color }
}

function paintSeg(s, color) {
  if (s.color === color) return
  s.color = color
  try {
    if (prop.MORE !== undefined) {
      s.handle.setProperty(prop.MORE, { x: s.x, y: s.y, w: s.w, h: s.h, color: color })
      return
    }
  } catch (e) { /* запасной путь ниже */ }
  // запасной путь: убрать сегмент и нарисовать заново
  try { if (typeof ui.deleteWidget === 'function') ui.deleteWidget(s.handle) } catch (e) { /* ничего */ }
  s.handle = createWidget(widget.FILL_RECT, { x: s.x, y: s.y, w: s.w, h: s.h, color: color })
}

/** Перекрасить все шесть сегментов из общей памяти. Нет данных или они повреждены — серый. */
function paintAll() {
  const c = link.unpack(sysGet(link.KEY_COLORS))
  for (let i = 0; i < segs.length; i++) paintSeg(segs[i], c ? c[i] : col.GRAY)
}

// ---------- запуск синхронизатора ----------
function maybeSync(now) {
  if (!hasSys()) { lastStatus = 'noSysPro'; return }
  const last = link.toInt(sysGet(link.KEY_TRY))
  if (last <= now && now - last < SYNC_GUARD_MS) { lastStatus = 'wait'; return }
  sysSet(link.KEY_TRY, String(now))
  lastStatus = openApp(SYNC_APP_ID, SYNC_APP_URL, 'auto') ? 'sync:go' : 'sync:fail'
}

/** Циферблат снова на экране (первый запуск, включение экрана, возврат из приложения). */
function onResume() {
  resumes++
  paintAll()
  maybeSync(Date.now())
  showDebug()
}

WatchFace({
  build() {
    // чёрный фон на весь экран
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: lay.SCREEN_W, h: lay.SCREEN_H, color: BLACK })

    // верх: две полоски по три сегмента (серые, пока нет данных)
    const st = lay.strips(lay.SCREEN_H)
    for (let k = 0; k < st.length; k++) {
      for (let j = 0; j < st[k].segs.length; j++) {
        segs.push(makeSeg(st[k].segs[j].x, st[k].y, st[k].segs[j].w, st[k].h, col.GRAY))
      }
    }

    // низ: три кнопки 🥗 🩸 🧩 (картинки b1/b2/b3, при нажатии — затемнённые b1p/b2p/b3p)
    const bt = lay.buttons(lay.SCREEN_H)
    const act = [nothing, openTimer, nothing]
    for (let k = 0; k < 3; k++) {
      createWidget(widget.BUTTON, {
        x: bt[k].x, y: bt[k].y, w: bt[k].w, h: bt[k].h, text: '',
        normal_src: 'b' + (k + 1) + '.png', press_src: 'b' + (k + 1) + 'p.png', click_func: act[k]
      })
    }

    // строка проверки под второй полоской
    if (DEBUG) {
      try {
        dbgText = createWidget(widget.TEXT, {
          x: lay.AREA_X, y: st[1].y + st[1].h + 8, w: lay.AREA_W, h: 28, color: 0x888888, text_size: 18,
          align_h: align.CENTER_H, align_v: align.CENTER_V, text: ''
        })
      } catch (e) { /* без строки проверки */ }
    }

    paintAll()

    // «циферблат снова на экране»: платформа сама вызывает resume_call при запуске и при каждом возвращении
    let delegated = false
    try {
      createWidget(widget.WIDGET_DELEGATE, { resume_call: onResume, pause_call: function () {} })
      delegated = true
    } catch (e) { lastStatus = 'noDelegate' }
    if (!delegated) maybeSync(Date.now())   // хотя бы при запуске циферблата
    showDebug()
  },
  onInit() {},
  onDestroy() {}
})
