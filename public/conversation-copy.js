// Supply a fragment, not the surrounding page, to rich-text clipboard readers.
export function installConversationCopy(container) {
  document.addEventListener('copy', event => {
    const selection = window.getSelection();
    if (!event.clipboardData || !selection || selection.isCollapsed || !selection.rangeCount
      || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;
    const fragment = document.createElement('div');
    for (let i = 0; i < selection.rangeCount; i++) fragment.append(selection.getRangeAt(i).cloneContents());
    // Hidden controls and closed details are not part of the visible selection.
    fragment.querySelectorAll('[hidden],.sr-only,script,style').forEach(node => node.remove());
    fragment.querySelectorAll('details:not([open])').forEach(details => {
      for (const child of [...details.children]) if (child.tagName !== 'SUMMARY') child.remove();
    });
    event.clipboardData.setData('text/plain', selection.toString());
    event.clipboardData.setData('text/html', fragment.innerHTML);
    event.preventDefault();
  });
}
