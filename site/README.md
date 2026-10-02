# Agenda data page

One page for Markdown and JSON exports, with an editable prompt for an agent to create a personal agenda. The prompt can use the agent's existing knowledge of your work and goals. If the agent cannot read the complete JSON, it asks the user to download and attach the file before planning.

```bash
npm run preview
```

Open **http://localhost:4173/**. The event banner links to the main event page and stays at 270px on desktop and 240px on mobile.

Plain HTML and CSS; JavaScript copies the JSON link and prompt, and shows the source capture time in the event timezone. Native Node.js serves the local preview. Event artwork © 2026 [Esri](https://www.esri.com/en-us/about/events/euro-devtech/overview); use is subject to [Esri's terms](https://www.esri.com/en-us/legal/terms/web-site-service).

Six role tabs, including AI, illustrate the output with the shared plenary, closing session, and reviewed technical sessions for all three days. Session titles link to the official pages; IDs and non-session activities are omitted. Titles, times, and rooms come from the local JSON. These are examples of a possible answer, not live agent-generated results.

Generation and publication include the page, CSS, JavaScript modules, and WebP banner. Pushing to `main` deploys them through the agenda workflow, which also runs daily.
