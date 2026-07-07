// Thin re-export barrel. All logic lives in the brain/ subdirectory.
export { handleBrainJournalRoute } from "./brain/journal";
export { handleBrainMemoryRoute, handleBrainRememberRoute } from "./brain/memory";
export {
  handleBrainRecentRoute,
  handleBrainNoteRoute,
  handleBrainCaptureRoute,
} from "./brain/notes";
export { handleBrainSearchRoute, handleBrainSemanticRoute } from "./brain/search";
export {
  type BrainDigest,
  computeBrainDigest,
  computeBrainTileStats,
  handleBrainDigestRoute,
  localDateStamp,
} from "./brain/digest";
export {
  handleBrainConversationRoute,
  parseConversationMarkdown,
} from "./brain/conversation";
export { handleBrainModelsRoute, handleBrainAskRoute } from "./brain/ask";
export { resolveVaultDir } from "./brain/vault";
