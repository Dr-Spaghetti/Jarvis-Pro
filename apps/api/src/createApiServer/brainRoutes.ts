// Thin re-export barrel. All logic lives in the brain/ subdirectory.
export { handleBrainJournalRoute } from "./brain/journal";
export { handleBrainMemoryRoute, handleBrainRememberRoute } from "./brain/memory";
export { handleBrainHealthRoute } from "./brain/health";
export { handleBrainTasksRoute } from "./brain/tasks";
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
export { handleBrainLearningsRoute } from "./brain/learnings";
export { resolveVaultDir } from "./brain/vault";
