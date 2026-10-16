/**
 * Shared phrase of every "in use" delete refusal ("<Noun> was not deleted
 * because ..."). Servers build their messages from it and the app detects the
 * refusal with it, so a wording change cannot silently drop "Archive instead".
 */
export const IN_USE_DELETE_MARKER = "was not deleted because";
