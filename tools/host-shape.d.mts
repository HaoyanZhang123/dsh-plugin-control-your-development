/**
 * tools/host-shape.d.mts —— `host-shape.mjs` 的类型声明。
 *
 * 为什么需要：门禁逻辑被抽成 `.mjs` 是为了让 build.mjs（纯 node、无 TS）与
 * tests/integration/host-shape.test.ts（TS，strict）共用同一份实现。
 * 但 tsconfig 的 `strict` + 没有 `allowJs`，直接 import 一个 `.mjs` 会报 TS7016。
 * 加一份手写声明比放宽编译器选项更好：它同时把「白名单/黑名单」的类型钉住，
 * 谁改了导出的形状，typecheck 立刻红。
 */

/** 允许的 fs 模块说明符（只读 promise 面）。 */
export declare const HOST_FS_ALLOWED_MODULES: readonly string[]

/** 只读白名单：从 fs 导入时只允许这些名字。 */
export declare const HOST_FS_READ_ALLOWLIST: readonly string[]

/** 写 / 变更类 fs API：出现在导入绑定或命名空间属性里即越界。 */
export declare const HOST_FS_FORBIDDEN_APIS: readonly string[]

/** 只读读目录函数：引了 fs 就必须真的用其中之一。 */
export declare const HOST_FS_READ_APIS: readonly string[]

/**
 * 检查 host 产物文本的 fs 边界。
 *
 * @returns 失败原因列表；空数组 = 通过
 */
export declare function hostShapeFailures(text: string): string[]

/** 便捷判定：host 产物是否满足 fs 边界。 */
export declare function assertHostFsBoundary(text: string): { ok: boolean; failures: string[] }
