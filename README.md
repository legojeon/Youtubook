<div align="center">

<img src="public/icons/icon128.png" width="104" height="104" alt="Youtubook">

# Youtubook

**Read a YouTube video instead of watching it.**<br>
Youtubook turns any video into an illustrated page — each scene's screenshot paired with its transcript — right in your browser.

<img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-4285F4">
<img alt="Chrome 111+" src="https://img.shields.io/badge/Chrome-111%2B-4285F4">
<img alt="100% in-browser" src="https://img.shields.io/badge/100%25-in--browser-2ea44f">

**English** · [한국어](README.ko.md)

</div>

<table>
  <tr>
    <td width="47%"><img src="assets/youtube-view.png" alt="A YouTube video playing"></td>
    <td width="6%" align="center"><h3>➡️</h3></td>
    <td width="47%"><img src="assets/html-view.png" alt="The generated page: each scene's image beside its narration"></td>
  </tr>
  <tr>
    <td align="center"><b>Any YouTube video</b></td>
    <td></td>
    <td align="center"><b>An illustrated page you can read</b></td>
  </tr>
</table>

Youtubook detects the distinct scenes in a video and pairs each with the transcript from its captions, laying them out as a scrollable illustrated page. **Skim a 30-minute talk in a couple of minutes** instead of watching it — or **turn a story video into a picture book** a parent or teacher can read aloud. Export it as a self-contained HTML page, a PDF or PPTX, or a plain-text script.

Everything runs **100% in your browser** — no AI, no server, no video downloads. It uses only the captions YouTube already exposes, and never downloads video streams, blocks ads, or re-hosts content.

## Features

- **Automatic scene detection** — HSV color-difference with an adaptive, PySceneDetect-style threshold; a sensitivity slider re-detects instantly.
- **Narration from captions** — pulls the script from YouTube captions (manual first, auto-generated as a fallback) and aligns it to each scene.
- **View as book** — open the finished page in a new browser tab and read it straight away, no download needed. Each scene links back to that exact moment in the video.
- **Multiple export formats** — or save it as a file: a self-contained, responsive **HTML page** that reads well on any screen from phone to desktop (each scene's screenshot beside its transcript), PDF (one scene per page), PPTX (script in the speaker notes), or TXT (script only).
- **Runs in the background** — switch to other tabs while it works; a notification tells you when it's done.
- **Bilingual UI** — English and Korean, following your browser language.

## How it works

1. Open a YouTube video, click the Youtubook icon → **Create picture book**.
2. Youtubook scans the video, detects scene cuts, and captures one frame per scene.
3. On the results page, pick the scenes you want — the sensitivity slider re-detects, and each card shows its narration.

<p align="center">
  <img src="assets/pick-scene.png" width="85%" alt="Youtubook results page: a grid of detected scenes with narration, a sensitivity slider, and export options">
</p>

4. **Next** → **Choose a format**: **View as book** to open it in a new tab, or download as HTML / PDF / PPTX / TXT.

The script follows your selected scenes: each chosen scene carries all narration up to the next selected scene, so picking only some scenes never drops any of the story.

## Install

**From a release**

1. Download `youtubook-v<version>.zip` from the [Releases](../../releases) page and unzip it.
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder (the one containing `manifest.json`).

**Build it yourself**

1. `npm install && npm run build` → produces `dist/`.
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/`.

Requires Chrome 111+.

## Usage

- Extraction runs on the video's tab, but you can **switch to other tabs** while it works — you'll get a notification when the page is ready. Just don't close the tab or navigate it to another video.
- Roughly 1–3 minutes for a 10-minute video, depending on your connection.
- On the results page, use the sensitivity slider to split scenes more or less finely, then re-detect.

## Development

```bash
npm install
npm run build   # type-check + build to dist/
npm test        # unit tests (Vitest)
npm run zip     # build + zip for release / the Chrome Web Store
```

Stack: TypeScript · Vite + @crxjs/vite-plugin · jsPDF · PptxGenJS

## Privacy

Youtubook processes everything locally in your browser — video frames, captions, and generated files never leave your machine. See [PRIVACY.md](PRIVACY.md).

## Limitations

- Videos without captions produce scene images only (no script / TXT).
- Live streams, premieres, and DRM-protected videos aren't supported.
- YouTube page changes can affect some features (e.g. caption extraction).
