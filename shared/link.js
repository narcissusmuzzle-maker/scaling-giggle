/**
 * Общий «язык» между синхронизатором (Luv Sync) и циферблатом (Luv Face).
 * Оба кладут и читают строки в общую системную память часов (hmFS.SysProSetChars / SysProGetChars).
 * Этот файл лежит в обоих проектах в одинаковом виде. Чистые функции — проверяются тестами в Node.
 */

// Ключи общей памяти
export const KEY_COLORS = 'luv_c'    // 6 цветов через запятую, например "d1544e,e38b3f,e0c441,9cc24b,43a857,555555"
export const KEY_TS = 'luv_ts'       // когда синхронизатор записал цвета (мс, Date.now())
export const KEY_N = 'luv_n'         // счётчик записей (нужен только для проверки прототипа)
export const KEY_TRY = 'luv_try'     // когда циферблат в последний раз запускал синхронизатор (мс)

// 6 сегментов: слова (месяц, неделя, день), затем общая полоска (месяц, неделя, день)
export const SEG_TOTAL = 6

const HEX6 = /^[0-9a-fA-F]{6}$/

/** Массив из 6 чисел-цветов -> строка "rrggbb,rrggbb,...". */
export function pack(colors) {
  const out = []
  for (let i = 0; i < SEG_TOTAL; i++) {
    const c = colors[i]
    const v = (typeof c === 'number' && isFinite(c)) ? (c & 0xffffff) : 0x555555
    out.push(('000000' + v.toString(16)).slice(-6))
  }
  return out.join(',')
}

/** Строка -> массив из 6 чисел-цветов. Если строка пустая или повреждена — null (циферблат тогда красит серым). */
export function unpack(str) {
  if (typeof str !== 'string' || str.length === 0) return null
  const parts = str.split(',')
  if (parts.length !== SEG_TOTAL) return null
  const out = []
  for (let i = 0; i < SEG_TOTAL; i++) {
    if (!HEX6.test(parts[i])) return null
    out.push(parseInt(parts[i], 16))
  }
  return out
}

/** Целое число из строки памяти (нет значения или мусор — 0). */
export function toInt(s) {
  const v = parseInt(s, 10)
  return isFinite(v) ? v : 0
}
