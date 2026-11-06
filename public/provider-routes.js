// Provider routing is separate from chair identity and source permissions.
export const isCloudModel = model => ['codex','openai'].includes(model?.runtime);
// Automatic helpers do not silently cross between subscription and API billing.
export const mayFollowProvider = (candidate, origin) => !isCloudModel(candidate) || candidate.runtime === origin?.runtime;

export const connectionLabel=model=>model?.runtime==='codex'?'ChatGPT plan usage':model?.runtime==='openai'?'OpenAI API · separate credits':'Local model · no cloud inference billing';
