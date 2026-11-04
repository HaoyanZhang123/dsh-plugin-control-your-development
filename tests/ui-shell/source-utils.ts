/*
 * source-utils.ts —— 测试用的源码文本工具（不是测试文件本身，node --test 不会把它当用例跑）。
 */

/** 去掉注释，只留代码（注释里写"禁止词"是允许的，注释不是 UI 文案）。 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 取出所有字符串字面量（单引号/双引号），用于文案扫描。 */
export function stringLiterals(source: string): string[] {
  return [...source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)].map((match) => match[1] ?? match[2] ?? '')
}
