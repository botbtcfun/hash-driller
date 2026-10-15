import './copy.css';

/**
 * /copy: hands out the whole game as one data: URL, which the build writes
 * to /data-url.txt (onefile() in vite.config.ts). It is fetched up front, so
 * a tap can copy it at once: phones allow copying only during the tap.
 */
const button = document.getElementById('copy') as HTMLButtonElement;
const note = document.getElementById('note')!;
let url = '';

async function load(): Promise<void> {
  try {
    const res = await fetch('/data-url.txt');
    if (!res.ok) throw new Error(`status ${res.status}`);
    url = (await res.text()).trim();
    button.textContent = 'COPY THE LINK';
    button.disabled = false;
    note.textContent = `${url.length.toLocaleString('en-US')} characters`;
  } catch {
    button.textContent = 'NOT AVAILABLE';
  }
}

/** Copies through the clipboard, or where that's refused, through a selected text field. */
async function copy(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = url;
    field.readOnly = true;
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  }
}

button.addEventListener('click', async () => {
  if (!url) return;
  if (await copy()) {
    button.textContent = 'COPIED!';
    note.textContent = 'Now paste it into the address bar and go.';
  } else {
    button.textContent = 'COPY FAILED';
    note.innerHTML = 'Open <a href="/data-url.txt">the text</a>, select all and copy it instead.';
  }
});

void load();
