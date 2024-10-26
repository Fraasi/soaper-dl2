#!/usr/bin/env node

import  os from 'node:os'
import url from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as cheerio from 'cheerio'

const FILE_NAME = path.basename(url.fileURLToPath(import.meta.url))
const SEARCH_TERM = process.argv.slice(2).join(' ')
const BASE_URI = 'https://soaper.tv'
const SUB_LANG = 'en'
const SOAPER_DOWNLOAD_PATH = process.env.SOAPER_DOWNLOAD_PATH || os.homedir()

console.log('SEARCH_TERM:', SEARCH_TERM)
if (SEARCH_TERM === '-h' || SEARCH_TERM === '--help') {
  console.info(`Usage: ${FILE_NAME} <SEARCH TERM>`)
  process.exit(0)
}

if (!SEARCH_TERM) {
  // TODO: fetch new release list to fzf
  console.info('[soaper-dl] Nothing found, try another search term')
  process.exit(0)
}

async function search(): Promise<string> {
  const searchUrl = `${BASE_URI}/search.html?keyword=`

  type Cheerio = ReturnType<typeof cheerio.load>;
  const $: Cheerio = await fetch(searchUrl + SEARCH_TERM)
  .then(res => res.text())
  .then(html => cheerio.load(html))

  const results = $('div.thumbnail.text-center')
  if (results.length === 0) {
    console.info('[soaper-dl] Nothing found, try another search term')
    process.exit(0)
  }

  const fzfLines: string[] = []
  results.each((_i, el) => {
    const year = $(el).find('.img-group > div').text()
    const title = $(el).find('h5').text().replaceAll(' ', '_')
    const href =  $(el).find('h5 > a').attr('href') as string
    fzfLines.push(`[${year}] ${title} ${BASE_URI + href}`)
  })

  const fzf = spawnSync(`echo "${fzfLines.join('\n')}" | fzf --header-first --header="Search Results" --cycle --with-nth 1,2`, {
    // stdout has to be pipe here to return results
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })

  return fzf.stdout.replace(/\n$/, '')
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
      subs: null | Array<{name: string, path: string}>;
      val: string;
    }
    const {subs, val: m3u8Link }: Links = result
    if (m3u8Link === 'Cannot get video source.') throw '[soaper-dl-error] Cannot get video source.'
      const subPath: {path: string, name: string } | undefined = subs?.find(sub => sub.name.includes(SUB_LANG))

    return {
      m3u8Link,
      subLink: subPath?.path ? subPath.path : null
    }
}

async function runShell(command: string, std: 'pipe' | 'inherit' = 'inherit'): Promise<void> {
  spawnSync(command, {
    // stdout has to be pipe on some streams
    stdio: ['inherit', std, 'inherit'],
    shell: true,
    encoding: 'utf-8'
  })
}

function sanitizeName(name: string): string {
  // illegal chars: / ? < > \ : * | " causes problems when in filename, also remove []'()
  return name.replace(/[/\\*?<>|'\[\]\(\)]/g, '')
}

async function startDownload(chosenLink: string): Promise<void> {

  const [year, name, pageLink] = chosenLink.split(' ')
  const isSeries = ( chosenLink.includes('/tv_')) //  chosenLink.includes('/episode') )
  const ajaxType = isSeries ? 'GetEInfoAjax' : 'GetMInfoAjax'
  if (!isSeries) {
    const { m3u8Link, subLink }: DlLinks = await getDlLinks(pageLink, ajaxType)
    const fileName = sanitizeName(`${name}_${year}`)
    if (subLink) {
      // const subPath = `${SUB_DL_PATH}/${fileName}.en.srt`
      console.info(`[soaper-dl] Downloading subtitles ${fileName}`)
      runShell(`curl ${BASE_URI + subLink} --output-dir=${SOAPER_DOWNLOAD_PATH} -o ${fileName}.en.srt`)
    }

    console.info(`[soaper-dl] Downloading ${SOAPER_DOWNLOAD_PATH}/${fileName}`)
    runShell(`yt-dlp '${BASE_URI + m3u8Link}' -P ${SOAPER_DOWNLOAD_PATH} -o ${fileName}.mp4`)
  }

  if (isSeries) {
    function zeroPad(n: string): string { return Number(n) < 10 ? '0' + n : n }
    // save series name for filename here
    const seriesName = name.split('_').slice(0, -1).join('_') || ''
    // get list of eps and links
    const $ = await fetch(pageLink)
      .then(res => res.text())
      .then(html => cheerio.load(html))

    const fzfEpList: string[] = []

    const seasons = $('.alert-info-ex')
    for (let season of seasons) {
      const seasonText = $(season).find('h4').text()
      const seasonNum = (/Season(\d){1,2}/.exec(seasonText)?.[1] || 'N/A') as string

      const episodes = $(season).find('div > a')
      for (let ep of episodes) {
        const [epNum, epName] = $(ep).text().replaceAll(' ', '_').split('.') as string[]
        fzfEpList.push(`[S${zeroPad(seasonNum) }E${zeroPad(epNum)}] ${epName} ${BASE_URI + $(ep).attr('href')}`)
      }
    }

    const fzf = spawnSync(`echo "${fzfEpList.join('\n')}" | fzf --header-first --header="Choose episodes to download with <TAB>" --multi --cycle --with-nth 1,2,3`, {
      // stdout has to be pipe here
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: true,
      encoding: 'utf-8'
    })

    // sort selected eps to dl oldest first
    const selectedEpisodes = fzf.stdout.split('\n').sort()
    const commands: string[] = []
    // TODO: check for a folder with same name as series

    for (const ep of selectedEpisodes) {
      if (!ep) continue
      const [epNum, name, epPageLink] = ep.split(' ')
      const fileName = sanitizeName(`${seriesName}_${epNum}_${name}`)
      const { m3u8Link, subLink }: DlLinks = await getDlLinks(epPageLink, ajaxType)
      if (subLink) {
        // const subPath = `${SUB_DL_PATH}/${fileName}.en.srt`
        const commandCurl = `curl '${BASE_URI + subLink}' --output-dir=${SOAPER_DOWNLOAD_PATH} -o ${fileName}.en.srt`
        commands.push(commandCurl)
      }
      const commandYTDLP = `yt-dlp --quiet '${BASE_URI + m3u8Link}' -P ${SOAPER_DOWNLOAD_PATH} -o ${fileName}.mp4`
      commands.push(commandYTDLP)
    }


    console.log('commands:', commands)
    // needs this loop for sequential dls to work
    // running 'command' thru runShell func doesn't work for sequential ddownloads for some reason
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

