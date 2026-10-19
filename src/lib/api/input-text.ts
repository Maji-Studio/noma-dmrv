/** C0, DEL and C1 controls cannot identify resources or appear in filters. */
export const API_TEXT_PATTERN = /^[^\x00-\x1f\x7f-\x9f]*$(?![\s\S])/;

export const API_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
