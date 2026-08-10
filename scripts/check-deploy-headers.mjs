import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * T-275 · 部署模板里的两道锁，写成机器。
 *
 * ## 为什么一份 nginx 模板需要守卫
 *
 * 这两条规则的失效方式完全无声：`frame-ancestors` 的默认值被人改成 `*` 之后，部署起来
 * 一切正常、页面照常打开、测试全绿——只是从那天起任何网站都能把我们嵌进去。
 * `bench.html` 的 404 规则被删掉同理：多出一个无访问控制的压测入口，而没有任何东西会响。
 *
 * 模板是文本，所以检查也是文本——这一条的价值不在技术含量，在它存在。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = join(ROOT, 'deploy/nginx.conf.template')

const text = readFileSync(TEMPLATE, 'utf8')
const lines = text.split(/\r?\n/)
const violations = []

/** `location /player/ { … }` 那一段的正文。找不到就是模板结构变了。 */
function playerBlock() {
  const from = lines.findIndex((l) => /^\s*location\s+\/player\/\s*\{/.test(l))
  if (from === -1) return null
  let depth = 0
  for (let i = from; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) ?? []).length
    depth -= (lines[i].match(/\}/g) ?? []).length
    if (depth === 0) return lines.slice(from, i + 1).join('\n')
  }
  return null
}

const block = playerBlock()

/**
 * 一段配置里**不含注释**的部分。
 *
 * ⚠ 第一版没剥注释，于是「改成客户宿主域：frame-ancestors https://customer.example …」
 * 那句**示例注释**被当成了生效的指令，守卫当场误报。一份好模板必然在注释里写示例，
 * 所以剥注释不是可选的。
 */
const directives = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

/* 规则 1 · /player/ 块里必须有 frame-ancestors ---------------------------- */
if (block === null) {
  violations.push('模板里找不到 `location /player/ { … }` 块——结构变了，下面每一条检查都会「通过」')
} else if (!/frame-ancestors/.test(directives(block))) {
  violations.push('`location /player/` 里没有 frame-ancestors——任何网站都能把播放器嵌进 iframe')
}

/* 规则 2 · 默认值必须是 'none' ------------------------------------------- */
if (block) {
  // 取到闭引号为止。第一版写的是 `[^"';]+` —— 而值本身就是 `'none'`，单引号被字符类
  // 排掉，于是「读不出来」。指令的边界是那对双引号，不是引号字符本身。
  const directive = /frame-ancestors\s+([^"]*)/.exec(directives(block))
  if (!directive) {
    violations.push('frame-ancestors 的值读不出来')
  } else {
    const value = directive[1].trim()
    if (value !== "'none'") {
      violations.push(
        `frame-ancestors 的默认值是 ${value}，必须是 'none'。改成客户宿主域是部署时的动作，` +
          '不是模板的默认——模板里写一个宽松值，等于每一次新部署都默认敞开',
      )
    }
  }
}

/* 规则 3 · bench.html 必须有 404 规则 ------------------------------------ */
const noComments = directives(text)
if (!/location\s*=\s*\/player\/bench\.html/.test(noComments) || !/bench\.html[\s\S]{0,200}?return\s+404/.test(noComments)) {
  violations.push(
    'bench.html 没有 404 规则——它随 dist 一起部署且没有任何访问控制，' +
      '任何知道地址的人都能让这台机器跑一轮压力测试',
  )
}

/* 规则 4 · 模板里零 X-Frame-Options -------------------------------------- */
const xfo = lines.findIndex((l) => /X-Frame-Options/i.test(l) && !/^\s*#/.test(l))
if (xfo >= 0) {
  violations.push(
    `nginx.conf.template:${xfo + 1}  出现了 X-Frame-Options。它只认 DENY / SAMEORIGIN / 单个 ALLOW-FROM，` +
      '而 ALLOW-FROM 早已被主流浏览器移除（Chrome 从未支持）——写一个客户域进去等于「Chrome 上没写、Firefox 上 DENY」',
  )
}

/* 扫描面下限 -------------------------------------------------------------- */
if (lines.length < 30) {
  violations.push(`模板只有 ${lines.length} 行——读到的多半不是那份文件`)
}

if (violations.length > 0) {
  console.log(`FAIL  部署 · frame-ancestors 与 bench 封堵  — ${violations.length} 处`)
  for (const v of violations) console.log(`      ${v}`)
  process.exit(1)
}

console.log(`  模板 ${lines.length} 行 / /player/ 块 ${block.split('\n').length} 行 / 四条规则`)
console.log('PASS  部署 · frame-ancestors 与 bench 封堵')
