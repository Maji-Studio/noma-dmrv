export const MODEL_PROFILES = {
  full: {
    codex: { model: "gpt-6-astra", effort: "medium" },
    opus: { model: "opus", effort: "high" },
  },
  light: {
    codex: { model: "gpt-6.1-sol", effort: "high" },
    opus: { model: "opus", effort: "medium" },
  },
};

export function modelSettings(model, profile = "full") {
  return MODEL_PROFILES[profile][model];
}

export function profileModels(profile = "full", models = Object.keys(MODEL_PROFILES[profile])) {
  return Object.fromEntries(
    models.map((model) => [model, MODEL_PROFILES[profile][model].model]),
  );
}

export function displayModel(model, profile = "full") {
  const settings = modelSettings(model, profile);
  return model === "codex"
    ? `Codex (${settings.model}, ${settings.effort})`
    : `Claude Opus (${settings.effort})`;
}

export function modelLabel(model, profile = "full") {
  return model === "codex" ? `Codex ${modelSettings(model, profile).model}` : "Claude Opus";
}
