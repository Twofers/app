# Penguin Falls LLC Static Site

Plain HTML and CSS static site for Vercel hosting. There is no framework, build step, package manager, or server code.

## Preview Locally

Open `index.html` in a browser, or run a simple static server from this folder:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Deploy

Use the Vercel flow from Section 12 of `../penguinfalls-build-plan.md`: put this folder in a GitHub repo, import it into Vercel as "Other" or "No framework", leave the build command empty, keep the output directory as the root, deploy, then point `penguinfalls.com` and `www.penguinfalls.com` to the Vercel project.
