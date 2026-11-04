/*
 * ui/modal/index.ts —— `/threadline` 弹窗的唯一出口（T09 的 command 入口只从这里 import）。
 */
export {
  buildModalModel,
  fileNodesOfDetail,
  modalPath,
  modalStatusLabel,
  modalTitle,
  type ModalModel,
  type ModalTurnRow,
} from './model.ts'
export {
  closeModal,
  getModalState,
  openModal,
  openModalCount,
  resetModalStore,
  subscribeModal,
  useModalState,
  type ModalState,
} from './store.ts'
export { ThreadlineModal, type ModalFocusRequest, type ThreadlineModalProps } from './ThreadlineModal.ts'
