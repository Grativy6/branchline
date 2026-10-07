# Image tools and computing resources

Branchline 0.8.3 provides a connection foundation for Invoke on the same
computer. Picture generation is not connected yet. Dream training and image
generation are separate features with different resource needs.

## What you can do

Open **Home → Apps & tools → Image tools**, or **Set up image tools** in a
Coat's pockets. Enter the HTTP address of an Invoke service you already run
locally. **Save connection** records the address without contacting it.
**Check saved connection** reads its reported version and image-model list.
**Disconnect** clears the selection while retaining the change history.

The check cannot install or start Invoke, download or load a model, send a
prompt or image, or enqueue a job. It does not add a model-facing tool or enable
any Coat pocket. The six existing conversation pockets stay as selected.

Only literal loopback addresses and localhost are accepted. This first adapter
does not support remote services, authentication, arbitrary API paths or
redirects. A failed check gives an error without changing the saved address.
Closing the setup panel cancels its pending check.

The displayed result is an observation of what the service reported at the
check time. It is not a compatibility certificate or a measurement of available
computing power. A page reload requires a fresh check before showing a result.

## Resources

Image generation can use substantial graphics memory. Model choice, picture
size and batch size affect its needs, and a resident chat model may compete for
the same hardware. Start with the selected image model's requirements; a large
graphics card is not a universal prerequisite or a guarantee that every job fits.

Dream training also needs memory, storage and time. Being able to chat with a
model does not establish that the same computer can train it. Before training,
review the base model, recipe, location of the work, and resource or spending
limits. In-app Dream training remains unavailable in this preview.

## Connection contract and verification

The adapter reads `GET /api/v1/app/version` and then
`GET /api/v2/models/?model_type=main`. Reads time out after eight seconds and
have bounded response sizes. Only a reported version and image-model keys,
names and families are retained in the observation. Paths and free-form
provider instructions do not become app instructions or permissions.

Source and browser checks use a synthetic local service. They cover connection
history, restart, stale checks, concurrent checks, cancellation, redirects,
authentication failures, oversized or malformed data, escaped labels, and
desktop and narrow-window layouts. They do not establish compatibility with a
particular installed Invoke version or generation performance.

The next integration step is a bounded generation path: select a model and
workflow, review the actual job and resources, submit it through the effect
boundary, show progress and cancellation, and return a checked image with its
origin recorded. A saved connection alone does not authorize that work.

API references reviewed October 3, 2026:

- [Invoke application information API](https://github.com/invoke-ai/InvokeAI/blob/main/invokeai/app/api/routers/app_info.py)
- [Invoke model manager API](https://github.com/invoke-ai/InvokeAI/blob/main/invokeai/app/api/routers/model_manager.py)
- [Invoke workflow API guide](https://invoke.ai/development/guides/workflow-api/)
- [Invoke system requirements](https://invoke.ai/start-here/system-requirements/)
