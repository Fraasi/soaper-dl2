# soaper-dl2

Search & download videos from [soaper](https://soaper.tv/) on the command line

> Inspired by [soaper-dl](https://github.com/KevCui/soaper-dl),
> but written in typescript with a search functionality and a little different TUI.

## install

Grab the file `soaper-dl` form dist/ folder, make it executable `chmod +x soaper-dl` & put it in your `path` and you're all set.
Alternatively you can clone this repo, do `npm install` & `npm run tsup` to build the final file yourself.

## Usage

Just put some words to search after the command and see what comes up. Narrow down the list with the fuzzy search, choose with the arrow keys and press enter to start the download. If it is a series you can then choose which episodes to download with `TAB` key and `SHIFT+TAB`. If the video has subtitles, it will be downloaded automatically next to video.

There are two enviroment variables you can use to control the program.
```bash
SOAPER_DOWNLOAD_PATH=/e/videos
# where the videos are downloaded
# defaults to node's os.homedir() which usually is `~`

SOAPER_SUBTITLE_LANG=fr
# default: en
```

```bash
$ soaper-dl --help

Usage: soaper-dl [-h|--help] <SEARCH TERM>

Options:
  -h, --help  Show this help

Other:
  fetches new releases list if no <SEARCH TERM>

Version: v1.0.0
```

## Dependencies

[nodejs](https://nodejs.org/)

* [curl](https://github.com/curl/curl) for downloading subtitles
* [fzf](https://github.com/junegunn/fzf) for displaying search results & selecting from it
* [yt-dlp](https://github.com/yt-dlp/yt-dlp) for downloading videos
