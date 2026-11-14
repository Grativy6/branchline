# Practical limits

Branchline 1.2 is a Windows x64 application. Keep backups and inspect results before relying on model work.

- Independent ChatGPT chairs can work concurrently through one connection, subject to provider limits. Qwen and added GGUF models share one owned local runtime slot. Activity identifies waits; a queued task is not active inference.
- The local finder supports complete compatible GGUF language-model files. It does not convert models, download weights or add native tool/image support. Base models use text completion; selected windows default to at most 8,192 tokens. Search and Add do not start inference.
- Subscription allowance is account-wide and shown as percent left; chair token counts describe recorded turns, not a fraction of a subscription. GPU readings are device-wide when available. Missing provider counts or unsupported sensors remain unavailable.
- Goals belong to the current conversation and its chairs. Reasoning notes observe existing work; their 10/30/60-second pings queue behind it and do not keep an idle task running.
- Drawers keep separate chair work and attributed logs. A chair can inspect a peer's recorded log through the desk tools. These records are not the peer's private internal reasoning, and inspection does not transfer its identity.
- Shared artifact writes use revision checks. Conflicting work is retained for review; Stop cannot undo external effects already completed.
- The original transcript stays saved separately from selected model input and context handoff accounts. Context estimates are not exact token counts. A larger selected window is not proof that the runtime loaded it.
- Plans run while Branchline is open and the computer is awake. A Plan occurrence performs one model reply with its bounded tool loop. It can overlap independent desk work, subject to connection slots. There is no OS wake service or arbitrary autonomous cross-computer scheduler.
- Pony Post remains communication between desks. It is separate from simultaneous work at one desk.
- Memory modes and Home selection are explicit settings. A selected Home shelf is bounded source access; it does not grant unrestricted access to a whole drive.
- ChatGPT sign-in uses the person's existing account and allowances. Separate API connections may be billed by their provider. The release carries no account, trial, API key or included cloud credit.
- Image tools, PC tools and external connections retain their existing settings and permission boundaries. Adding a chair does not grant new tools.
- Local Dreams support text training of the included Qwen3.5-4B and its compatible Dream generations through Ubuntu 24.04 / WSL 2 and an NVIDIA GPU. The qualified recipe uses BF16 LoRA, 1,024-token training windows and a bounded pass. Its heaviest measured test on a 12 GB RTX 4070 reached 11,829 MiB of whole-device VRAM and 70°C. Other GPU sizes, native Windows training, Apertus, Dream019 and arbitrary GGUF training are not qualified. A completed Dream produces a candidate; it does not establish better model quality.
- Dream setup downloads its separate Python environment, trainable model checkpoint and pinned converter. It requires WSL/Ubuntu and a compatible GPU driver already installed. Schedules run while the app is open. Whole source notes stay available; long episodes use overlapping training windows. See DREAM-REVIEW.md for controls and recovery.
- Public Book stamping services, the planned Finis Solutus game mode, and unimplemented provider routes remain future work.
- The installer and application are unsigned. Windows prerequisites are Microsoft's separate, signed components. This release has been checked on Dust's Windows 11; it does not establish a fresh Windows 10 or every-GPU qualification.
- Version 1.2 reads earlier records and writes workspace format 8. Keep an older workspace backup for an older app; newer work is a separate recovery consideration.

See the release's VERIFICATION.md and attached installer qualification record for actual checks, rather than inferring them from this feature list.

The ChatGPT picker uses models returned by the connected provider, rather than a fixed Branchline availability list. The runtime may cache that catalog; a listed model is not a guarantee of remaining allowance or success for every request. Picture input still requires a known image capability and its existing clearance.
