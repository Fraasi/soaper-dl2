#!/usr/bin/env node

import os from 'node:os'
import { mkdir } from 'node:fs/promises';
import url from 'node:url'
import path from 'node:path'
import { spawnSync, SpawnSyncReturns } from 'node:child_process'
import * as cheerio from 'cheerio'
type Cheerio = ReturnType<typeof cheerio.load>;

const FILE_NAME = path.basename(url.fileURLToPath(import.meta.url))
const SEARCH_TERM = process.argv.slice(2).join(' ')
const BASE_URI = 'https://soaper.tv'
const SOAPER_DOWNLOAD_PATH = process.env.SOAPER_DOWNLOAD_PATH || os.homedir()
const SOAPER_SUB_LANG = process.env.SOAPER_SUB_LANG || 'en'
const CURRENT_YEAR = new Date().getFullYear()

if (SEARCH_TERM === '-h' || SEARCH_TERM === '--help') {
  console.info(`Usage: ${FILE_NAME} <SEARCH TERM>
  (if no search term, fetch  new releases)`)
  process.exit(0)
}

if (!SEARCH_TERM) {
  const $ = await fetch(`https://soaper.tv/movielist/year/${CURRENT_YEAR}/sort/release`)
    .then(res => res.text())
    .then(html => cheerio.load(html))

  const newReleaseList: string[] = []
  const movs = $('div.thumbnail.text-center')
  movs.each((_i, el) => {
    const year = $(el).find('.img-tip.label.label-info').text()
    const title = $(el).find('h5').text().replaceAll(' ', '_')
    const href =  $(el).find('h5 > a').attr('href') as string
    newReleaseList.push(`[${year}] ${title} ${BASE_URI + href}`)
  })

  const chosenLink: string = await fuzzyChoose(newReleaseList, 'New releases')
  startDownload(chosenLink)
}

async function fuzzyChoose(choices: Array<string>, header: string): Promise<string> {
  const chosenLink = spawnSync(`echo "${choices.join('\n')}" | fzf --header-first --header="${header}" --cycle --with-nth 1,2,3`, {
    // stdout has to be pipe here to return results, defaults are pipe
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })
  // exit code of the subprocess, or null if the subprocess terminated due to a signal
  // exit early here if user cancels fzf, 130 on ctrl-c and ESC
  if (chosenLink.status === null || chosenLink.status === 130) {
    console.info('[soaper-dl] Canceled')
    process.exit(0)
  }
  return chosenLink.stdout.replace(/\n$/, '')
}

async function search(): Promise<string> {
  const searchUrl = `${BASE_URI}/search.html?keyword=`

  const $: Cheerio = await fetch(searchUrl + SEARCH_TERM)
    .then(res => res.text())
    .then(html => cheerio.load(html))

  const searchResults = $('div.thumbnail.text-center')
  if (searchResults.length === 0) {
    console.info('[soaper-dl] Nothing found, try another search term')
    process.exit(0)
  }

  const parsedLines: string[] = []
  searchResults.each((_i, el) => {
    const year = $(el).find('.img-group > div').text()
    const title = $(el).find('h5').text().replaceAll(' ', '_')
    const href =  $(el).find('h5 > a').attr('href') as string
    parsedLines.push(`[${year}] ${title} ${BASE_URI + href}`)
  })

  const chosenLink: string = await fuzzyChoose(parsedLines, `Search results for '${SEARCH_TERM}'` )
  return chosenLink
}

type DlLinks = {
  m3u8Link: string;
  subLink: string | null;
}

async function getDlLinks(pageLink: string, ajaxType: string): Promise<DlLinks> {
  const pass: string = pageLink.match(/_(?<pass>.*)\.html/)?.groups?.pass ?? ''
  if (!pass) throw '[soaper-dl-error] Couldn\'t get passkey'

  const result = await fetch(`${BASE_URI}/home/index/${ajaxType}`, {
    "headers": {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": `${BASE_URI}${pageLink}`
    },
    "body": `pass=${pass}`,
    "method": "POST"
  }).then(r => r.json())

  type Links = {
    subs: Array<{name: string; path: string}> | null;
    val: string;
  }

  const {subs, val: m3u8Link }: Links = result as Links
  if (m3u8Link === 'Cannot get video source.') throw '[soaper-dl-error] Cannot get video source.'
  const subPath: {path: string, name: string } | undefined = subs?.find(sub => sub.name.includes(SOAPER_SUB_LANG))

  return {
    m3u8Link,
    subLink: subPath?.path ? subPath.path : null
  }
}

