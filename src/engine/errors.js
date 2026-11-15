// Errors the engine reports with a code and values, so the page can show them in the reader's
// language (src/i18n, errors.engine). The English message stays for tools and tests.
// Codes that a player can only reach through a bug in the page use "internal", with the English
// detail.
export class EngineError extends Error {
  constructor(code, values, message) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.values = values ?? {};
  }
}

export const internalError = (message) => new EngineError("internal", { detail: message }, message);
