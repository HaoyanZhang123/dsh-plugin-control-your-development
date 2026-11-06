/*
 * ui/rail/index.ts —— 右侧目录卡片的唯一出口。
 */
export { DirectoryRail, type DirectoryRailProps } from './DirectoryRail.ts'
export {
  DIRECTORY_RELATION_TYPES,
  buildDirectoryRelationSummary,
  type DirectoryRelationOptions,
  type DirectoryRelationPartner,
  type DirectoryRelationSummary,
} from './relations.ts'
export {
  buildDirectoryCards,
  defaultDirectoryKey,
  compareDirectoryCards,
  compareTopFiles,
  DIRECTORY_TOP_FILES,
  directoryCardsSummary,
  directoryKeyOf,
  directoryLabelOf,
  type DirectoryCard,
  type DirectoryCardsOptions,
  type DirectoryFamily,
  type DirectoryTopFile,
} from './directories.ts'

export { FILE_FAMILIES, FAMILY_COLOR } from '../map/theme.ts'
