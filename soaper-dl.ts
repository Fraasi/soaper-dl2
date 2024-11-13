#!/usr/bin/env node

import * as cheerio from 'cheerio'
import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import packageJson from './package.json'

type Cheerio = ReturnType<typeof cheerio.load>;

const SOAPER_DOWNLOAD_PATH = process.env.SOAPER_DOWNLOAD_PATH || os.homedir()
const SOAPER_SUBTITLE_LANG = process.env.SOAPER_SUBTITLE_LANG || 'en'
const SCRIPT_NAME =          path.basename(url.fileURLToPath(import.meta.url))
const SEARCH_TERM =          process.argv.slice(2).join(' ')
const BASE_URI =             'https://soaper.live'
const CURRENT_YEAR =         new Date().getFullYear()
const VERSION =              packageJson.version

if (SEARCH_TERM === '-h' || SEARCH_TERM === '--help') {
  console.info(`Usage: ${SCRIPT_NAME} TERM> [-h|--help] <SEARCH TERM>

Options:
  -h, --help  Show this help

Other:
  fetches new releases list if no <SEARCH TERM>

Version: v${VERSION}`)
  process.exit(0)
}

async function fetchReleases(): Promise<void> {
  const $ = await fetch(`${BASE_URI}/movielist/year/${CURRENT_YEAR}/sort/release`)
    .then(res => res.text())
    .then(html => cheerio.load(html))

  const newReleaseList: string[] = []
  const movs = $('div.thumbnail.text-center')
  movs.each((_i, el) => {
    const year = $(el).find('.img-tip.label.label-info').text()
    const date = $(el).find('.img-right-bottom-tip').text()
    const title = $(el).find('h5').text().replaceAll(' ', '_')
    const href =  $(el).find('h5 > a').attr('href') as string
    newReleaseList.push(`[${year}-${date}] ${title} ${BASE_URI + href}`)
  })
  // sort by date only & newest first
  const sortedList = newReleaseList.sort((a, b) => (a.split(' ')[0] < b.split(' ')[0]) ? -1 : 1).reverse()

  const chosenLink: string = await fuzzyChoose(sortedList, 'New releases')
  // handle releases [2024-08-18] syntax, remove month & day
  const parsedLink = chosenLink.replace(/-\d{2}-\d{2}(] )/, '$1')
  startDownload(parsedLink)
}

async function fuzzyChoose(choices: Array<string>, header: string): Promise<string> {
  const fzfCommand = `echo "${choices.join('\n')}" | fzf --header-first --header="${header}" --cycle --with-nth 1,2`
  const chosenLink = spawnSync(fzfCommand, {
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

async function search(searchTerm: string): Promise<string> {
  const searchUrl = `${BASE_URI}/search.html?keyword=`
  const $: Cheerio = await fetch(searchUrl + searchTerm)
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
  const subPath: {path: string, name: string } | undefined = subs?.find(sub => sub.name.includes(SOAPER_SUBTITLE_LANG))

  return {
    m3u8Link,
    subLink: subPath?.path ? subPath.path : null
  }
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
      console.info(`[soaper-dl] Downloading ${SOAPER_DOWNLOAD_PATH}/${fileName}.${SOAPER_SUBTITLE_LANG}.srt`)
      const curlCommand = `curl ${BASE_URI + subLink} --output-dir '${SOAPER_DOWNLOAD_PATH}' -o ${fileName}.${SOAPER_SUBTITLE_LANG}.srt`
      spawnSync(curlCommand, {
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        encoding: 'utf-8'
      })
    }
    console.info(`[soaper-dl] Downloading ${SOAPER_DOWNLOAD_PATH}/${fileName}.mp4`)
    const ytdlpCommand = `yt-dlp '${BASE_URI + m3u8Link}' -P ${SOAPER_DOWNLOAD_PATH} -o ${fileName}.mp4`
    spawnSync(ytdlpCommand, {
      // stdout has to be inherit here for dl to show in terminal
      stdio: ['inherit', 'inherit', 'inherit'],
      shell: true,
      encoding: 'utf-8'
    })
  }
  else if (isSeries) {
    // save series name for filename here
    const seriesName = sanitizeName(name.split('_').slice(0, -1).join('_') || 'soaper-dl')
    const seriesFolder = `${SOAPER_DOWNLOAD_PATH}/${seriesName}`
    // get list of eps and links
    const $: Cheerio = await fetch(pageLink)
      .then(res => res.text())
      .then(html => cheerio.load(html))

    const fzfEpList: string[] = []
    const seasons = $('.alert-info-ex')
    for (const season of seasons) {
      const seasonText = $(season).find('h4').text()
      const seasonNum = (/Season(\d{1,2})/.exec(seasonText)?.[1] || 'N/A') as string

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

    try {
      const createdDir = await mkdir(seriesFolder, { recursive: true })
      if (createdDir) console.info(`[soaper-dl] Creating folder for series: ${seriesFolder}`)
      // otherwise folder already exists
    } catch (err) {
      console.error('[soaper-dl-error] Could not make a folder for series')
      if (err instanceof Error) console.error(err.message);
      process.exit(1)
    }

    // needs this extra loop for sequential dls to workn
    for (const command of commands){
      console.info(`[soaper-dl] Downloading ${seriesFolder}/${command.split(' ').at(-1)}`)
      spawnSync(command, {
        // stdout has to be inherit here
        stdio: ['inherit', 'inherit', 'inherit'],
        shell: true,
        encoding: 'utf-8'
      })
    }
  }
  console.info('[soaper-dl] All done')
  process.exit(0)
}

async function main(searchTerm: string) {

  if (!searchTerm) await fetchReleases()

  const chosenLink: string = await search(searchTerm).catch(err => {
    console.error('[soaper-dl-error] Search fetch failed')
    console.error(err)
    process.exit(1)
  })
  if (!chosenLink) process.exit(1)
  await startDownload(chosenLink)
}

main(SEARCH_TERM).catch(err => {
  console.error(err)
  process.exit(1)
})

