import { z } from 'zod'
import { FlowIdSchema, MediaIdSchema, OverlayIdSchema, PageIdSchema } from './id.js'
import { HexColorSchema } from './primitives.js'

/**
 * v1.0 · 页面覆盖层。**形状在 v1.0 冻死，v1.2 才通电**（冲突登记 X-09）。
 *
 * 从 `deferred.ts` 出列（该文件在本卡删除）。出列不改集合数——`pages` / `flows` 从 v0 起
 * 就在 `ID_COLLECTIONS` 里，搬家只是把它们从「未实现」的抽屉里拿出来。
 *
 * **`OVERLAY_TYPES` 恒为 4，这是 R13 的防线**（需求膨胀成页面搭建器）。加第五种 type 就是
 * 拆掉它——想表达更多东西请加 `OVERLAY_TOKENS`，那是另一条便宜得多的路。
 */

/** 九个锚点。从 `deferred.ts` 原样搬来，一个字节没改。 */
export const OVERLAY_ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const
export const OverlayAnchorSchema = z.enum(OVERLAY_ANCHORS)
export type OverlayAnchor = z.infer<typeof OverlayAnchorSchema>

/** 文本里可用的占位符。**加 token 不加 type**——这就是 R13 防线的泄压阀。 */
export const OVERLAY_TOKENS = ['{flowName}', '{stepName}', '{stepIndex}', '{stepTotal}'] as const
export type OverlayToken = (typeof OVERLAY_TOKENS)[number]

const TextPropsSchema = z
  .object({
    text: z.string().default(''),
    /** 以 1080 高为参考，随画面等比缩放。 */
    size: z.number().min(8).max(96).default(16),
    color: HexColorSchema.default('#ffffff'),
    align: z.enum(['left', 'center', 'right']).default('left'),
    /** 非空时 text 里的占位符按这个流程解析；null = 原样显示。 */
    flowId: FlowIdSchema.nullable().default(null),
  })
  .strict()

const ImagePropsSchema = z
  .object({
    /** `media.type` 必须是 image（I40）。 */
    mediaId: MediaIdSchema.nullable().default(null),
    fit: z.enum(['contain', 'cover']).default('contain'),
  })
  .strict()

const ButtonPropsSchema = z
  .object({
    label: z.string().default('按钮'),
    variant: z.enum(['primary', 'ghost']).default('primary'),
    /** 它要做什么**不在 props 里，在规则里**（X-10：`overlayClick` 事件，不是内联 onClick）。 */
  })
  .strict()

const PanelPropsSchema = z
  .object({
    title: z.string().default(''),
    text: z.string().default(''),
    /** image 或 video（I40）。 */
    mediaId: MediaIdSchema.nullable().default(null),
    flowId: FlowIdSchema.nullable().default(null),
    /** `flowId` 非空时，面板顶部画一条 stepIndex/stepTotal 的进度条。 */
    progress: z.boolean().default(false),
  })
  .strict()

/**
 * 画面比例 0..1（九个锚点不变）。
 *
 * 越界只 warn（I54），**不 refine**——像素 rect 换台机器就错位，但把它做成硬约束会让一份
 * 能打开的文档打不开（C4）。
 */
const RectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite(),
    h: z.number().finite(),
  })
  .strict()

/**
 * 四支 props 的默认值，显式写出来。
 *
 * `.default({})` 在 zod 4 上是类型错误——`.default()` 收的是**输出**类型，而这四支的每个
 * 字段都自带 default，所以输出里每个键都是必填的。规划 §4.1.4 写的是 `.default({})`，
 * 那是照 zod 3 的直觉写的；这里按 zod 4 的实际语义落地，值逐字取自各字段的 default。
 */
const DEFAULT_TEXT_PROPS = { text: '', size: 16, color: '#ffffff', align: 'left', flowId: null } as const
const DEFAULT_IMAGE_PROPS = { mediaId: null, fit: 'contain' } as const
const DEFAULT_BUTTON_PROPS = { label: '按钮', variant: 'primary' } as const
const DEFAULT_PANEL_PROPS = { title: '', text: '', mediaId: null, flowId: null, progress: false } as const

/**
 * 同一份默认值，按 type 索引——**给 v2→v3 迁移的 `normaliseOverlayProps` 用的**。
 *
 * 迁移那边原本手抄了一份一模一样的表。抄一份的代价不是理论上的：T-225 的反向比对刚刚
 * 逮到两处同源的抄写漂移（`hiddenEdge` 的枚举、`outline.strength` 的默认值），两处都编译
 * 通过、都校验通过、254 条单测全绿。第三份抄写没有理由存在。
 */
export const DEFAULT_OVERLAY_PROPS: Readonly<Record<OverlayType, Readonly<Record<string, unknown>>>> = {
  text: DEFAULT_TEXT_PROPS,
  image: DEFAULT_IMAGE_PROPS,
  button: DEFAULT_BUTTON_PROPS,
  panel: DEFAULT_PANEL_PROPS,
}

const base = { id: OverlayIdSchema, rect: RectSchema, anchor: OverlayAnchorSchema.default('tl') }

export const OVERLAY_TYPES = ['text', 'image', 'button', 'panel'] as const
export const OverlayTypeSchema = z.enum(OVERLAY_TYPES)
export type OverlayType = z.infer<typeof OverlayTypeSchema>

/**
 * **`id / type / rect / anchor / props` 五个字段的位置一个都没动**，只是 `props` 的内容被定死。
 * `/pages/0/overlays/2/props/text` 依然是稳定可读的 patch 路径。
 *
 * v2 的 `props` 是 `z.record(z.unknown())`——什么都能塞。判别联合 + 四支各自 `.strict()`
 * 是 X-09 的裁决：一个拼错的 prop 名今天会被静默保存、在 v1.2 渲染时变成「没生效」。
 */
export const OverlaySchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('text'), props: TextPropsSchema.default(DEFAULT_TEXT_PROPS) }).strict(),
  z.object({ ...base, type: z.literal('image'), props: ImagePropsSchema.default(DEFAULT_IMAGE_PROPS) }).strict(),
  z.object({ ...base, type: z.literal('button'), props: ButtonPropsSchema.default(DEFAULT_BUTTON_PROPS) }).strict(),
  z.object({ ...base, type: z.literal('panel'), props: PanelPropsSchema.default(DEFAULT_PANEL_PROPS) }).strict(),
])
export type Overlay = z.infer<typeof OverlaySchema>

export const PageSchema = z
  .object({
    id: PageIdSchema,
    /** v3 · 由 `z.string()` 收紧。 */
    name: z.string().min(1),
    overlays: z.array(OverlaySchema).default([]),
  })
  .strict()
export type Page = z.infer<typeof PageSchema>
