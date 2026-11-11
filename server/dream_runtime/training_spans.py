"""Assistant spans in the exact final Qwen render, using the tokenizer's tracker."""
import hashlib
import json

MASK_PROFILE = 'qwen35-final-render/2'
TEMPLATE_SHA256 = 'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715'


def training_template(tokenizer):
    original = tokenizer.get_chat_template()
    if hashlib.sha256(original.encode()).hexdigest() != TEMPLATE_SHA256:
        raise ValueError('The training chat template changed. This Dream needs a matching Qwen training recipe.')
    start = original.index('{%- elif message.role == "assistant" %}')
    end = original.index('{%- elif message.role == "tool" %}', start)
    block = original[start:end]
    split = block.index('{%- if loop.index0 > ns.last_query_index %}')
    preparation, body = block[:split], block[split:]
    body = body.replace("'<|im_start|>' + message.role + '\\n<think>\\n'", "'<think>\\n'")
    body = body.replace("'<|im_start|>' + message.role + '\\n' + content", 'content')
    # Generation tags record character positions without adding bytes. Keep the
    # role header outside; retain the assistant's normal end marker inside.
    marked = preparation + "{{- '<|im_start|>' + message.role + '\\n' }}" \
        + '{%- if loop.index0 in branchline_targets %}{%- generation %}' + body \
        + '{%- endgeneration %}{%- else %}' + body + '{%- endif %}'
    return original, original[:start] + marked + original[end:]


def token_targets(tokenizer, messages, targets):
    original, marked = training_template(tokenizer)
    options = dict(add_generation_prompt=False, enable_thinking=False)
    plain = tokenizer.apply_chat_template(messages, chat_template=original, tokenize=False, **options)
    tracked = tokenizer.apply_chat_template(messages, chat_template=marked, branchline_targets=targets, tokenize=False, **options)
    if plain != tracked:
        raise ValueError('Training span annotations changed the conversation rendering.')
    result = tokenizer.apply_chat_template(messages, chat_template=marked, branchline_targets=targets,
        tokenize=True, return_dict=True, return_assistant_tokens_mask=True, **options)
    ids, mask = result['input_ids'], result.get('assistant_masks')
    if not isinstance(ids, list) or not isinstance(mask, list) or len(ids) != len(mask):
        raise ValueError('The tokenizer did not return assistant positions for this training recipe.')
    return ids, [token if selected else -100 for token, selected in zip(ids, mask)]


def tokenizer_identity(tokenizer):
    return {'maskProfile': MASK_PROFILE, 'templateSha256': hashlib.sha256(tokenizer.get_chat_template().encode()).hexdigest(),
        'vocabularySha256': hashlib.sha256(json.dumps(tokenizer.get_vocab(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()}


def compatible_checkpoint(directory, fingerprint):
    found, incompatible = [], []
    if directory.exists():
        for folder in directory.glob('checkpoint-*'):
            marker = folder / 'branchline-ready.json'
            if not marker.exists():
                incompatible.append(folder.name)
                continue
            try:
                value = json.loads(marker.read_text())
                if value.get('inputHash') == fingerprint and value.get('maskProfile') == MASK_PROFILE:
                    found.append((int(value['step']), str(folder)))
                else:
                    incompatible.append(folder.name)
            except (OSError, ValueError, KeyError):
                incompatible.append(folder.name)
    if found:
        return max(found)[1]
    if incompatible:
        raise ValueError('The saved checkpoint does not match this batch and training recipe. It has been kept. Stop this Dream and start a new corrected Dream; Resume did not restart at step zero.')
    return None