async function runShell(command: string, std: 'pipe' | 'inherit' = 'inherit'): Promise<SpawnSyncReturns<string>> {
  return spawnSync(command, {
    // stdout has to be pipe on some streams
    stdio: ['inherit', std, 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })
}

function sanitizeName(name: string): string {
  // illegal chars: / ? < > \ : * | " causes problems when in filename, also remove []'()
  return name.replace(/[/\\*?<:>|'[\]()]/g, '')
}

function zeroPad(n: string): string { return Number(n) < 10 ? '0' + n : n }

async function startDownload(chosenLink: string): Promise<void> {

  const [year, name, pageLink] = chosenLink.split(' ')
  const isSeries = chosenLink.includes('/tv_')
  const ajaxType = isSeries ? 'GetEInfoAjax' : 'GetMInfoAjax'

  if (!isSeries) {
    const { m3u8Link, subLink }: DlLinks = await getDlLinks(pageLink, ajaxType)
    const fileName = sanitizeName(`${name}_${year}`)
    if (subLink) {
      console.info(`[soaper-dl] Downloading subtitles ${fileName}`)
      runShell(`curl ${BASE_URI + subLink} --output-dir '${SOAPER_DOWNLOAD_PATH}' -o ${fileName}.${SOAPER_SUB_LANG}.srt`)
    }

    console.info(`[soaper-dl] Downloading ${SOAPER_DOWNLOAD_PATH}/${fileName}`)
    runShell(`yt-dlp '${BASE_URI + m3u8Link}' -P ${SOAPER_DOWNLOAD_PATH} -o ${fileName}.mp4`)
  }
  else if (isSeries) {
    // save series name for filename here
    const seriesName = name.split('_').slice(0, -1).join('_') || ''
    const seriesFolder = `${SOAPER_DOWNLOAD_PATH}/${seriesName}`
    // get list of eps and links
    const $: Cheerio = await fetch(pageLink)
      .then(res => res.text())
      .then(html => cheerio.load(html))

    const fzfEpList: string[] = []
    const seasons = $('.alert-info-ex')
    for (const season of seasons) {
      const seasonText = $(season).find('h4').text()
      const seasonNum = (/Season(\d){1,2}/.exec(seasonText)?.[1] || 'N/A') as string

      const episodes = $(season).find('div > a')
      for (const ep of episodes) {
        const [epNum, epName] = $(ep).text().replaceAll(' ', '_').split('.') as string[]
        fzfEpList.push(`[S${zeroPad(seasonNum) }E${zeroPad(epNum)}] ${epName} ${BASE_URI + $(ep).attr('href')}`)
      }
    }

    const chosenEpisodes = await fuzzyChoose(fzfEpList, 'Choose episodes with <TAB>')

    // sort selected eps to dl oldest first
    const sortedEpisodes = chosenEpisodes.split('\n').sort()
    const commands: string[] = []

    for (const ep of sortedEpisodes  ) {
      if (!ep) continue

      const [epNum, epName, epPageLink] = ep.split(' ')
      const fileName = sanitizeName(`${seriesName}_${epNum}_${epName}`)
      const { m3u8Link, subLink }: DlLinks = await getDlLinks(epPageLink, ajaxType)
      if (subLink) {
        const commandCurl = `curl '${BASE_URI + subLink}' --output-dir '${seriesFolder}' -o ${fileName}.en.srt`
        commands.push(commandCurl)
      }
      const commandYTDLP = `yt-dlp --quiet '${BASE_URI + m3u8Link}' -P ${seriesFolder} -o ${fileName}.mp4`
      commands.push(commandYTDLP)
    }

    // make folder for episodes
    try {
      // Calling fsPromises.mkdir() when path is a directory that exists results in a rejection only when recursive is false.
      // returns undefined if dir already exists, path otherwise
      const createDir = await mkdir(seriesFolder, { recursive: true })
      if (createDir) console.info(`[soaper-dl] Creating folder for series: ${SOAPER_DOWNLOAD_PATH}/${seriesName}`)
    } catch (err) {
      console.error('[soaper-dl-error] Could not make a folder for series')
      // @ts-ignore
      console.error(err.message)
    }

    // needs this extra loop for sequential dls to work, also doesn't work in runShell for some reason
    for (const command of commands){
      console.info(`[soaper-dl] Downloading ${command.split(' ').at(-1)}`)
      spawnSync(command, {
        // stdout has to be inherit here
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        encoding: 'utf-8'
      })
    }
  }
}

async function main() {
  const chosenLink: string = await search().catch(err => {
    console.error('[soaper-dl-error] Search fetch failed')
    console.error(err)
    process.exit(1)
  })
  if (!chosenLink) process.exit(1)
  await startDownload(chosenLink)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

