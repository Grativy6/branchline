# Local models

## Find and add a saved model

Open **Settings → Models → Your locally saved models**. **Search Local** searches familiar or remembered folders; **Choose a folder** uses the Windows folder picker. Highlight a result to see its name, size, location, model information and input format. **Add Model** saves that selection to your library. Searching and adding do not run inference or copy the model weights.

**Search Online** opens the Hugging Face model catalog in your browser. Downloading stays with that site/browser; Branchline does not download a model automatically.

Choose an added model for a chair using the ordinary model selector. It loads when you send a message. The owned runtime uses one local slot shared with included Qwen. Activity shows when another local task is waiting. **Remove** archives the library entry while retaining its file and recorded conversations. Finding and adding it again restores the saved connection.

The first file route handles standalone GGUF language models supported by the bundled runtime. Supporting projectors, embedding models and split files are identified separately. Files without an embedded chat template use text completion and have no native app-tool interface. Runtime errors remain visible; discovery alone does not establish that a model can load.

Added local-file models use this built-in instruction, supplied by Chris:

> You are a local AI model running in Branchline. You will work collaboratively at a metaphorical desk.

User-selected Coats, guidance, sources and conversation history still apply when present. Internal chair bookkeeping is retained in host records rather than being repeated as the model's basic instruction. The initial file window is up to 8,192 tokens, bounded by declared metadata; selected and actually loaded windows are displayed separately.

Models remain where you selected them. A changed or missing file is reported; adding the same verified weights from their new location can reconnect the existing identity. No sign-in is needed for these local replies.

## Included Qwen: first reply and recovery

The full installer includes stock Qwen3.5-4B Q4_K_M plus its picture projector. The app-only ZIP does not. Qwen loads on the first message, not while Branchline is opening. A loading line explains the file check and chosen backend; Stop cancels it. Verified files are reused for that app session.

The files occupy roughly 3.4 GB before application runtimes and setup recovery space. Setup checks disk space before replacing files. Start with a 16 GB RAM computer and several GB free memory; the app refuses a load with under 4 GiB free. This is an initial sizing recommendation, not a universal minimum or performance guarantee. The preview uses an 8,192-token window with room reserved for replies; it does not advertise the model's much larger theoretical window.

Automatic mode tries Vulkan graphics acceleration, then the included CPU runtime. A compatible graphics driver is needed for Vulkan. **Settings → Models → Included Qwen** lets you unload Qwen or select CPU / automatic mode for the current app session. CPU mode works without Vulkan but may be much slower. Only Branchline's own Qwen process is unloaded when you switch to another local model; it does not unload models owned by LM Studio.

On the development PC (Ryzen 5 2600, 32 GiB RAM, RTX 3060 12 GiB), one synthetic Branchline conversation measured about 7.5 seconds to the first text on the first GPU turn and 0.34 seconds on a warm follow-up. A picture turn took about 12.4 seconds. A CPU follow-up with substantial previous context took about 68 seconds before text and about 9.8 generated tokens/second. These are individual samples with warm filesystem caches, not speed promises or clean-boot benchmarks. Different hardware, prompts, context and open applications will change results.

## If a reply cannot start

- **Damaged or missing included files:** rerun full Setup in the same install location to repair. It checks unchanged model files and avoids copying them again. Existing workspace choices remain unchanged.
- **Graphics failure or memory pressure:** stop the reply, unload Qwen, close another large app or select CPU mode, then resend. A load that cannot finish in the bounded startup window returns an error rather than looping forever.
- **Stopped runtime:** send again to start a new owned process. Restart Branchline if needed. The native Windows host closes its backend and model processes when it exits.
- **App-only installation:** run full Setup to add the included model. In an existing workspace use the explicit Add to my models control, then choose a chair.

Pictures use the existing attachment preview, metadata removal and destination review. Qwen receives the viewing copy; an image never grants tools or permissions. Available conversation tools use the same reviewed route and recorded results as other compatible models. Turn them on when needed. A model may still invent a tool-use claim: the receipt is the evidence.

Uninstall removes installed app/model files, not conversations, external models or shared Microsoft prerequisites. Back up your workspace through Branchline before changing versions. This preview remains an early-test package; a clean Windows 11 machine with prerequisites missing has not yet been qualified by the development-host checks.

Older 0.8.0 does not recognize the new included-model connection type. Existing legacy workspaces can be upgraded without changing their models; once you add Qwen, use 0.8.1 or restore a pre-upgrade backup for an older version. Do not try to repair that compatibility mismatch by deleting your workspace.
