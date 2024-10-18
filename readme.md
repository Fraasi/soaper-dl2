# upmovies-dl

Search & download from upmovies on the command line

## installation

Grab the file `upmovies-dl` form dist/ folder & put it in your `path` and you're all set.
Alternatively you can clone this repo, do `npm install` & `npm run tsup` to build the final file yourself.

## Usage

This is not really a cli. Just put some words to search after the command and see what comes up. Choose with the arrow keys and press enter to select and download. If it is a series you can then choose which episodes to download using `sed`s syntax.
```bash
upmovies-dl <search term>
```

## Dependencies

[nodejs](https://nodejs.org/)

some bash tools you probably already have
  * [sed](https://www.gnu.org/software/sed/)
  * [cut](https://www.gnu.org/software/coreutils/)
  * [xargs](https://www.gnu.org/software/findutils/)

and some you maybe don't have
  * [fzf](https://github.com/junegunn/fzf) for selecting from list
  * [yt-dlp](https://github.com/yt-dlp/yt-dlp) for downloading
