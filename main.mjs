import { renderExamples } from './examples.mjs';

// Clipboard copying and the source capture time; the agent does the personal scheduling.
const endpoint = 'https://saschabrunnerch.github.io/esri-devsummit-europe-2026-agenda/agenda.json';
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Try selection-based copying when clipboard permission is unavailable.
  }
  const previousFocus = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (!document.execCommand('copy')) throw new Error('Copy unavailable');
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

for (const button of document.querySelectorAll('[data-copy]')) {
  const originalLabel = button.textContent;
  let reset;
  button.addEventListener('click', async () => {
    const text = button.dataset.copy === 'json' ? endpoint : document.querySelector('#prompt-text').value;
    const status = document.querySelector('#copy-status');
    try {
      await copyText(text);
      button.textContent = 'Copied!';
      status.textContent = button.dataset.copy === 'json' ? 'JSON link copied. Share it with your agent.' : 'Prompt copied. Paste it into your agent.';
      clearTimeout(reset);
      reset = setTimeout(() => { button.textContent = originalLabel; }, 2000);
    } catch {
      clearTimeout(reset);
      button.textContent = originalLabel;
      const prompt = document.querySelector('#prompt-text');
      prompt.focus();
      if (button.dataset.copy === 'json') {
        const start = prompt.value.indexOf(endpoint);
        if (start !== -1) prompt.setSelectionRange(start, start + endpoint.length);
        status.textContent = start !== -1 ? 'Copy the selected JSON link manually.' : 'Copy failed. Use Download to save the JSON file.';
      } else {
        prompt.select();
        status.textContent = 'Copy the selected prompt manually.';
      }
    }
  });
}

const lastUpdate = document.querySelector('#last-update');
try {
  const response = await fetch('agenda.json');
  if (!response.ok) throw new Error('Agenda unavailable');
  const agenda = await response.json();
  const { source, event } = agenda;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: event.timezone, year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(source.scrapedAt)).map(part => [part.type, part.value]));
  lastUpdate.dateTime = source.scrapedAt;
  lastUpdate.textContent = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${event.timezone})`;
  renderExamples(agenda);
} catch {
  lastUpdate.textContent = 'Unavailable';
  document.querySelector('#example-output').textContent = 'Examples unavailable. The agenda files and prompt can still be used.';
}
