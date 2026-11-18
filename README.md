# GapFinder AI

GapFinder AI is a browser-based study-gap finder. It maps syllabus topics, creates source-grounded diagnostic questions, explains answers against the original material, tracks topic-level mastery, and turns weak spots into a time-bounded revision plan.

## Judge demo

- **Email:** `demo@gapfinder.ai`
- **Password:** `gapfinder2026`

The demo opens with sample biology materials and a clearly labeled sample baseline. Take a new diagnostic to replace those example scores with your own answers.

## Run locally

Open `index.html` in a modern browser. No build step, package installation, API key, or server is required. PDF text extraction loads PDF.js from cdnjs when a PDF is selected; plain-text uploads and the rest of the app work without that dependency.

## The grounded AI pipeline

1. **Material ingestion:** PDF or text is read in the browser and stored in that browser's local storage. PDF.js extracts selectable text page by page; scanned/image-only PDFs are not supported.
2. **Retrieval:** A lightweight keyword-ranking pass finds passages matching a syllabus topic. Notes and past-paper text are ranked ahead of the syllabus outline. Source filename and section/page travel with each passage.
3. **Generation:** The diagnostic generator selects a retrieved sentence and blanks a relevant topic term (or another source term when the topic name is absent). Prompts therefore come from uploaded text, not model memory.
4. **Evaluation:** Answers are matched against the omitted term. The app shows the source sentence and citation whether the response is correct or not.
5. **Diagnosis and plan:** Latest quiz scores set topic status (weak below 50%, medium 50–79%, strong 80% and above). The plan prioritizes low-scoring and past-paper topics and reallocates when answers change.
6. **Topic helper:** The explain-this-topic page displays only retrieved passages and their citations. If no passage matches, it says so rather than making up an answer.

This is an explainable, on-device retrieval and extractive generation prototype, not a hosted LLM integration. Study content is not sent to an AI provider. The demo does not perform semantic-embedding search, OCR, teacher/class analytics, or cross-device account sync.

## Data and privacy

The demo login is a client-side entry gate, not production authentication. Workspace content and progress are stored in browser `localStorage` and are not uploaded to a server. Use the remove button on a material to delete it from the workspace; clearing this site's browser storage also clears saved data.

## Deploy

The included GitHub Actions workflow enables and publishes the static site to GitHub Pages on pushes to `main`. If repository policy blocks automatic Pages enablement, enable GitHub Pages with **GitHub Actions** as the build and deployment source in repository settings, then rerun the workflow. The expected URL for this repository is:

`https://pendemsravan123.github.io/AI-assignment1/`

The site will be live after the deployment workflow completes successfully.
