# soaper-dl

Search & download from soaper on the command line

> Inspired by [soaper-dl](https://github.com/KevCui/soaper-dl).

## installation

Grab the file `soaper-dl` form dist/ folder, make it executable `chmod +x soaper-dl` & put it in your `path` and you're all set.
Alternatively you can clone this repo, do `npm install` & `npm run tsup` to build the final file yourself.

## Usage

Just put some words to search after the command and see what comes up. Narrow down with the fuzzy search, choose with the arrow keys and press enter to start the download. If it is a series you can then choose which episodes to download with `TAB` key and `SHIFT+TAB`. If the video has english subtitles, it will be downloaded automatically next to video.  
There's two enviroment variables you can use to control the program
```
SOAPER_DOWNLOAD_PATH # defaults to node's os.homedir() which usually is `~`
SOAPER_SUB_LANG # default 'en'
```

```bash
soaper-dl --help

Usage: soaper-dl <SEARCH TERM>
  - if no <SEARCH TERM>, fetch new releases list
```

## Dependencies

[nodejs](https://nodejs.org/)

some bash tools you probably already have
  * [curl](https://github.com/curl/curl) for downloading subtitles

and some you maybe don't have
  * [fzf](https://github.com/junegunn/fzf) for displaying search results & selecting from it
  * [yt-dlp](https://github.com/yt-dlp/yt-dlp) for downloading videos
