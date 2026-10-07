# Included Qwen: first reply and recovery

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
